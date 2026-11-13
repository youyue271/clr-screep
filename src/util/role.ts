/**
 * creep 的稳定身份：出生职业。
 *
 * 名字在孵化时由 role + Game.time 生成（spawn.ts），之后不会改；
 * 临时岗位（emptyWorker / sleep / remoteCarrier 转职）只改 memory.role。
 * 所以人数统计、死亡补员按名字解析出生职业，任务分配仍看 memory.role。
 *
 * 解析方式：剥掉尾部 tick 数字后和角色全名精确匹配。
 * 必须精确匹配，不能按前缀，否则 carrier 会吃掉 remoteCarrier、harvester 会吃掉 remoteHarvester。
 */
const BASE_ROLES: Role[] = [
    'remoteHarvester',
    'remoteCarrier',
    'centerCarrier',
    'emptyWorker',
    'harvester',
    'carrier',
    'claimer',
    'attacker',
    'viewer',
    'worker',
    'miner',
    'sleep',
]

export function baseRoleOf(name: string): Role | undefined {
    const trimmed = name.replace(/\d+$/, '')
    // 名字没有 tick 后缀：不是本 bot 按约定孵化的 creep，交给调用方兜底
    if (trimmed === name) {
        return undefined
    }
    for (const role of BASE_ROLES) {
        if (role === trimmed) {
            return role
        }
    }
    return undefined
}
