// 一些使用到的颜色常量
type Colors = 'green' | 'blue' | 'yellow' | 'red' | 'white'

interface log {
    log(content: string, prefixes: string[], color: Colors, notify: boolean): void

    debug(message: string): void

    info(message: string): void

    warning(message: string): void

    error(message: string): void
}

/**
 * bodySet
 * 简写版本的 bodyPart[]
 * 形式如下
 * @example { [TOUGH]: 3, [WORK]: 4, [MOVE]: 7 }
 */
interface BodySet {
    [MOVE]?: number
    [CARRY]?: number
    [ATTACK]?: number
    [RANGED_ATTACK]?: number
    [WORK]?: number
    [CLAIM]?: number
    [TOUGH]?: number
    [HEAL]?: number
}


/**
 * 敌对威胁分级：
 * none 没看到敌对；harmless 只会采集/搬运/移动（无攻击能力）；
 * raid 无 HEAL 的小股武装；assault 正规进攻；siege 拆家/重火力。
 */
type ThreatLevel = 'none' | 'harmless' | 'raid' | 'assault' | 'siege'

interface ThreatSummary {
    level: ThreatLevel
    // 敌对 creep 数量（只算还活着的）
    count: number
    attackParts: number
    rangedParts: number
    workParts: number
    healParts: number
    claimParts: number
    // 理论输出：ATTACK/RANGED_ATTACK 的每 tick 伤害
    dps: number
    // 理论治疗量：HEAL 每 tick 回复量
    healPerTick: number
    ids: Id<Creep>[]
}

/**
 * 外矿 L2 分类：只描述"房间里是什么"，不描述怎么打。
 * none 干净；harmless 只有无武装敌对；invaderCreep Invader 武装兵；
 * invaderCore Invader 建筑/控制器保留；playerTroops 真实玩家的兵；
 * playerControl 真实玩家控制（owner/reserve/建筑）；unknown 无视野。
 */
type RemoteCategory =
    | 'none'
    | 'harmless'
    | 'invaderCreep'
    | 'invaderCore'
    | 'playerTroops'
    | 'playerControl'
    | 'unknown'

/**
 * 外矿 L2 决策意图，由执行层消费：
 * counter 反击 Invader creep；avoid 撤退不交战；expedition 准备出征（L3）；
 * scout 优先侦察；none 不做额外动作。
 */
type RemoteResponse = 'none' | 'counter' | 'avoid' | 'expedition' | 'scout'

type CreepRoleConstant = BaseRoleConstant | AdvancedRoleConstant

type BaseRoleConstant =
    | 'harvester'
    | 'carrier'
    | 'emptyWorker'
    | 'worker'
    | 'claimer'
    | 'miner'
    | 'viewer'
    | 'remoteHarvester'
    | 'remoteCarrier'
    // 中央中转搬运：定点站立，只做建筑之间的搬运
    | 'centerCarrier'

type AdvancedRoleConstant =
    | 'attacker'
    | 'remoteBuilder'
    // sleep 不是可孵化角色，只是让 Role 联合类型能传给 getBody 的签名检查
    | 'sleep'

/**
 * L3 任务：把 L2 的 response 变成可执行的作战单位。
 * counter 清 Invader creep；expedition 打 Invader core。
 */
type MissionKind = 'counter' | 'expedition'

/** 任务阶段：集合 -> 赶路 -> 交战；收尾时任务直接删除，成员自己回家 */
type MissionState = 'forming' | 'travel' | 'engage'

/** 任务结束原因，回写 intel.lastBattle / 冷却 */
type MissionResultKind = 'cleared' | 'wiped' | 'aborted' | 'timeout'

/** 任务成员状态，由 creep 自己上报，避免 L3 每 tick 扫全场 */
type MissionMemberState = 'waiting' | 'travel' | 'arrived' | 'home'

interface WarMissionMember {
    role: 'attacker'
    state: MissionMemberState
    lastSeen: number
}

/**
 * 一支作战任务。id 用 `${home}|${target}|${kind}` 稳定生成，
 * 天然防止同房同类任务重复创建。
 */
interface WarMission {
    id: string
    kind: MissionKind
    homeRoom: string
    targetRoom: string
    state: MissionState
    createdAt: number
    updatedAt: number
    attempt: number
    /** 满编需求；形成阶段按它判断是否出发 */
    desired: { attacker: number }
    members: { [creepName: string]: WarMissionMember }
    /** 最近一次看到的具体目标（core），交战层优先按 id 找 */
    targetId?: Id<StructureInvaderCore>
    /** 超时时间：到点还没打完就撤，避免小队在外面耗死 */
    deadline?: number
}

/**
 * 任务历史：按 home|target|kind 记在同一轮骚扰 episode 内派了几队、
 * 失败几次、冷却到什么时候。新 episode（hostileSince 变了）自动清零。
 */
interface MissionRecord {
    attempt: number
    fails: number
    lastAt: number
    lastResult?: MissionResultKind
    cooldownUntil?: number
    /** 归属的骚扰 episode，用来判断是否重置 */
    hostileSince?: number
}

interface WarMemory {
    missions?: { [id: string]: WarMission }
    records?: { [id: string]: MissionRecord }
}