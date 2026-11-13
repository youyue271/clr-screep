/**
 * 玩家白名单：
 * - pass：只放行纯 MOVE 的侦察兵，其它部件照常当敌对处理
 * - full：该玩家所有 creep 都不算敌对
 * 存储放顶层 Memory.whitelist（推代码后仍保留），由玩家手动维护。
 */

export function whitelistModeOf(username: string | undefined): WhitelistMode | undefined {
    if (!username) {
        return undefined
    }
    return Memory.whitelist?.players?.[username]
}

/**
 * 这只敌对 creep 是否按白名单放过。
 * pass 要求所有存活部件都是 MOVE（纯移动侦察兵）；
 * 只要还剩一个非 MOVE 部件（哪怕别的部件被打掉）就照常处理。
 */
export function isWhitelistedCreep(creep: Creep): boolean {
    const mode = whitelistModeOf(creep.owner?.username)
    if (!mode) {
        return false
    }
    if (mode === 'full') {
        return true
    }
    let hasPart = false
    for (const part of creep.body) {
        if (part.hits <= 0) {
            continue
        }
        hasPart = true
        if (part.type !== MOVE) {
            return false
        }
    }
    return hasPart
}

/**
 * 过滤掉白名单内的敌对 creep，后续威胁分级/目标选择都只看剩下的。
 */
export function filterHostileCreeps(creeps: Creep[]): Creep[] {
    return creeps.filter(creep => !isWhitelistedCreep(creep))
}
