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
 *   → 替挡路者补一条反向 move，两只在回合末交换位置。
 *
 * 不需要处理的情况：
 *   - 双方都在动：引擎自动对穿
 *   - 挡路者是敌人/中立/正在孵化：不碰
 *   - 同格多只 creep（只可能发生在 spawn 格）：跳过
 *
 * global.trafficDisable = true 一键关闭；global.trafficLog = [] 记录交换事件。
 */
import {DIR_DX, DIR_DY, idx, OPPOSITE} from "./fieldCore"

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

        if (blocker.move(OPPOSITE[dir] as DirectionConstant) === OK) {
            if (g.trafficLog) {
                const log = g.trafficLog as string[]
                log.push(`${Game.time}:${mover.name}<-${blocker.name}`)
                if (log.length > 50) {
                    log.shift()
                }
            }
        }
    }
}
