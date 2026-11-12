import {remoteSetting} from "@/setting"

/**
 * highway 通道房：房间名坐标能被 10 整除（如 W34S50、W40S49）。
 * 这类房没有 controller、没有 source，不能占领/保留；
 * 早期规划对"没探过"的相邻房一律当候选，必须靠房名先挡掉。
 */
export function isHighwayRoom(roomName: string): boolean {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName)
    if (!m) {
        return false
    }
    return parseInt(m[2], 10) % 10 === 0 || parseInt(m[4], 10) % 10 === 0
}

/**
 * 清掉计划里已经确定没有源的房（highway / 侦察确认无 source）。
 * 早期规划先于侦察，未知房会先占坑；探明后必须能自愈，
 * 否则会一直占 maxRooms 名额，并让 claimer 去一个没有 controller 的房常驻
 * —— 在出口格上原地打转（W34S50 实测）。
 * 返回被清掉的房名，方便调用方记日志/测试。
 */
export function pruneSourcelessRemoteRooms(plan: RemotePlan, intelMap?: { [roomName: string]: MapIntel }): string[] {
    const removed: string[] = []
    for (const roomName in plan.rooms) {
        if (isHighwayRoom(roomName)) {
            delete plan.rooms[roomName]
            removed.push(roomName)
            continue
        }
        const sources = intelMap?.[roomName]?.sources
        if (Array.isArray(sources) && sources.length === 0) {
            delete plan.rooms[roomName]
            removed.push(roomName)
        }
    }
    return removed
}

/**
 * 外矿房自动规划：
 * - 相邻房用 Game.map.describeExits 拿，不需要视野、开销很小
 * - 已知 unsafe（有主/被他人 reserve/有 Invader 建筑）的房直接排除
 * - 已知有矿的优先，未知的其次（交给侦察兵去探）
 * - 每个主房最多 remoteSetting.maxRooms 个
 */
export function planRemoteRooms(homeRoomName: string): string[] {
    const exits = Game.map.describeExits(homeRoomName)
    if (!exits) {
        return []
    }
    const intelMap = Memory.mapIntel ?? {}
    const seen: { [roomName: string]: boolean } = {}
    const candidates: { name: string, score: number }[] = []
    for (const dir in exits) {
        const name = exits[dir]
        if (!name || seen[name] || isHighwayRoom(name)) {
            continue
        }
        seen[name] = true
        if (Game.map.getRoomStatus(name)?.status === 'closed') {
            continue
        }
        const intel = intelMap[name]
        if (intel?.unsafe) {
            continue
        }
        const room = Game.rooms[name]
        if (room?.controller?.my) {
            continue
        }
        const sourceCount = intel?.sources?.length ?? -1
        if (sourceCount === 0) {
            // 探明过但没有矿，不值得占外矿名额
            continue
        }
        candidates.push({
            name,
            // 已知 2 矿 > 已知 1 矿 > 未知
            score: sourceCount >= 2 ? 3 : sourceCount === 1 ? 2 : 1,
        })
    }
    candidates.sort((a, b) => b.score - a.score)
    return candidates.map(item => item.name).slice(0, remoteSetting.maxRooms)
}
