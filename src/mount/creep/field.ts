/**
 * 房间内距离场缓存。
 *
 * 每个目标格（+range）维护一张 2500 格的方向表，所有起点共用；
 * 结构变化时整体失效重建。表的运行时查询是无状态的，creep 被推到哪里都自愈。
 */
import {buildField, DIR_DX, DIR_DY, FT_SIZE, FT_WALL, idx, seedTiles} from './fieldCore'

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
 * 目前只登记 harvester 的采矿站位（container 格），upgrader 是 range 3 不固定，不登记。
 */
function harvesterStandingTile(creep: Creep, roomName: string): number | null {
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

function computeReserved(room: Room): { key: string, tiles: Uint8Array, count: number } {
    const tiles = new Uint8Array(FT_SIZE)
    let count = 0
    const list: number[] = []
    for (const creep of room.find(FIND_MY_CREEPS)) {
        const role = creep.memory.role
        if (role !== 'harvester' && role !== 'remoteHarvester') {
            continue
        }
        const tile = harvesterStandingTile(creep, room.name)
        if (tile !== null && tile >= 0 && tile < FT_SIZE && !tiles[tile]) {
            tiles[tile] = 1
            count++
            list.push(tile)
        }
    }
    list.sort((a, b) => a - b)
    return {key: list.join(','), tiles, count}
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

function ensureRoom(room: Room, forceSig = false): RoomTraffic {
    const all = stateMap()
    let st = all[room.name]
    if (!st) {
        st = all[room.name] = {
            ver: 0, sig: '', sigTick: -1e9, baseCost: null,
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
            st.fields.clear()
        }
    }

    if (st.reserved === null || Game.time - st.resTick >= RES_INTERVAL) {
        const res = computeReserved(room)
        st.resTick = Game.time
        if (res.key !== st.resKey) {
            st.resKey = res.key
            st.reserved = res.tiles
            st.reservedCount = res.count
            // 常驻位变化只影响场，不影响基础代价
            st.fields.clear()
        }
    }

    if (!st.baseCost) {
        st.baseCost = buildBaseCost(room)
    }
    return st
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
    const cost = st.baseCost as Uint8Array
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
    st.fields.clear()
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
