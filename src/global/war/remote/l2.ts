import { warSetting } from "@/setting"
import { classifyThreat, isNpcUser } from "@/util/threat"
import { filterHostileCreeps } from "@/util/whitelist"
import type { RemoteL1Report } from "../types"
import { onRemoteDecision } from "./l3"

/**
 * L2：外矿对敌的分类与决策层。
 *
 * L1 只给"哪里、有没有视野、有没有敌人"的事实；这里负责：
 * - 把房间里的人/建筑分成玩家 / Invader / 无害 / 干净；
 * - 决定外矿是继续、暂停、停用，还是交给 L3（反击队 / 未来出征队）；
 * - 是整个 Memory.mapIntel / plan.rooms[].enabled 的唯一决策写入方。
 *
 * 决策结果：
 * - playerControl：真实玩家 owner/reserve/建筑 → 撤退 + 停用外矿，不打
 * - playerTroops：真实玩家的兵 → 撤退 + 暂停，不打
 * - invaderCreep：Invader 武装 creep → 暂停 + 交给反击队
 * - invaderCore：Invader 建筑 / Invader reserve → 暂停 + 记出征意图（L3 以后执行）
 * - harmless / none：不放宽，干净视野会解除暂停
 * - unknown：看不到目标房时按伤害证据累计，够数才暂停
 *
 * 执行层（refreshCounterSpawn / counterAttack）只读 intel.response，
 * 不再自己推导"该不该打"。
 */

interface RemoteAssessment {
    category: RemoteCategory
    response: RemoteResponse
    reason: string
    threat: ThreatSummary
    creeps: Creep[]
    structures: Structure[]
    users: string[]
    owner?: string
    reservation?: string
    core?: StructureInvaderCore
}

/** L1 信号入口：有目标房视野就走正常分类，看不到才累积伤害证据 */
export function callRemoteL2(report: RemoteL1Report): void {
    const room = report.vision && report.observedRoom === report.targetRoom
        ? Game.rooms[report.observedRoom]
        : undefined
    if (room) {
        assessRemoteVision(report.homeRoom, room, `l1:${report.signal.kind}`)
        return
    }
    noteSuspicion(report)
}

/**
 * 视野入口：scout/claimer/attacker 到站、主房 10 tick 扫描都会走这里。
 * 同一 tick 多次调用只认第一次，避免 Memory 重复写。
 */
export function assessRemoteVision(homeRoom: string, room: Room, source = 'vision'): void {
    if (!Memory.mapIntel) {
        Memory.mapIntel = {}
    }
    const intel = Memory.mapIntel[room.name] ?? (Memory.mapIntel[room.name] = {})
    if (intel.assessedAt === Game.time) {
        return
    }
    const me = Game.rooms[homeRoom]?.controller?.owner?.username
    const assessment = assessRoom(room, me)
    applyAssessment(homeRoom, room, assessment, me, source)
}

function assessRoom(room: Room, me?: string): RemoteAssessment {
    const controller = room.controller
    const owner = controller?.owner?.username
    const reservation = controller?.reservation?.username
    // 白名单玩家的 creep 直接忽略：不参与威胁分级，也不触发暂停/反击/出征
    const creeps = filterHostileCreeps(room.find(FIND_HOSTILE_CREEPS))
    const structures = room.find(FIND_HOSTILE_STRUCTURES)
    const threat = classifyThreat(creeps)
    const users: string[] = []
    let playerCreeps = false
    let npcArmed = false
    for (const creep of creeps) {
        const user = creep.owner?.username
        if (user && users.indexOf(user) < 0) {
            users.push(user)
        }
        if (!user || !isNpcUser(user)) {
            // 没 owner 的 hostile creep 当玩家处理，保守
            playerCreeps = true
        } else if (isArmedCreep(creep)) {
            npcArmed = true
        }
    }
    let playerStructure: Structure | undefined
    let core: StructureInvaderCore | undefined
    for (const structure of structures) {
        const user = ownerOf(structure)
        if (user && users.indexOf(user) < 0) {
            users.push(user)
        }
        if (structure.structureType === STRUCTURE_INVADER_CORE) {
            core = structure as StructureInvaderCore
        } else if (!user || !isNpcUser(user)) {
            playerStructure = structure
        }
    }

    const base = { threat, creeps, structures, users, owner, reservation, core }
    const ownerIsPlayer = !!owner && owner !== me && !isNpcUser(owner)
    const reservationIsPlayer = !!reservation && reservation !== me && !isNpcUser(reservation)
    const npcReservation = !!reservation && reservation !== me && isNpcUser(reservation)

    // 优先级：玩家控制 > 玩家部队 > Invader 部队 > Invader 建筑/保留 > 无害 > 干净。
    // 只要房里混有真实玩家的东西，就按玩家处理，不会因为同房有 invader 就去打。
    if (ownerIsPlayer) {
        return {...base, category: 'playerControl', response: 'avoid', reason: `owner:${owner}`}
    }
    if (reservationIsPlayer) {
        return {...base, category: 'playerControl', response: 'avoid', reason: `reserve:${reservation}`}
    }
    if (playerStructure) {
        return {...base, category: 'playerControl', response: 'avoid', reason: `structure:${ownerOf(playerStructure)}`}
    }
    if (playerCreeps) {
        return {...base, category: 'playerTroops', response: 'avoid', reason: `creeps:${users.join(',')}`}
    }
    if (npcArmed) {
        return {...base, category: 'invaderCreep', response: 'counter', reason: `invader:${threat.level}`}
    }
    if (core || npcReservation) {
        return {
            ...base,
            category: 'invaderCore',
            response: 'expedition',
            reason: core ? `core:${core.level}` : `invaderReserve`,
        }
    }
    if (creeps.length) {
        return {...base, category: 'harmless', response: 'none', reason: `harmless:${threat.count}`}
    }
    return {...base, category: 'none', response: 'none', reason: 'clean'}
}

function applyAssessment(
    homeRoom: string,
    room: Room,
    a: RemoteAssessment,
    me: string | undefined,
    source: string,
): void {
    const intel = Memory.mapIntel![room.name]
    const now = Game.time
    const controller = room.controller
    const sources = room.find(FIND_SOURCES)

    // 出征冷却期内不重复派队：只侦察，等冷却结束再评估
    let response = a.response
    let reason = a.reason
    if (response === 'expedition' && (intel.expeditionCooldownUntil ?? 0) > now) {
        response = 'scout'
        reason = `${a.reason}:cooldown`
    }

    // 视野事实
    intel.scoutedAt = now
    intel.sources = sources.map(item => item.id)
    intel.owner = a.owner
    intel.reservation = a.reservation
    intel.hostile = a.creeps.length > 0
    intel.threatLevel = a.threat.level
    intel.hostileCount = a.threat.count
    intel.hostileDps = a.threat.dps
    intel.category = a.category
    intel.response = response
    intel.assessedAt = now
    if (a.users.length) {
        intel.hostileUsers = a.users
    } else {
        delete intel.hostileUsers
    }
    if (a.structures.length) {
        intel.hostileStructureIds = a.structures.map(item => item.id)
    } else {
        delete intel.hostileStructureIds
    }
    if (a.core) {
        intel.coreId = a.core.id
        intel.coreLevel = a.core.level
        intel.coreHits = a.core.hits
        intel.coreDeploy = a.core.ticksToDeploy
    } else {
        delete intel.coreId
        delete intel.coreLevel
        delete intel.coreHits
        delete intel.coreDeploy
    }
    intel.lastDecision = {
        tick: now,
        category: a.category,
        response,
        reason: `${source}:${reason}`,
    }
    // 玩家控制 / Invader 建筑：不让自动规划再把这个房选成外矿
    intel.unsafe = a.category === 'playerControl' || a.category === 'invaderCore'
    // 有视野时用真实保留剩余校正：不是我们的保留就清掉
    if (controller?.reservation && controller.reservation.username === me) {
        intel.reservedUntil = now + controller.reservation.ticksToEnd
    } else {
        delete intel.reservedUntil
    }

    // 干净视野解除伤害证据；怀疑触发的暂停没有 hostileLastSeen，直接放行
    const clean = a.category === 'none' || a.category === 'harmless'
    if (clean) {
        delete intel.suspicionSince
        delete intel.suspicionLastAt
        delete intel.suspicionCount
        if (intel.hostileSince !== undefined && intel.hostileLastSeen === undefined) {
            delete intel.hostileSince
        }
    }
    updateEpisode(intel, a.category, now)
    applyPlanState(homeRoom, room, a, sources)
    // 决策交给 L3：响应幂等，10 tick 扫描和 creep 到站刷新都会走这里，
    // 任务被清掉后能自动补建（冷却/次数由 L3 控制）
    onRemoteDecision(homeRoom, room.name, response)
}

/**
 * 骚扰 episode：暂停类分类一出现就开 episode，连续 hostileCalmTicks
 * 没再看到才解除。反击次数/冷却只在新 episode 开始时重置。
 */
function updateEpisode(intel: MapIntel, category: RemoteCategory, now: number): void {
    if (isPauseCategory(category)) {
        if (intel.hostileSince === undefined) {
            intel.hostileSince = now
            delete intel.counterAt
            delete intel.counterAttempts
        }
        intel.hostileLastSeen = now
        intel.retryAt = now + (category === 'playerControl'
            ? warSetting.rescoutTicks
            : warSetting.hostileRecheckTicks)
        return
    }
    if (intel.hostileSince === undefined) {
        if (category === 'none' || category === 'harmless') {
            delete intel.retryAt
        }
        return
    }
    if (intel.hostileLastSeen !== undefined
        && now - intel.hostileLastSeen >= warSetting.hostileCalmTicks) {
        delete intel.hostileSince
        delete intel.hostileLastSeen
        delete intel.hostileCount
        delete intel.hostileDps
        delete intel.retryAt
        delete intel.counterAt
        delete intel.counterAttempts
    }
}

/**
 * 计划状态：玩家控制才停用房；Invader 场景只暂停生产，计划保留，
 * 让反击/出征意图有房可用。已占下来的房从外矿计划移除。
 */
function applyPlanState(homeRoom: string, room: Room, a: RemoteAssessment, sources: Source[]): void {
    const plan = Memory.remotePlan?.[homeRoom]
    const state = plan?.rooms?.[room.name]
    if (!plan || !plan.rooms || !state) {
        return
    }
    const home = Game.rooms[homeRoom]
    if (room.controller?.my) {
        home?.removeRemoteCarryTasksOfRoom(room.name)
        delete plan.rooms[room.name]
        return
    }
    if (a.category === 'playerControl') {
        if (state.enabled !== false) {
            home?.removeRemoteCarryTasksOfRoom(room.name)
            home?.syncRoadPlan()
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
    // 从停用状态恢复：把矿点旁已有 container 的回运任务挂回去
    if (!wasEnabled && home) {
        for (const source of sources) {
            const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (object: any) => object.structureType === STRUCTURE_CONTAINER,
            })[0] as StructureContainer | undefined
            if (!container) {
                continue
            }
            const entry = sourceStates[source.id]
            entry.containerId = container.id
            entry.containerPos = [container.pos.x, container.pos.y]
            home.registerRemoteCarryTask(room.name, source.id, container.id)
        }
        home.syncRoadPlan()
    }
}

/**
 * 看不到目标房时的伤害证据（harvester 丢部件 / creep 提前死亡）：
 * 单次只提前侦察；窗口内累计够数才暂停生产。
 */
function noteSuspicion(report: RemoteL1Report): void {
    if (!Memory.mapIntel) {
        Memory.mapIntel = {}
    }
    const intel = Memory.mapIntel[report.targetRoom] ?? (Memory.mapIntel[report.targetRoom] = {})
    const now = Game.time
    if (intel.suspicionLastAt !== undefined
        && now - intel.suspicionLastAt > warSetting.suspicionWindow) {
        delete intel.suspicionSince
        delete intel.suspicionCount
    }
    const count = (intel.suspicionCount ?? 0) + 1
    intel.suspicionCount = count
    intel.suspicionLastAt = now
    if (intel.suspicionSince === undefined) {
        intel.suspicionSince = now
    }
    // 侦察兵优先去看这个房，确认到底有没有敌人
    if (intel.retryAt === undefined || intel.retryAt > now) {
        intel.retryAt = now
    }
    const hadEpisode = intel.hostileSince !== undefined
    const escalated = count >= warSetting.suspicionLimit
    if (escalated && !hadEpisode) {
        intel.hostileSince = now
    }
    // 已经确认过敌情（反击/撤退进行中）时别把 response 改回 scout
    if (!hadEpisode || intel.response === undefined || intel.response === 'none') {
        intel.response = 'scout'
    }
    intel.lastDecision = {
        tick: now,
        category: 'unknown',
        response: intel.response ?? 'scout',
        reason: `${report.signal.kind}@${report.observedRoom}${escalated ? ` x${count}` : ''}`,
    }
}

const pauseCategories: RemoteCategory[] = ['playerControl', 'playerTroops', 'invaderCreep', 'invaderCore']

function isPauseCategory(category: RemoteCategory): boolean {
    return pauseCategories.indexOf(category) >= 0
}

function isArmedCreep(creep: Creep): boolean {
    return creep.getActiveBodyparts(ATTACK) > 0
        || creep.getActiveBodyparts(RANGED_ATTACK) > 0
        || creep.getActiveBodyparts(CLAIM) > 0
}

function ownerOf(structure: Structure): string | undefined {
    return (structure as OwnedStructure).owner?.username
}
