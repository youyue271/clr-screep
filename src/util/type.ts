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