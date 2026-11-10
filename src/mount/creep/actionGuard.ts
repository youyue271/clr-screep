/**
 * 同 tick 动作守卫。
 *
 * 引擎的 intent 模型（见 src/processor/intents/creeps/intents.js）：
 * 1. 每个 creep 每个动作名只存一个 intent，同名方法后调用覆盖前调用，但两次都返回 OK；
 * 2. 一张 priorities 有向图，低优先级动作会被已存在的高优先级动作挡掉（checkPriorities）；
 * 3. 没有优先级关系的不同动作可以同 tick 一起执行（例如 transfer + withdraw、transfer + drop）。
 *
 * 本守卫的语义是「本 tick 第一个发出的动作粘住」：
 * - 同名动作第二次调用 -> 跳过；
 * - 与已发出动作存在优先级关系（无论谁挡谁）-> 跳过，避免后一个把前一个顶掉，
 *   也避免发出一个引擎根本不会执行的“幻影 OK”；
 * - 无关系的动作照常放行。
 *
 * 标记是自动的：在 Creep.prototype 上包一层，原生方法返回 OK 才记一位，
 * 这样所有现有/未来的动作调用点都不需要手写标记。
 * 判定是 O(1)：每个 creep 一个 32 位掩码，冲突集预计算成位掩码。
 */
export const ACTION_BLOCKED = ERR_BUSY

// 会产生 creep intent 的动作。move/pull 属于移动管线（traffic 依赖 last-wins），
// say 每 tick 多次且纯展示，suicide 是终止动作，都不参与冲突。
export const ACTION_NAMES = [
    'drop', 'transfer', 'withdraw', 'pickup',
    'heal', 'rangedHeal', 'dismantle', 'attack', 'harvest',
    'repair', 'build', 'rangedMassAttack', 'rangedAttack',
    'claimController', 'upgradeController', 'reserveController',
    'attackController', 'generateSafeMode', 'signController',
] as const

export type ActionName = typeof ACTION_NAMES[number]

// 与引擎 src/processor/intents/creeps/intents.js 的 priorities 逐字一致。
// 注意这是有向图不是全序：harvest 和 rangedAttack、rangedAttack 和 heal
// 互不在对方 blockers 里，可以同 tick 执行；压成单个 rank 会误杀。
const BLOCKERS: Record<string, string[]> = {
    rangedHeal: ['heal'],
    attackController: ['rangedHeal', 'heal'],
    dismantle: ['attackController', 'rangedHeal', 'heal'],
    repair: ['dismantle', 'attackController', 'rangedHeal', 'heal'],
    build: ['repair', 'dismantle', 'attackController', 'rangedHeal', 'heal'],
    attack: ['build', 'repair', 'dismantle', 'attackController', 'rangedHeal', 'heal'],
    harvest: ['attack', 'build', 'repair', 'dismantle', 'attackController', 'rangedHeal', 'heal'],
    rangedMassAttack: ['build', 'repair', 'rangedHeal'],
    rangedAttack: ['rangedMassAttack', 'build', 'repair', 'rangedHeal'],
}

export const ACTION_BIT: Record<string, number> = {}
// 对称展开后的冲突集：a 在 b 的 blockers 里，则 a、b 互相冲突。
export const ACTION_CONFLICT: Record<string, number> = {}
// 运行时只查这一个：同名位 | 优先级冲突位。
const ACTION_SELF_CONFLICT: Record<string, number> = {}

ACTION_NAMES.forEach((name, i) => {
    ACTION_BIT[name] = 1 << i
    ACTION_CONFLICT[name] = 0
})
for (const name in BLOCKERS) {
    for (const blocker of BLOCKERS[name]) {
        ACTION_CONFLICT[name] |= ACTION_BIT[blocker]
        ACTION_CONFLICT[blocker] |= ACTION_BIT[name]
    }
}
ACTION_NAMES.forEach(name => {
    ACTION_SELF_CONFLICT[name] = ACTION_BIT[name] | ACTION_CONFLICT[name]
})

function currentMask(creep: Creep): number {
    const c = creep as any
    // creep 对象每 tick 重建；tick 比较兜底，避免复用对象时读到旧掩码
    return c.__actTick === Game.time ? (c.__actMask | 0) : 0
}

export function actedThisTick(creep: Creep): boolean {
    return (creep as any).__actTick === Game.time
}

export function canAct(creep: Creep, name: string): boolean {
    return (currentMask(creep) & (ACTION_SELF_CONFLICT[name] || 0)) === 0
}

function markActed(creep: Creep, name: string): void {
    const c = creep as any
    if (c.__actTick !== Game.time) {
        c.__actTick = Game.time
        c.__actMask = ACTION_BIT[name]
    } else {
        c.__actMask |= ACTION_BIT[name]
    }
}

/**
 * transfer(controller, ENERGY) 在引擎里会转调 upgradeController
 * （game/creeps.js 455-456 行），实际 intent 名是 upgradeController。
 * 判定和标记都必须用有效动作名，否则会错误地占掉 transfer 位。
 */
function effectiveName(name: string, args: any[]): string {
    if (name === 'transfer'
        && args[1] === RESOURCE_ENERGY
        && args[0] && args[0].structureType === STRUCTURE_CONTROLLER) {
        return 'upgradeController'
    }
    return name
}

let installed = false

export function installActionGuard(): void {
    if (installed) {
        return
    }
    installed = true
    for (const name of ACTION_NAMES) {
        const native = (Creep.prototype as any)[name]
        if (typeof native !== 'function') {
            continue
        }
        ;(Creep.prototype as any)[name] = function (this: Creep, ...args: any[]) {
            const effective = effectiveName(name, args)
            if (!canAct(this, effective)) {
                return ACTION_BLOCKED
            }
            const res = native.apply(this, args)
            // 只有 OK 才代表 intent 真的进了引擎；ERR_NOT_IN_RANGE /
            // ERR_NOT_ENOUGH_RESOURCES 等没有 intent，提前标记会误杀后续合法动作。
            if (res === OK) {
                markActed(this, effective)
            }
            return res
        }
    }
}
