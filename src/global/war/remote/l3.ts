import { warSetting } from "@/setting"
import { expeditionSquadSize, counterSquadSize } from "../mission/plan"
import {
    addMissionMember,
    canAttempt,
    closeMission,
    createMission,
    findMission,
    getMission,
    missionsOf,
    pendingSpawnCount,
    removeMissionMember,
    setMissionMemberState,
} from "../mission/store"

/**
 * L3：任务执行层。
 *
 * 只消费 L2 写好的 intel.response，把它变成 Memory.war 里的任务：
 * - counter：清 Invader 武装 creep（当前只有 raid 级）
 * - expedition：打 Invader core（只打低等级、部署完成、算得过来的）
 *
 * 分工：
 * - 决策变化 / 10 tick 扫描 -> onRemoteDecision / reconcileHomeMissions 建任务
 * - 主房 spawn 刷新 -> refreshWarSpawn 按任务缺额排队
 * - creep 自己上报到达/回家/目标消失/死亡 -> 这里推进状态或关任务
 * - 任务结果回写 intel.lastBattle，出征失败进入冷却（L2 会把 expedition 降级成 scout）
 */

/** L2 每次评估后调用：按最新 response 建/关任务 */
export function onRemoteDecision(homeRoom: string, targetRoom: string, response: RemoteResponse): void {
    const intel = Memory.mapIntel?.[targetRoom]
    if (!intel) {
        return
    }
    const counter = findMission(homeRoom, targetRoom, 'counter')
    const expedition = findMission(homeRoom, targetRoom, 'expedition')
    if (response === 'counter') {
        if (expedition) {
            closeMission(expedition, 'aborted', 'decision:counter')
        }
        if (!counter) {
            createCounterMission(homeRoom, targetRoom, intel)
        }
        return
    }
    if (response === 'expedition') {
        if (counter) {
            closeMission(counter, 'aborted', 'decision:expedition')
        }
        if (!expedition) {
            createExpeditionMission(homeRoom, targetRoom, intel)
        }
        return
    }
    // none/harmless 是确认干净，其余（avoid/scout）是被动中断
    const result = response === 'none' ? 'cleared' : 'aborted'
    if (counter) {
        closeMission(counter, result, `decision:${response}`)
    }
    if (expedition) {
        closeMission(expedition, result, `decision:${response}`)
    }
}

function createCounterMission(homeRoom: string, targetRoom: string, intel: MapIntel): void {
    const desired = counterSquadSize(intel)
    if (!desired) {
        return
    }
    // 全房同时进行的反击任务上限，避免多房开战把经济掏空
    const active = missionsOf(homeRoom).filter(mission => mission.kind === 'counter').length
    if (active >= warSetting.counterMaxTotal) {
        return
    }
    const attempt = canAttempt(homeRoom, targetRoom, 'counter', intel, warSetting.counterMaxAttempts)
    if (!attempt) {
        return
    }
    createMission(homeRoom, targetRoom, 'counter', { attacker: desired }, attempt)
}

function createExpeditionMission(homeRoom: string, targetRoom: string, intel: MapIntel): void {
    const desired = expeditionSquadSize(intel)
    if (!desired) {
        return
    }
    const active = missionsOf(homeRoom).filter(mission => mission.kind === 'expedition').length
    if (active >= 1) {
        return
    }
    const attempt = canAttempt(homeRoom, targetRoom, 'expedition', intel, warSetting.expeditionMaxAttempts)
    if (!attempt) {
        return
    }
    createMission(homeRoom, targetRoom, 'expedition', { attacker: desired }, attempt, intel.coreId)
}

/**
 * 10 tick 兜底对账：L2 决策没变但任务已经失败/被清掉时，
 * 靠这里重新建任务（冷却/次数由 canAttempt 控制）。
 */
export function reconcileHomeMissions(homeRoom: string): void {
    const plan = Memory.remotePlan?.[homeRoom]
    if (!plan || !plan.rooms) {
        return
    }
    for (const roomName in plan.rooms) {
        const intel = Memory.mapIntel?.[roomName]
        if (!intel) {
            continue
        }
        if (intel.response === 'counter' || intel.response === 'expedition') {
            onRemoteDecision(homeRoom, roomName, intel.response)
        }
    }
}

/** 任务存续对账：成员死亡清理、集合完成、超时/全灭关闭 */
export function syncMissions(homeRoom?: string): void {
    const missions = Memory.war?.missions
    if (!missions) {
        return
    }
    const now = Game.time
    // 一次遍历统计每个任务实际的存活人数：不能只看 mission.members，
    // creep 刚孵化出来的那一 tick 还没进 soldier 登记，会被误判成"全灭"
    const aliveByMission: { [missionId: string]: number } = {}
    for (const name in Game.creeps) {
        const missionId = Game.creeps[name].memory.missionId
        if (missionId) {
            aliveByMission[missionId] = (aliveByMission[missionId] ?? 0) + 1
        }
    }
    const ids: string[] = []
    for (const id in missions) {
        ids.push(id)
    }
    for (const id of ids) {
        const mission = missions[id]
        if (!mission || (homeRoom && mission.homeRoom !== homeRoom)) {
            continue
        }
        // 房间已经移出计划（被占/停用）：任务作废
        const plan = Memory.remotePlan?.[mission.homeRoom]
        if (plan && plan.rooms && !plan.rooms[mission.targetRoom]) {
            closeMission(mission, 'aborted', 'left-plan')
            continue
        }
        for (const name in mission.members) {
            if (!Game.creeps[name]) {
                delete mission.members[name]
            }
        }
        const alive = aliveByMission[mission.id] ?? 0
        const pending = pendingSpawnCount(mission.homeRoom, mission.id)
        if (mission.state === 'forming') {
            if (alive >= mission.desired.attacker) {
                mission.state = 'travel'
                mission.updatedAt = now
            } else if (now - mission.createdAt >= warSetting.missionFormTimeout) {
                if (alive > 0 && pending === 0 && mission.kind === 'counter') {
                    // 补不满就按现有兵力出发，别让已经出来的在集合点白等
                    mission.state = 'travel'
                    mission.updatedAt = now
                } else if (alive === 0 && pending === 0) {
                    closeMission(mission, 'timeout', 'forming-empty')
                    continue
                } else if (alive > 0 && pending === 0) {
                    // 出征要求满编，人不够直接放弃
                    closeMission(mission, 'timeout', 'forming-partial')
                    continue
                }
            }
        }
        if (mission.deadline !== undefined && now >= mission.deadline) {
            closeMission(mission, 'timeout', 'deadline')
            continue
        }
        // 建任务和首次孵化之间有几 tick 空窗，过了窗口还没人也没排队就是全灭
        if (alive === 0 && pending === 0 && now - mission.createdAt > 20) {
            closeMission(mission, 'wiped', 'no-members')
        }
    }
}

/** 外矿总开关关闭/计划被移除：本房所有任务作废，排队中的作战单位由 spawn 侧取消 */
export function abortHomeMissions(homeRoom: string, detail: string): void {
    for (const mission of missionsOf(homeRoom)) {
        closeMission(mission, 'aborted', detail)
    }
}

/** creep 出生后第一次进 soldier 时登记，避免 spawn 侧和任务侧各写一份 */
export function ensureMissionMember(mission: WarMission, creepName: string): void {
    addMissionMember(mission, creepName)
}

export function onMissionArrived(missionId: string, creepName: string): void {
    const mission = getMission(missionId)
    if (!mission) {
        return
    }
    setMissionMemberState(mission, creepName, 'arrived')
    if (mission.state === 'travel') {
        mission.state = 'engage'
        mission.updatedAt = Game.time
        // 集合排队 + 赶路可能吃掉建任务时 deadline 的一大半。进入交战这一刻
        // 按"真正需要的输出时间"重设时限，否则会出现全员到了、打了半血、
        // 到点强制撤回（实测 3 只 attacker 把 100k core 打到 42.7k 被 deadline 掐断）。
        if (mission.kind === 'expedition') {
            mission.deadline = Game.time + warSetting.expeditionCombatTicks + 200
        }
    }
}

export function onMissionTravel(missionId: string, creepName: string): void {
    const mission = getMission(missionId)
    if (mission) {
        setMissionMemberState(mission, creepName, 'travel')
    }
}

export function onMissionHome(missionId: string, creepName: string): void {
    const mission = getMission(missionId)
    if (mission) {
        setMissionMemberState(mission, creepName, 'home')
    }
}

/** 目标已消失（清场/核心被拆）：任务完成，成员自己回家 */
export function onMissionCleared(missionId: string): void {
    const mission = getMission(missionId)
    if (mission) {
        closeMission(mission, 'cleared', 'target-gone')
    }
}

/** 交战条件失效（升级成强敌/玩家介入）：撤回 */
export function onMissionAborted(missionId: string, detail: string): void {
    const mission = getMission(missionId)
    if (mission) {
        closeMission(mission, 'aborted', detail)
    }
}

/** 成员死亡：只按任务人数收尾，不单独记战损（死亡本身由 L1 上报） */
export function onMissionMemberDied(creepName: string, memory: CreepMemory): void {
    const mission = getMission(memory.missionId)
    if (!mission) {
        return
    }
    removeMissionMember(mission, creepName)
    syncMissions(mission.homeRoom)
}
