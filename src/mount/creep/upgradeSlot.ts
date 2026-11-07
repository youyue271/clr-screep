/**
 * 控制器工位（upgrade berth）计算与分配。
 *
 * 工位表只在结构签名变化时重算，缓存在 global：
 * - P = 控制器 Chebyshev 距离 <= 3 的可走格；
 * - door = P 中距离正好 3、且 8 邻域里有 d>3 可走格的格子（外部入口）；
 * - 从 door 里保留欧氏距离最远的一对作为常通门，永不作工位；
 * - 其余格子（门 + d<=2 内圈）贪心加入工位，并校验最坏情况：
 *   假设所有工位都被占，每个内圈工位仍要 8 邻接一个"从保留门/未占门出发、
 *   只走空格"可达的格子。门的工位自带外部入口，不需要校验。
 *
 * creep 在 upgrade() 里按需认领离自己最近的空工位，写进 memory.upgradeSlot
 *（认领表按 tick 缓存在 global.slotClaims，每房间每 tick 最多扫一遍 creep）；
 * field.ts 的封禁集合会把这些工位当静态障碍，寻路自动避开别人占着的工位。
 * 这样工位进出的路线始终存在，不依赖运行时互推。
 */
import {fieldCost, fieldVersion} from "./field"
import {DIR_DX, DIR_DY, FT_WALL, idx} from "./fieldCore"

// 控制器升级生效距离（upgradeController 的 range）
const RING = 3
// 保留多少个门作为常通门
const RESERVED_DOORS = 2

export interface BerthInfo {
    key: string
    slots: number[]
    slotSet: Set<number>
    doors: number[]
    reservedDoors: number[]
    capacity: number
}

function emptyInfo(): BerthInfo {
    return {key: '', slots: [], slotSet: new Set(), doors: [], reservedDoors: [], capacity: 0}
}

function cacheMap(): { [room: string]: BerthInfo } {
    const g = global as any
    if (!g.upgradeBerths) {
        g.upgradeBerths = {}
    }
    return g.upgradeBerths
}

function cheb(x: number, y: number, cx: number, cy: number): number {
    return Math.max(Math.abs(x - cx), Math.abs(y - cy))
}

function walkableCost(cost: Uint8Array, x: number, y: number): boolean {
    if (x < 0 || x > 49 || y < 0 || y > 49) {
        return false
    }
    return cost[idx(x, y)] < FT_WALL
}

function isDoor(cost: Uint8Array, cx: number, cy: number, i: number): boolean {
    const x = i % 50
    const y = (i / 50) | 0
    if (cheb(x, y, cx, cy) !== RING) {
        return false
    }
    for (let d = 1; d <= 8; d++) {
        const nx = x + DIR_DX[d]
        const ny = y + DIR_DY[d]
        if (walkableCost(cost, nx, ny) && cheb(nx, ny, cx, cy) > RING) {
            return true
        }
    }
    return false
}

/**
 * 最坏情况可达性：假设 slots 全部被占，检查每个内圈工位是否能从外部走进来。
 * 空地 = P 中未被占的格子；入口 = 保留门 + 未占用的门。
 * 门的工位本身自带外部入口，不参与校验。
 */
function reachableAtWorst(p: number[], doors: Set<number>, reserved: Set<number>, slots: number[]): boolean {
    const blocked = new Set(slots)
    const free = new Set<number>()
    for (const i of p) {
        if (!blocked.has(i)) {
            free.add(i)
        }
    }
    const seen = new Set<number>()
    const queue: number[] = []
    for (const i of free) {
        if (reserved.has(i) || doors.has(i)) {
            seen.add(i)
            queue.push(i)
        }
    }
    for (let k = 0; k < queue.length; k++) {
        const i = queue[k]
        const x = i % 50
        const y = (i / 50) | 0
        for (let d = 1; d <= 8; d++) {
            const ni = idx(x + DIR_DX[d], y + DIR_DY[d])
            if (seen.has(ni) || blocked.has(ni) || !free.has(ni)) {
                continue
            }
            seen.add(ni)
            queue.push(ni)
        }
    }
    for (const s of slots) {
        if (doors.has(s)) {
            continue
        }
        const x = s % 50
        const y = (s / 50) | 0
        let ok = false
        for (let d = 1; d <= 8; d++) {
            if (seen.has(idx(x + DIR_DX[d], y + DIR_DY[d]))) {
                ok = true
                break
            }
        }
        if (!ok) {
            return false
        }
    }
    return true
}

function computeBerths(cost: Uint8Array, cx: number, cy: number): BerthInfo {
    const p: number[] = []
    for (let dy = -RING; dy <= RING; dy++) {
        for (let dx = -RING; dx <= RING; dx++) {
            const x = cx + dx
            const y = cy + dy
            if (walkableCost(cost, x, y)) {
                p.push(idx(x, y))
            }
        }
    }
    if (!p.length) {
        return emptyInfo()
    }
    const doors = p.filter(i => isDoor(cost, cx, cy, i))
    const doorSet = new Set(doors)
    const inner = p.filter(i => !doorSet.has(i))

    // 保留门：欧氏距离最远的一对（按索引顺序稳定取第一个最优解）
    const reserved: number[] = []
    if (doors.length === 1) {
        reserved.push(doors[0])
    } else if (doors.length >= 2) {
        let best = -1
        for (let a = 0; a < doors.length; a++) {
            for (let b = a + 1; b < doors.length; b++) {
                const ax = doors[a] % 50, ay = (doors[a] / 50) | 0
                const bx = doors[b] % 50, by = (doors[b] / 50) | 0
                const dd = (ax - bx) * (ax - bx) + (ay - by) * (ay - by)
                if (dd > best) {
                    best = dd
                    reserved.length = 0
                    reserved.push(doors[a], doors[b])
                }
            }
        }
        if (reserved.length > RESERVED_DOORS) {
            reserved.length = RESERVED_DOORS
        }
    }
    if (!reserved.length) {
        return emptyInfo()
    }
    const reservedSet = new Set(reserved)

    // 贪心：内圈优先（尽量利用内圈），再补非保留门；多试几种顺序取工位最多的一组
    const orders: number[][] = [
        inner.slice().sort((a, b) =>
            cheb(a % 50, (a / 50) | 0, cx, cy) - cheb(b % 50, (b / 50) | 0, cx, cy) || a - b),
        inner.slice().sort((a, b) =>
            cheb(b % 50, (b / 50) | 0, cx, cy) - cheb(a % 50, (a / 50) | 0, cx, cy) || a - b),
        inner.slice(),
    ]
    let bestSlots: number[] = []
    for (const order of orders) {
        const slots: number[] = []
        for (const i of order) {
            slots.push(i)
            if (!reachableAtWorst(p, doorSet, reservedSet, slots)) {
                slots.pop()
            }
        }
        for (const i of doors) {
            if (reservedSet.has(i)) {
                continue
            }
            slots.push(i)
            if (!reachableAtWorst(p, doorSet, reservedSet, slots)) {
                slots.pop()
            }
        }
        if (slots.length > bestSlots.length) {
            bestSlots = slots
        }
    }
    return {
        key: '',
        slots: bestSlots,
        slotSet: new Set(bestSlots),
        doors,
        reservedDoors: reserved,
        capacity: bestSlots.length,
    }
}

/** 取本房间的工位表（结构变化时重算） */
export function upgradeBerths(room: Room): BerthInfo {
    // 全局开关：出问题时可一键退回旧的"所有人挤 range 3"行为（类似 ftDisable）
    if ((global as any).berthDisable) {
        return emptyInfo()
    }
    const controller = room.controller
    if (!controller) {
        return emptyInfo()
    }
    const key = `${controller.id}:${fieldVersion(room)}`
    const cache = cacheMap()
    const hit = cache[room.name]
    if (hit && hit.key === key) {
        return hit
    }
    const info = computeBerths(fieldCost(room), controller.pos.x, controller.pos.y)
    info.key = key
    cache[room.name] = info
    return info
}

interface ClaimEntry {
    tick: number
    key: string
    claims: { [tile: number]: string }
}

/** 本 tick 的工位认领表：每个房间每 tick 只扫一遍 creep，同 tick 内的新认领直接记进去 */
function claimCache(): { [room: string]: ClaimEntry } {
    const g = global as any
    if (!g.slotClaims) {
        g.slotClaims = {}
    }
    return g.slotClaims
}

/**
 * 取 creep 的工位（返回格索引）；没有就认领离自己最近的空工位。
 * 返回 -1 表示这个房间没有可用工位（例如控制器被墙围死），调用方回退原生 range 3 行为。
 * 返回索引而不是 RoomPosition：绝大多数 tick 调用方只会拿它跟自身坐标比一下，
 * 只有真的要走过去时才 new RoomPosition，省掉每 tick 每只 upgrader 的一次对象分配。
 */
export function getUpgradeSlot(creep: Creep, controller: StructureController): number {
    const info = upgradeBerths(creep.room)
    if (!info.capacity) {
        return -1
    }
    const mine = creep.memory.upgradeSlot
    if (mine && typeof mine[0] === 'number' && typeof mine[1] === 'number') {
        const t = idx(mine[0], mine[1])
        if (info.slotSet.has(t)) {
            return t
        }
    }
    // 同一格出现多个认领时按名字字典序小的优先，保证同 tick 内也确定
    const cache = claimCache()
    const roomName = creep.room.name
    let entry = cache[roomName]
    if (!entry || entry.tick !== Game.time || entry.key !== info.key) {
        const claims: { [tile: number]: string } = {}
        const creeps = creep.room.find(FIND_MY_CREEPS)
        for (const c of creeps) {
            const s = c.memory.upgradeSlot
            if (!s || typeof s[0] !== 'number' || typeof s[1] !== 'number') {
                continue
            }
            const t = idx(s[0], s[1])
            if (!info.slotSet.has(t)) {
                continue
            }
            const owner = claims[t]
            if (!owner || c.name < owner) {
                claims[t] = c.name
            }
        }
        entry = cache[roomName] = {tick: Game.time, key: info.key, claims}
    }
    const claims = entry.claims
    let best = -1
    let bestD = Infinity
    for (const t of info.slots) {
        if (claims[t]) {
            continue
        }
        const x = t % 50
        const y = (t / 50) | 0
        const d = cheb(x, y, creep.pos.x, creep.pos.y)
        if (d < bestD || (d === bestD && (best < 0 || t < best))) {
            bestD = d
            best = t
        }
    }
    if (best < 0) {
        return -1
    }
    creep.memory.upgradeSlot = [best % 50, (best / 50) | 0]
    // 记进本 tick 的认领表：同 tick 内后面的 creep 不会再选到这格（例如同时出生的两只）
    if (!claims[best]) {
        claims[best] = creep.name
    }
    return best
}

/** 调试/测试用：直接取工位表（不分配） */
export function berthStats(roomName: string): any {
    const info = cacheMap()[roomName]
    if (!info) {
        return {exists: false}
    }
    const pos = (i: number) => [i % 50, (i / 50) | 0]
    return {
        exists: true,
        capacity: info.capacity,
        slots: info.slots.map(pos),
        doors: info.doors.map(pos),
        reservedDoors: info.reservedDoors.map(pos),
    }
}
