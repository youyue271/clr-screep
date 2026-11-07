/**
 * 房间内距离场缓存。
 *
 * 每个目标格（+range）维护一张 2500 格的方向表，所有起点共用。
 * 结构变化时整体失效；封禁集合（harvester 常驻站位 + upgrader 工位）变化时逐张判断
 * 哪些场受影响，且都等到下次 getField 用到才重建——一次只重建被查询的那一个目标。
 * 表的运行时查询是无状态的，creep 被推到哪里都自愈。
 */
import {
    buildField, DIR_DX, DIR_DY, fieldAffectedByBlock, fieldCutByTile, FT_SIZE, FT_WALL, idx, seedTiles,
} from './fieldCore'

// 结构签名多久校验一次（tick）
const SIG_INTERVAL = 10
// 常驻站位多久重算一次（tick）
const RES_INTERVAL = 10
// 每房间最多缓存多少张表（LRU）
const MAX_FIELDS = 64

interface FieldEntry {
    dirs: Uint8Array
    stamp: number
}

interface RoomTraffic {
    ver: number
    sig: string
    sigTick: number
    baseCost: Uint8Array | null
    // 把房间边界格（x/y = 0/49）当墙的代价表：室内目标用它建场，避免路径贴边
    // 踩上出口格被引擎弹到隔壁房。目标本身在边界时仍用 baseCost。
    interiorCost: Uint8Array | null
    reserved: Uint8Array | null
    reservedCount: number
    resKey: string
    resTick: number
    fields: Map<string, FieldEntry>
    builds: number
    evictions: number
}

interface MoveTrack {
    x: number
    y: number
    tick: number
    stuck: number
}

const TYPE_IDS: { [type: string]: number } = {
    spawn: 1, extension: 2, road: 3, container: 4, tower: 5, storage: 6, link: 7,
    rampart: 8, constructedWall: 9, extractor: 10, lab: 11, terminal: 12, nuker: 13,
    factory: 14, observer: 15, powerSpawn: 16, keeperLair: 17, portal: 18,
    invaderCore: 19, controller: 20,
}

function stateMap(): { [room: string]: RoomTraffic } {
    const g = global as any
    if (!g.ftStates) {
        g.ftStates = {}
    }
    return g.ftStates
}

function trackMap(): Map<string, MoveTrack> {
    const g = global as any
    if (!g.ftTracks) {
        g.ftTracks = new Map<string, MoveTrack>()
    }
    return g.ftTracks
}

function isBlockingStructure(structureType: string): boolean {
    if (structureType === STRUCTURE_ROAD || structureType === STRUCTURE_CONTAINER
        || structureType === STRUCTURE_RAMPART) {
        return false
    }
    return (OBSTACLE_OBJECT_TYPES as string[]).indexOf(structureType) !== -1
}

/** 结构签名：只关心"会不会改变可走性/代价"的东西（类型 + 坐标） */
function computeSignature(room: Room): string {
    const structures = room.find(FIND_STRUCTURES)
    let h = 2166136261
    let n = structures.length
    for (const s of structures) {
        const t = TYPE_IDS[s.structureType] ?? 99
        h = ((h ^ (s.pos.x * 50 + s.pos.y + t * 10000)) * 16777619) | 0
    }
    // 会挡路的工地（墙/建筑）同样改变可走性，必须进签名
    for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
        if (!isBlockingStructure(s.structureType)) {
            continue
        }
        const t = TYPE_IDS[s.structureType] ?? 99
        h = ((h ^ (s.pos.x * 50 + s.pos.y + t * 10000)) * 16777619) | 0
        n++
    }
    return `${n}:${h}`
}

function findContainerTile(source: Source): number | null {
    const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER,
    })[0] as StructureContainer | undefined
    return container ? idx(container.pos.x, container.pos.y) : null
}

/**
 * 常驻站位：按任务分配算，不看 creep 当前位置。
 * harvester 的采矿站位是固定格（掉落要进同格 container）。
 */
export function harvesterStationTile(creep: Creep, roomName: string): number | null {
    const work = creep.memory.currentWork
    if (!work || !work.taskParam) {
        return null
    }
    if (work.taskFunc === 'harvestSource') {
        const cx = work.taskParam[1]
        const cy = work.taskParam[2]
        const cr = work.taskParam[3] as string | undefined
        if (typeof cx === 'number' && typeof cy === 'number' && (!cr || cr === roomName)) {
            return idx(cx, cy)
        }
        const source = Game.getObjectById<Source>(work.taskParam[0])
        return source && source.pos.roomName === roomName ? findContainerTile(source) : null
    }
    if (work.taskFunc === 'remoteHarvest') {
        const targetRoom = work.taskParam[1] as string
        if (targetRoom !== roomName) {
            return null
        }
        const source = Game.getObjectById<Source>(work.taskParam[0])
        return source && source.pos.roomName === roomName ? findContainerTile(source) : null
    }
    return null
}

/**
 * 封禁集合 = harvester 常驻站位（任务推导）。
 * 是"按任务算"的静态格，不随 creep 当前位置变化；harvester 换岗、结构变化时才会改，
 * 场按下面的规则惰性失效。upgrader 不再预分工位，站位由 trafficControl 动态展开。
 */
function computeBlocked(room: Room, st: RoomTraffic): { key: string, tiles: Uint8Array, count: number } {
    const tiles = new Uint8Array(FT_SIZE)
    const creeps = room.find(FIND_MY_CREEPS)
    for (const creep of creeps) {
        const role = creep.memory.role
        if (role === 'harvester' || role === 'remoteHarvester') {
            const tile = harvesterStationTile(creep, room.name)
            if (tile !== null && tile >= 0 && tile < FT_SIZE) {
                tiles[tile] = 1
            }
        }
    }
    const list: number[] = []
    for (let i = 0; i < FT_SIZE; i++) {
        if (tiles[i]) {
            list.push(i)
        }
    }
    return {key: list.join(','), tiles, count: list.length}
}

/** 地形 + 常驻结构（路 / 墙 / 建筑 / 矿 / 控制器）的进入代价 */
function buildBaseCost(room: Room): Uint8Array {
    const cost = new Uint8Array(FT_SIZE)
    const terrain = room.getTerrain()
    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const i = y * 50 + x
            const mask = terrain.get(x, y)
            if (mask & TERRAIN_MASK_WALL) {
                cost[i] = FT_WALL
            } else if (mask & TERRAIN_MASK_SWAMP) {
                cost[i] = 10
            } else {
                cost[i] = 2
            }
        }
    }
    for (const s of room.find(FIND_STRUCTURES)) {
        const i = idx(s.pos.x, s.pos.y)
        if (s.structureType === STRUCTURE_ROAD) {
            if (cost[i] !== FT_WALL) {
                cost[i] = 1
            }
        } else if (s.structureType === STRUCTURE_RAMPART) {
            // 自己房间的 rampart 可走；敌对的非 public rampart 挡路
            const rampart = s as StructureRampart
            if (!rampart.my && !rampart.isPublic) {
                cost[i] = FT_WALL
            }
        } else if (isBlockingStructure(s.structureType)) {
            cost[i] = FT_WALL
        }
    }
    // 自己的挡路工地：引擎在完工前就不让走（墙/刷怪等）
    for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
        if (isBlockingStructure(s.structureType)) {
            cost[idx(s.pos.x, s.pos.y)] = FT_WALL
        }
    }
    for (const s of room.find(FIND_SOURCES)) {
        cost[idx(s.pos.x, s.pos.y)] = FT_WALL
    }
    for (const m of room.find(FIND_MINERALS)) {
        cost[idx(m.pos.x, m.pos.y)] = FT_WALL
    }
    return cost
}

/**
 * 封禁集合变化后，按"这张场的路径是否真的受影响"逐张决定是否作废，
 * 不整房清空。场本身仍然在下次 getField 被用到时才重建（一次只建这一个目标）。
 */
function invalidateAffectedFields(st: RoomTraffic, old: Uint8Array, next: Uint8Array, cost: Uint8Array): void {
    if (!st.fields.size) {
        return
    }
    const added: number[] = []
    const removed: number[] = []
    for (let i = 0; i < FT_SIZE; i++) {
        if (next[i] && !old[i]) {
            added.push(i)
        } else if (!next[i] && old[i]) {
            removed.push(i)
        }
    }
    if (!added.length && !removed.length) {
        return
    }
    st.fields.forEach((f, key) => {
        const parts = key.split(',')
        const cx = +parts[0]
        const cy = +parts[1]
        const range = +parts[2]
        let drop = false
        for (const t of added) {
            if (fieldAffectedByBlock(f.dirs, cost, t, cx, cy, range)) {
                drop = true
                break
            }
        }
        if (!drop) {
            for (const t of removed) {
                if (fieldCutByTile(f.dirs, cost, t, cx, cy, range)) {
                    drop = true
                    break
                }
            }
        }
        if (drop) {
            st.fields.delete(key)
        }
    })
}

function ensureRoom(room: Room, forceSig = false): RoomTraffic {
    const all = stateMap()
    let st = all[room.name]
    if (!st) {
        st = all[room.name] = {
            ver: 0, sig: '', sigTick: -1e9, baseCost: null, interiorCost: null,
            reserved: null, reservedCount: 0, resKey: '', resTick: -1e9,
            fields: new Map(), builds: 0, evictions: 0,
        }
    }

    if (st.baseCost === null || forceSig || Game.time - st.sigTick >= SIG_INTERVAL) {
        const sig = computeSignature(room)
        st.sigTick = Game.time
        if (sig !== st.sig) {
            st.sig = sig
            st.ver++
            st.baseCost = null
            st.interiorCost = null
            st.fields.clear()
        }
    }

    if (st.reserved === null || Game.time - st.resTick >= RES_INTERVAL) {
        const res = computeBlocked(room, st)
        st.resTick = Game.time
        if (res.key !== st.resKey) {
            const old = st.reserved
            st.resKey = res.key
            st.reserved = res.tiles
            st.reservedCount = res.count
            // 封禁位变化只影响场，不影响基础代价；逐张判断，能保留的都保留
            if (!old || !st.baseCost) {
                st.fields.clear()
            } else {
                invalidateAffectedFields(st, old, res.tiles, st.baseCost)
            }
        }
    }

    if (!st.baseCost) {
        st.baseCost = buildBaseCost(room)
    }

    pruneTracks()
    return st
}

/** 定期清理已死亡 creep 的卡住记录，避免 global 里的表无限增长 */
function pruneTracks(): void {
    const g = global as any
    if (Game.time - (g.ftPruneTick ?? 0) < 100) {
        return
    }
    g.ftPruneTick = Game.time
    const tracks = trackMap()
    tracks.forEach((_t, name) => {
        if (!(name in Game.creeps)) {
            tracks.delete(name)
        }
    })
}

export interface ResolvedField {
    dirs: Uint8Array
    // 实际生效的 range（目标格不可走时会自动放大到 1）
    range: number
}

/**
 * 取到 (pos, range) 的距离场。返回 null 表示无法建场，调用方应回退原生 moveTo。
 */
export function getField(room: Room, pos: RoomPosition, range: number): ResolvedField | null {
    const st = ensureRoom(room)
    // 室内目标的场不允许经过边界格：creep 踩上出口格会在回合结束被引擎送进隔壁房，
    // 贴边寻路会让它在两房之间每 tick 来回弹。moveToRoom 的目标就是出口格，仍用原表。
    const onEdge = pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
    let cost: Uint8Array
    if (onEdge) {
        cost = st.baseCost as Uint8Array
    } else {
        if (!st.interiorCost) {
            const inner = (st.baseCost as Uint8Array).slice()
            for (let i = 0; i < 50; i++) {
                inner[i] = FT_WALL
                inner[49 * 50 + i] = FT_WALL
                inner[i * 50] = FT_WALL
                inner[i * 50 + 49] = FT_WALL
            }
            st.interiorCost = inner
        }
        cost = st.interiorCost
    }
    const ti = idx(pos.x, pos.y)
    let eff = range > 0 ? range : 0
    // 目标本身不可走（建筑 / source / 墙）时按 range 1 处理
    if (eff === 0 && cost[ti] >= FT_WALL) {
        eff = 1
    }

    const key = `${pos.x},${pos.y},${eff}`
    const cached = st.fields.get(key)
    if (cached) {
        // LRU：命中的移到队尾
        st.fields.delete(key)
        st.fields.set(key, cached)
        return {dirs: cached.dirs, range: eff}
    }

    let seeds = seedTiles(pos.x, pos.y, eff, cost)
    // range > 0 时不把常驻站位当落脚点；range == 0 时目标格本身仍然放行
    if (eff > 0 && st.reserved) {
        const reserved = st.reserved
        seeds = seeds.filter(i => !reserved[i])
    }
    if (!seeds.length) {
        return null
    }
    // 常驻位是"路过封禁"，但目标就是常驻位本身时要能走进去（harvester 走回自己的站位）
    let blocked: Uint8Array | null = st.reserved
    if (eff === 0 && blocked && blocked[ti]) {
        const copy = blocked.slice()
        copy[ti] = 0
        blocked = copy
    }
    const dirs = buildField(cost, seeds, blocked)
    st.fields.set(key, {dirs, stamp: Game.time})
    st.builds++
    if (st.fields.size > MAX_FIELDS) {
        const first = st.fields.keys().next()
        if (!first.done) {
            st.fields.delete(first.value)
            st.evictions++
        }
    }
    return {dirs, range: eff}
}

function nextTileBlocked(room: Room, x: number, y: number): boolean {
    if (x < 0 || x > 49 || y < 0 || y > 49) {
        return true
    }
    if (room.getTerrain().get(x, y) & TERRAIN_MASK_WALL) {
        return true
    }
    const structures = room.lookForAt(LOOK_STRUCTURES, x, y)
    for (const s of structures) {
        if (isBlockingStructure(s.structureType)) {
            return true
        }
    }
    // 自己的挡路工地（比如刚下的墙）引擎同样不放行
    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y)
    for (const s of sites) {
        if (s.my && isBlockingStructure(s.structureType)) {
            return true
        }
    }
    return false
}

/**
 * 卡住检测：连续几 tick 没挪窝、且下一步的目标格被"新建筑"挡住时，
 * 立刻作废本房间的场并重建，避免要等 SIG_INTERVAL 才发现。
 * 返回 true 表示已经作废，调用方需要重新取一次场。
 */
export function detectStructureBlock(creep: Creep, field: ResolvedField): boolean {
    if (!creep.my || creep.fatigue > 0) {
        return false
    }
    const tracks = trackMap()
    const t = tracks.get(creep.name)
    const moved = !t || t.x !== creep.pos.x || t.y !== creep.pos.y
    if (moved) {
        tracks.set(creep.name, {x: creep.pos.x, y: creep.pos.y, tick: Game.time, stuck: 0})
        return false
    }
    t.tick = Game.time
    t.stuck++
    if (t.stuck < 2) {
        return false
    }
    const i = idx(creep.pos.x, creep.pos.y)
    const dir = field.dirs[i]
    if (!dir) {
        return false
    }
    const nx = creep.pos.x + DIR_DX[dir]
    const ny = creep.pos.y + DIR_DY[dir]
    if (!nextTileBlocked(creep.room, nx, ny)) {
        return false
    }
    // 结构变了：作废并立刻重算签名
    const st = stateMap()[creep.room.name]
    if (st) {
        st.sig = ''
        st.sigTick = -1e9
        st.baseCost = null
        st.fields.clear()
        ensureRoom(creep.room, true)
    }
    t.stuck = 0
    return true
}

/** 调试用：返回 from 格在"到 dest"这张场里的下一步方向，0 表示没有 */
export function fieldDirAt(room: Room, from: RoomPosition, dest: RoomPosition, range: number): number {
    const f = getField(room, dest, range)
    if (!f) {
        return 0
    }
    return f.dirs[idx(from.x, from.y)]
}

/** 主动作废某个房间的场（调试/测试用） */
export function invalidateRoom(room: Room): void {
    const st = stateMap()[room.name]
    if (!st) {
        return
    }
    st.sig = ''
    st.sigTick = -1e9
    st.baseCost = null
    st.interiorCost = null
    st.fields.clear()
}

/**
 * 当前房间的基础通行代价表（只读！供工位模块判断某个格子能不能站人）。
 * 返回的是缓存里的 Uint8Array，调用方只能读，不能改。
 */
export function fieldCost(room: Room): Uint8Array {
    return ensureRoom(room).baseCost as Uint8Array
}

/** 结构签名版本号：结构/工地变化时会自增，工位表用它做缓存 key */
export function fieldVersion(room: Room): number {
    return ensureRoom(room).ver
}

/** 测试/调试用：当前登记为常驻站位的格子索引 */
export function reservedTiles(roomName: string): number[] {
    const st = stateMap()[roomName]
    if (!st || !st.reserved) {
        return []
    }
    const out: number[] = []
    for (let i = 0; i < FT_SIZE; i++) {
        if (st.reserved[i]) {
            out.push(i)
        }
    }
    return out
}

/** 测试/调试用统计 */
export function fieldStats(roomName: string): any {
    const st = stateMap()[roomName]
    if (!st) {
        return {exists: false}
    }
    return {
        exists: true,
        ver: st.ver,
        builds: st.builds,
        evictions: st.evictions,
        fields: Array.from(st.fields.keys()),
        sigTick: st.sigTick,
        reservedCount: st.reservedCount,
        costReady: !!st.baseCost,
    }
}

/** 测试用：清空所有房间的场 */
export function clearAllFields(): void {
    const g = global as any
    g.ftStates = {}
    g.ftTracks = new Map<string, MoveTrack>()
}
