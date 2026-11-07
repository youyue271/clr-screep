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

type AdvancedRoleConstant =
    | 'attacker'
    | 'remoteBuilder'
    // sleep 不是可孵化角色，只是让 Role 联合类型能传给 getBody 的签名检查
    | 'sleep'