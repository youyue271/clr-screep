import {remoteSetting, warSetting} from "@/setting"
import {classifyThreat, isArmedThreat, isWeakThreat} from "@/util/threat"

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
    // 按实际剩余战力分级：纯矿工/运输车不算威胁，小股武装先撤离，
    // 有 HEAL/高 DPS/拆墙能力才停用外矿。
    const threat = classifyThreat(room.find(FIND_HOSTILE_CREEPS))
    const armed = isArmedThreat(threat)
    const weak = isWeakThreat(threat)
    intel.scoutedAt = Game.time
    intel.sources = sources.map(source => source.id)
    intel.owner = controller?.owner?.username
    intel.reservation = controller?.reservation?.username
    intel.hostile = threat.count > 0
    intel.threatLevel = threat.level
    intel.hostileCount = threat.count
    intel.hostileDps = threat.dps
    if (armed) {
        if (intel.hostileSince === undefined) {
            // 新一轮骚扰：反击队的次数/冷却重新算
            intel.hostileSince = Game.time
            delete intel.counterAt
            delete intel.counterAttempts
        }
        intel.hostileLastSeen = Game.time
        // 武装敌对还在：安排下一次复查。弱敌复查得勤一点，
        // 强敌停用后隔久一点再回来看，避免侦察兵反复送死。
        intel.retryAt = Game.time + (weak ? warSetting.hostileRecheckTicks : warSetting.rescoutTicks)
    } else if (intel.hostileLastSeen !== undefined
        && Game.time - intel.hostileLastSeen >= warSetting.hostileCalmTicks) {
        // 连续这么久没看到武装敌对：这一轮骚扰结束，外矿恢复、复探标记清掉
        delete intel.hostileSince
        delete intel.hostileLastSeen
        delete intel.hostileCount
        delete intel.hostileDps
        delete intel.retryAt
        delete intel.counterAt
        delete intel.counterAttempts
    }
    // 弱敌不停用外矿：产线留着，先让 crew 撤离避战，下一批再交给反击队。
    // 强敌 / 有主 / 被外人 reserve 才 unsafe。
    intel.unsafe = (!weak && armed)
        || !!(controller?.owner && !controller.my)
        || !!(controller?.reservation && controller.reservation.username !== me)
    // 有视野时用真实保留剩余校正：不是我们的保留就清掉，
    // 避免别人抢走后 claimer 还按旧时间不去续
    if (controller?.reservation && controller.reservation.username === me) {
        intel.reservedUntil = Game.time + controller.reservation.ticksToEnd
    } else {
        delete intel.reservedUntil
    }

    const plan = Memory.remotePlan?.[homeRoomName]
    const state = plan?.rooms?.[room.name]
    if (!plan || !plan.rooms || !state) {
        return
    }
    if (controller?.my) {
        // 已经是我们自己的房间，不再算外矿
        Game.rooms[homeRoomName]?.removeRemoteCarryTasksOfRoom(room.name)
        delete plan.rooms[room.name]
        return
    }
    if (intel.unsafe) {
        if (state.enabled !== false) {
            // 停用是明确决定：立刻清掉回运任务，不等 10 tick 扫描
            Game.rooms[homeRoomName]?.removeRemoteCarryTasksOfRoom(room.name)
            // 外矿停用：重算道路分段，pending 里不再保留这个房的路
            Game.rooms[homeRoomName]?.syncRoadPlan()
        }
        state.enabled = false
        return
    }
    const wasEnabled = state.enabled === true
    state.enabled = true
    const sourceStates = state.sources ?? (state.sources = {})
    for (const source of sources) {
        if (!sourceStates[source.id]) {
            sourceStates[source.id] = {}
        }
    }
    // 外矿房开启事件：有视野时直接看 source 旁是否已经有 container，
    // 有就挂回运任务；没有就交给外矿 harvester 第一次看到 container 时再挂。
    if (!wasEnabled) {
        const homeRoom = Game.rooms[homeRoomName]
        if (homeRoom) {
            for (const source of sources) {
                const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
                    filter: (object: any) => object.structureType === STRUCTURE_CONTAINER
                })[0] as StructureContainer | undefined
                if (!container) {
                    continue
                }
                const entry = sourceStates[source.id]
                entry.containerId = container.id
                entry.containerPos = [container.pos.x, container.pos.y]
                homeRoom.registerRemoteCarryTask(room.name, source.id, container.id)
            }
            // 外矿重新启用：remoteLinkPos 可能还在，道路目标集合变了，重算一次
            homeRoom.syncRoadPlan()
        }
    }
}
