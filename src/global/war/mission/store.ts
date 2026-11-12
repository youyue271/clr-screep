import { warSetting } from "@/setting"

/**
 * L3 任务存储：Memory.war 的唯一读写方。
 *
 * - missions：活着的任务，key 是 `${home}|${target}|${kind}`，天然去重
 * - records：每个房每类任务的历史（派了几队/失败几次/冷却），新 episode 清零
 *
 * 只在这里写 Memory.war；creep 侧通过 l3 的事件入口上报，不直接改任务。
 */

export function missionKey(homeRoom: string, targetRoom: string, kind: MissionKind): string {
    return `${homeRoom}|${targetRoom}|${kind}`
}

function war(): WarMemory {
    let memory = Memory.war
    if (!memory) {
        memory = Memory.war = {}
    }
    return memory
}

function missionMap(): { [id: string]: WarMission } {
    const memory = war()
    return memory.missions ?? (memory.missions = {})
}

export function getMission(id: string | undefined): WarMission | undefined {
    return id ? Memory.war?.missions?.[id] : undefined
}

export function findMission(homeRoom: string, targetRoom: string, kind: MissionKind): WarMission | undefined {
    return getMission(missionKey(homeRoom, targetRoom, kind))
}

export function missionsOf(homeRoom: string): WarMission[] {
    const missions = Memory.war?.missions
    if (!missions) {
        return []
    }
    const list: WarMission[] = []
    for (const id in missions) {
        const mission = missions[id]
        if (mission && mission.homeRoom === homeRoom) {
            list.push(mission)
        }
    }
    return list
}

export function createMission(
    homeRoom: string,
    targetRoom: string,
    kind: MissionKind,
    desired: { attacker: number },
    attempt: number,
    targetId?: Id<StructureInvaderCore>,
): WarMission {
    const now = Game.time
    const id = missionKey(homeRoom, targetRoom, kind)
    const mission: WarMission = {
        id,
        kind,
        homeRoom,
        targetRoom,
        state: 'forming',
        createdAt: now,
        updatedAt: now,
        attempt,
        desired,
        members: {},
        targetId,
        deadline: now + warSetting.missionTimeout,
    }
    missionMap()[id] = mission
    return mission
}

/**
 * 关闭任务：任务从 Memory 删除，成员下一 tick 发现任务没了就自己回家。
 * 结果回写给 L2：lastBattle 永远写，出征失败累计到冷却。
 */
export function closeMission(mission: WarMission, result: MissionResultKind, detail: string): void {
    const now = Game.time
    const missions = Memory.war?.missions
    if (missions) {
        delete missions[mission.id]
    }
    const record = missionRecord(mission.homeRoom, mission.targetRoom, mission.kind)
    record.lastAt = now
    record.lastResult = result
    if (result === 'cleared') {
        record.attempt = 0
        record.fails = 0
        delete record.cooldownUntil
    } else {
        record.fails = (record.fails ?? 0) + 1
        record.cooldownUntil = now + (mission.kind === 'expedition'
            ? (record.fails >= warSetting.expeditionMaxFails
                ? warSetting.expeditionCooldownTicks
                : warSetting.counterReinforceTicks)
            : warSetting.counterReinforceTicks)
    }
    const intel = Memory.mapIntel?.[mission.targetRoom]
    if (!intel) {
        return
    }
    intel.lastBattle = { tick: now, kind: mission.kind, result, detail }
    if (mission.kind !== 'expedition') {
        return
    }
    if (result === 'cleared') {
        delete intel.expeditionFails
        delete intel.expeditionCooldownUntil
        return
    }
    const fails = (intel.expeditionFails ?? 0) + 1
    intel.expeditionFails = fails
    if (fails >= warSetting.expeditionMaxFails) {
        intel.expeditionCooldownUntil = now + warSetting.expeditionCooldownTicks
    }
}

/**
 * 任务历史。新 episode（L2 的 hostileSince 变了）代表上一轮骚扰结束，
 * 派队次数和冷却全部清零，不给下一轮背债务。
 */
export function missionRecord(homeRoom: string, targetRoom: string, kind: MissionKind): MissionRecord {
    const memory = war()
    const records = memory.records ?? (memory.records = {})
    const id = missionKey(homeRoom, targetRoom, kind)
    return records[id] ?? (records[id] = { attempt: 0, fails: 0, lastAt: 0 })
}

export function resetRecordForEpisode(
    record: MissionRecord,
    intel: MapIntel,
): void {
    if (record.hostileSince === intel.hostileSince) {
        return
    }
    record.hostileSince = intel.hostileSince
    record.attempt = 0
    record.fails = 0
    delete record.lastResult
    delete record.cooldownUntil
}

/** 还能不能再派一队：冷却 + 本轮次数上限 */
export function canAttempt(
    homeRoom: string,
    targetRoom: string,
    kind: MissionKind,
    intel: MapIntel,
    maxAttempts: number,
): number | undefined {
    const record = missionRecord(homeRoom, targetRoom, kind)
    resetRecordForEpisode(record, intel)
    const now = Game.time
    if (record.cooldownUntil !== undefined && now < record.cooldownUntil) {
        return undefined
    }
    if (record.attempt >= maxAttempts) {
        return undefined
    }
    record.attempt += 1
    record.lastAt = now
    return record.attempt
}

export function addMissionMember(mission: WarMission, creepName: string): void {
    if (mission.members[creepName]) {
        return
    }
    mission.members[creepName] = {
        role: 'attacker',
        state: 'waiting',
        lastSeen: Game.time,
    }
    mission.updatedAt = Game.time
}

export function removeMissionMember(mission: WarMission, creepName: string): void {
    if (!mission.members[creepName]) {
        return
    }
    delete mission.members[creepName]
    mission.updatedAt = Game.time
}

export function setMissionMemberState(
    mission: WarMission,
    creepName: string,
    state: MissionMemberState,
): void {
    const member = mission.members[creepName]
    if (!member) {
        return
    }
    member.lastSeen = Game.time
    if (member.state === state) {
        return
    }
    member.state = state
    mission.updatedAt = Game.time
}

/** 活着且仍在任务里的成员数（Memory 里可能有还没清理的死名） */
export function aliveMemberCount(mission: WarMission): number {
    let count = 0
    for (const name in mission.members) {
        if (Game.creeps[name]) {
            count++
        }
    }
    return count
}

/**
 * 主房这个任务"还没能上场"的人数：spawn 队列里排队的 + 正在孵化的。
 *
 * 排队中的任务在开始孵化时就会从 spawnTask 出队，但 creep 要等孵化完成
 * 才进 Game.creeps（10 部件 attacker 30 tick）。这中间如果只数队列，
 * 补员逻辑会以为缺人、每 tick 重复排队，任务对账也可能误判成全灭。
 */
export function pendingSpawnCount(homeRoom: string, missionId: string): number {
    let count = 0
    const buckets = Memory.rooms?.[homeRoom]?.creepTask?.spawnTask
    if (buckets) {
        for (const priority in buckets) {
            for (const task of buckets[priority] ?? []) {
                if (task?.taskParam?.[0] === 'attacker' && task?.taskParam?.[5] === missionId) {
                    count++
                }
            }
        }
    }
    const room = Game.rooms[homeRoom]
    if (room) {
        for (const spawn of room.find(FIND_MY_SPAWNS)) {
            const name = spawn.spawning?.name
            if (name && Memory.creeps[name]?.missionId === missionId) {
                count++
            }
        }
    }
    return count
}
