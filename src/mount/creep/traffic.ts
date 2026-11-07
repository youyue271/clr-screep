/**
 * 对穿 / 让位。
 *
 * 引擎实测（私服 4.2.20）：双方本 tick 都有移动意图时，引擎自己就会让两只 creep
 * 交换位置；真正卡死的只有"移动方撞上本 tick 没有移动意图的静止友军"这一种。
 * 距离场和原生寻路都不把 creep 当障碍（不重新绕路），所以静止挡路者会把后面的人
 * 一直顶在原地。这里在所有 creep 的 work() 跑完之后统一补一刀：
 *
 *   mover 这 tick 成功发出过 move 意图
 *   + 下一步的目标格上正好有一只友军 creep
 *   + mover 上一 tick 也在原地（stuck >= 1，避免路过碰擦就推人）
 *   + 挡路者这 tick 没有移动意图、有 MOVE 部件、疲劳为 0
 *   → 挡路者如果正在做"换一格照样能干"的工作（build/repair/upgrade/取放资源），
 *     优先把它平移到工作范围内另一个空格继续干；找不到空格才反向对穿。
 *     harvest 这类必须钉在站位上的工作绝对不推，mover 自己等。
 *
 * 不需要处理的情况：
 *   - 双方都在动：引擎自动对穿
 *   - 挡路者是敌人/中立/正在孵化：不碰
 *   - 同格多只 creep（只可能发生在 spawn 格）：跳过
 *
 * global.trafficDisable = true 一键关闭；global.trafficLog = [] 记录交换事件。
 */
import {DIR_DX, DIR_DY, FT_WALL, idx, OPPOSITE} from "./fieldCore"
import {fieldCost} from "./field"

interface Track {
    x: number
    y: number
    tick: number
    stuck: number
}

function trackMap(): { [name: string]: Track } {
    const g = global as any
    if (!g.trafficTracks) {
        g.trafficTracks = {}
    }
    return g.trafficTracks
}

function logTraffic(g: any, line: string): void {
    if (!g.trafficLog) {
        return
    }
    const log = g.trafficLog as string[]
    log.push(line)
    if (log.length > 50) {
        log.shift()
    }
}

// 可以在工作范围内平移让位的任务：taskFunc -> 工作生效半径。
// harvest 不在这里：掉落要先填同格 container，人必须钉在站位上。
const MOVABLE_WORK_RANGE: { [taskFunc: string]: number } = {
    buildConstructionSite: 3,
    repairStructure: 3,
    upgrade: 3,
    getEnergyFromStructure: 1,
    collectEnergy: 1,
    carryEnergy: 1,
}
// 绝对不动的工作：被顶上时 mover 自己等
const IMMOVABLE_TASKS: { [taskFunc: string]: boolean } = {
    harvestSource: true,
    remoteHarvest: true,
}

/**
 * 挡路者当前工作的类别：
 *   > 0  可以在该半径内平移（范围里换一格照样能干活）
 *     0  绝对不动（harvest 站位）
 *    -1  不按固定工作处理（闲置/赶路等），沿用原来的反向推
 */
function blockerWorkRange(blocker: Creep): number {
    const work = blocker.memory.currentWork
    if (!work) {
        return -1
    }
    if (IMMOVABLE_TASKS[work.taskFunc]) {
        return 0
    }
    return MOVABLE_WORK_RANGE[work.taskFunc] ?? -1
}

/**
 * 在 8 邻格里找一格"让位后还能继续干活"的空地：
 * 可走、本 tick 无人、到工作目标 Chebyshev <= range，并优先离目标最近的
 * （往工地/控制器内侧让，把外侧的入口让给 mover）。
 * 返回方向；0 表示没有可用格。
 */
function relocationDir(blocker: Creep, range: number, roomIndex: { [tile: number]: Creep | null }): number {
    const work = blocker.memory.currentWork
    const target = work && work.taskParam
        ? Game.getObjectById(work.taskParam[0] as Id<any>) as any
        : null
    if (!target || !target.pos || target.pos.roomName !== blocker.room.name) {
        return 0
    }
    const cost = fieldCost(blocker.room)
    const tx = target.pos.x
    const ty = target.pos.y
    let best = 0
    let bestD = Infinity
    for (let d = 1; d <= 8; d++) {
        const nx = blocker.pos.x + DIR_DX[d]
        const ny = blocker.pos.y + DIR_DY[d]
        // 房间边界格会被引擎弹到隔壁房，内部工作不使用
        if (nx < 1 || nx > 48 || ny < 1 || ny > 48) {
            continue
        }
        const dd = Math.max(Math.abs(nx - tx), Math.abs(ny - ty))
        if (dd > range || cost[idx(nx, ny)] >= FT_WALL) {
            continue
        }
        if (roomIndex[idx(nx, ny)] !== undefined) {
            continue
        }
        if (dd < bestD) {
            bestD = dd
            best = d
        }
    }
    return best
}

export function trafficControl(): void {
    const g = global as any
    if (g.trafficDisable) {
        return
    }
    const tracks = trackMap()

    // 死亡 creep 的计数每 100 tick 清一次，避免 global 无限增长
    if (Game.time - (g.trafficPruneTick ?? 0) >= 100) {
        g.trafficPruneTick = Game.time
        for (const name in tracks) {
            if (!(name in Game.creeps)) {
                delete tracks[name]
            }
        }
    }

    const byRoom: { [room: string]: { [tile: number]: Creep | null } } = {}
    const movers: Creep[] = []
    for (const name in Game.creeps) {
        const creep = Game.creeps[name]

        // 本 tick 位置和上一 tick 相同 → 连续没挪窝；否则清零
        let t = tracks[name]
        if (!t || t.tick !== Game.time - 1) {
            tracks[name] = {x: creep.pos.x, y: creep.pos.y, tick: Game.time, stuck: 0}
        } else if (t.x === creep.pos.x && t.y === creep.pos.y) {
            t.stuck++
            t.tick = Game.time
        } else {
            t.x = creep.pos.x
            t.y = creep.pos.y
            t.tick = Game.time
            t.stuck = 0
        }

        const roomName = creep.room.name
        const roomIndex = byRoom[roomName] ?? (byRoom[roomName] = {})
        const tile = idx(creep.pos.x, creep.pos.y)
        // null = 这一格上不止一只 creep（只可能发生在 spawn 格），说不清挡路的是谁
        roomIndex[tile] = roomIndex[tile] === undefined ? creep : null

        if ((creep as any).__moveTick === Game.time) {
            movers.push(creep)
        }
    }

    for (const mover of movers) {
        const dir = (mover as any).__moveDir as number
        if (!dir || dir < 1 || dir > 8) {
            continue
        }
        const nx = mover.pos.x + DIR_DX[dir]
        const ny = mover.pos.y + DIR_DY[dir]
        if (nx < 0 || nx > 49 || ny < 0 || ny > 49) {
            continue
        }
        const roomIndex = byRoom[mover.room.name]
        if (!roomIndex) {
            continue
        }
        const blocker = roomIndex[idx(nx, ny)]
        // 没有挡路者 / 挡路者就是自己 / 不是自己的 creep 一律不管
        if (!blocker || blocker === mover || !blocker.my || blocker.spawning) {
            continue
        }
        // 它这 tick 也在动：引擎自己会处理对穿
        if ((blocker as any).__moveTick === Game.time) {
            continue
        }
        // 疲劳 / 没有 MOVE 部件都发不出有效移动意图
        if (blocker.fatigue > 0 || blocker.getActiveBodyparts(MOVE) === 0) {
            continue
        }
        const t = tracks[mover.name]
        if (!t || t.stuck < 1) {
            continue
        }

        const workRange = blockerWorkRange(blocker)
        if (workRange > 0) {
            const reloc = relocationDir(blocker, workRange, roomIndex)
            if (reloc) {
                if (blocker.move(reloc as DirectionConstant) === OK) {
                    // 本 tick 的格子索引同步更新：后面的 mover 看到的是让位后的位置
                    const bi = idx(blocker.pos.x, blocker.pos.y)
                    const ni = idx(blocker.pos.x + DIR_DX[reloc], blocker.pos.y + DIR_DY[reloc])
                    if (roomIndex[bi] === blocker) {
                        roomIndex[bi] = undefined
                    }
                    roomIndex[ni] = blocker
                    logTraffic(g, `${Game.time}:R${mover.name}<-${blocker.name}`)
                }
                continue
            }
            // 挡路者在工作范围内没有空格可让，看看 mover 自己能不能换一格干
        }
        // mover 自己也是"范围内可平移"的工作：绕过挡路者去另一个能干活的方向。
        // 这条分支同时解决"挡路者是 harvest 绝对不动"和"挡路者四周都站满"两种情况。
        const moverRange = blockerWorkRange(mover)
        if (moverRange > 0) {
            const mReloc = relocationDir(mover, moverRange, roomIndex)
            if (mReloc && mover.move(mReloc as DirectionConstant) === OK) {
                logTraffic(g, `${Game.time}:M${mover.name}<${blocker.name}`)
                continue
            }
        }
        if (workRange === 0) {
            // 绝对不动（harvest 站位）：mover 下一 tick 再试
            continue
        }

        if (blocker.move(OPPOSITE[dir] as DirectionConstant) === OK) {
            logTraffic(g, `${Game.time}:${mover.name}<-${blocker.name}`)
        }
    }
}
