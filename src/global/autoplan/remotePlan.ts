import {remoteSetting} from "@/setting"

/**
 * 外矿房自动规划：
 * - 相邻房用 Game.map.describeExits 拿，不需要视野、开销很小
 * - 已知 unsafe（有主/被他人 reserve/有敌对）的房直接排除
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
        if (!name || seen[name]) {
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

/**
 * 把一次视野里看到的外矿房信息写进 Memory.mapIntel，并同步 plan 状态。
 * 有主 / 被别人 reserve / 有敌对 → 停用该外矿房；
 * 已经是我们自己的房 → 从 plan 移除；安全 → 填 sources，交给采集流程。
 */
export function recordRoomIntel(homeRoomName: string, room: Room): void {
    if (!Memory.mapIntel) {
        Memory.mapIntel = {}
    }
    const intel = Memory.mapIntel[room.name] ?? (Memory.mapIntel[room.name] = {})
    const me = Game.rooms[homeRoomName]?.controller?.owner?.username
    const controller = room.controller
    const sources = room.find(FIND_SOURCES)
    intel.scoutedAt = Game.time
    intel.sources = sources.map(source => source.id)
    intel.owner = controller?.owner?.username
    intel.reservation = controller?.reservation?.username
    intel.hostile = room.find(FIND_HOSTILE_CREEPS).length > 0
    intel.unsafe = !!intel.hostile
        || !!(controller?.owner && !controller.my)
        || !!(controller?.reservation && controller.reservation.username !== me)

    const plan = Memory.remotePlan?.[homeRoomName]
    const state = plan?.rooms?.[room.name]
    if (!plan || !plan.rooms || !state) {
        return
    }
    if (controller?.my) {
        // 已经是我们自己的房间，不再算外矿
        delete plan.rooms[room.name]
        return
    }
    if (intel.unsafe) {
        state.enabled = false
        return
    }
    state.enabled = true
    const sourceStates = state.sources ?? (state.sources = {})
    for (const source of sources) {
        if (!sourceStates[source.id]) {
            sourceStates[source.id] = {}
        }
    }
}
