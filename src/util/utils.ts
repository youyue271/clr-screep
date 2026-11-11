import {spawnPercent, spawnPercentFull} from "@/setting";

/**
 * 把 obj2 的原型合并到 obj1 的原型上
 * 如果原型的键以 Getter 结尾，则将会把其挂载为 getter 属性
 * @param obj1 要挂载到的对象
 * @param obj2 要进行挂载的对象
 */
export const assignPrototype = function (obj1: { [key: string]: any }, obj2: { [key: string]: any }) {
    Object.getOwnPropertyNames(obj2.prototype).forEach(key => {
        if (key.includes('Getter')) {
            Object.defineProperty(obj1.prototype, key.split('Getter')[0], {
                get: obj2.prototype[key],
                enumerable: false,
                configurable: true
            })
        } else obj1.prototype[key] = obj2.prototype[key]
    })
}

/**
 * 根据身体配置生成完成的身体数组
 * cpu 消耗: 0.028 左右
 *
 * @param bodySet 身体部件配置对象
 */
export function calcBodyPart(bodySet: BodySet): BodyPartConstant[] {
    // 把身体配置项拓展成如下形式的二维数组
    // [ [ TOUGH ], [ WORK, WORK ], [ MOVE, MOVE, MOVE ] ]
    const bodys = Object.keys(bodySet).map(type => Array(bodySet[type]).fill(type))
    // 把二维数组展平
    return [].concat(...bodys)
}

/**
 * creep 走一格需要的 tick 数。
 * 每 tick 恢复 2 * MOVE 数量点疲劳，走一格增加 (总部件数 - MOVE 数) 点疲劳。
 */
export function calcTicksPerTile(body: BodyPartConstant[]): number {
    const moveParts = body.filter(part => part === MOVE).length
    if (!moveParts) {
        return 20
    }
    const weight = body.length - moveParts
    return Math.max(1, Math.ceil(weight / (moveParts * 2)))
}

/**
 * 单个 spawn 孵化这个身体需要的 tick 数
 */
export function calcSpawnTicks(body: BodyPartConstant[]): number {
    return body.length * CREEP_SPAWN_TIME
}

export function CalBodyCost(bodys: BodyPartConstant[]) {
    let cost = 0
    if (!bodys) {
        console.log("怎么会有空的bodys？")
        return
    }
    for (let body of bodys) {
        cost += BODYPART_COST[body]
    }
    return cost
}

/**
 *
 * @param role
 * @param room
 */
export function getBody(role: CreepRoleConstant, room: Room): BodyPartConstant[] {
    switch (role) {
        case 'harvester':
            return getHarvesterBody(room)
        case 'carrier':
            return getCarrierBody(room)
        case 'worker':
            return getWorkerBody(room)
        case 'claimer':
            return getClaimerBody(room)
        case 'attacker':
            return getAttackerBody(room)
        case 'viewer':
            return getViewerBody(room)
        case 'remoteBuilder':
            return getWorkerBody(room)
        case 'remoteHarvester':
            // 外矿和主房一样是站在 container 上采，body 直接复用
            return getHarvesterBody(room)
        case 'remoteCarrier':
            // 外矿运输和本地 carrier 一样是纯搬货，body 直接复用
            return getCarrierBody(room)
        case 'centerCarrier':
            // 定点短途：固定 8 CARRY + 2 MOVE，一次搬 400，不随房间容量放大
            return getCenterCarrierBody()

    }
}

/**
 * 中央 carrier 体型：站在 link/storage/terminal 中间不动，只在中转之间来回搬。
 * 8 CARRY = 400 一次搬半条 link，2 MOVE 保证调位（terminal 不在贴身格时）不拖慢。
 */
const getCenterCarrierBody = function (): BodyPartConstant[] {
    return calcBodyPart({[CARRY]: 8, [MOVE]: 2})
}


// 1 CARRY + 2n WORK + n MOVE = 3n + 1 个部件，受 50 部件上限约束：n 最大 16（49 部件）。
// WORK 越多单位时间采得越快；矿采空后 harvester 会进 sleep 角色等矿重生，
// 所以大体型只在矿满时爆发采集，不会有"多出来的 WORK 白烧"的问题。
const HARVEST_MAX_NUM = 16

/**
 //  * 返回harvester的body
 //  * @param room
 //  * @returns
 //  */
const getHarvesterBody = function (room: Room) {
    // CARRY 保持最小：站在 container 上采集时，溢出的能量由引擎自动填进脚下 container，
    // 不需要转身卸货，采集不会被打断。
    // 体型按「容量」而不是当前存量算：harvester 寿命长，按当前能量算会在低能量时
    // 孵出最小体型，形成“能量低 → 弱 harvester → 能量更低”的死循环。
    // spawn 会等能量攒够再孵化，换班余量（孵化 + 路程 + 15 tick）足够。
    const energyBase = room.energyCapacityAvailable
    let num = Math.floor((energyBase - 50) / 250)
    if (num > HARVEST_MAX_NUM) {
        num = HARVEST_MAX_NUM
    }
    if (num <= 0) {
        num = 1
    }
    return calcBodyPart({[CARRY]: 1, [WORK]: 2 * num, [MOVE]: num})
}

/**
 * 本房某一类角色的存活数量。emptyWorker 只是临时取能状态，按 oldRole 统计。
 * 用来决定体型档位：还有同类活着就拉满，一只不剩（空窗）才用救急体型。
 */
function countHomeRole(room: Room, roles: string[]): number {
    let count = 0
    for (const name in Game.creeps) {
        const creep = Game.creeps[name]
        const home = creep.memory.spawnRoom || creep.room.name
        if (home !== room.name) {
            continue
        }
        const role = creep.memory.role === 'emptyWorker'
            ? (creep.memory.oldRole ?? creep.memory.role)
            : creep.memory.role
        if (role && roles.includes(role)) {
            count++
        }
    }
    return count
}

/** 还有同类存活就按满体型算；一只不剩时退回救急体型，先补出第一只再说。 */
function bodyPercent(room: Room, roles: string[]): number {
    return countHomeRole(room, roles) > 0 ? spawnPercentFull : spawnPercent
}

const getCarrierBody = function (room: Room) {
    let body: any[];
    // 和 worker/harvester 一致：按容量算，避免低能量时孵出 1 CARRY 的“残废” carrier，
    // 一次只能搬 50 能量、来回跑断腿。有同类存活时拉满，空窗时才用救急体型。
    const energyBase = room.energyCapacityAvailable * bodyPercent(room, ['carrier', 'remoteCarrier'])
    let num = Math.floor(energyBase / 100)
    if (num > 25) num = 25
    if (num <= 0) num = 1
    body = calcBodyPart({[CARRY]: num, [MOVE]: num})
    return body
}

const getWorkerBody = function (room: Room) {
    let body: any[];
    const budget = room.energyCapacityAvailable * bodyPercent(room, ['worker'])
    let num = Math.floor((budget - 150) / 150);
    if (num > 23) num = 23
    if (num <= 0) num = 1
    body = calcBodyPart({[CARRY]: 3, [WORK]: num, [MOVE]: num})
    return body
}


// 控制器等级 -> claimer 的 CLAIM 部件数。
// 保留每 tick 只加 CLAIM 部件数（净增 = 部件数 - 1），部件越多缓冲涨得越快；
// 占领本身只需要 1 个 CLAIM，所以低 RCL 先用 1 个把活干起来。
const claimerPartsByLevel = [0, 1, 1, 1, 2, 2, 2, 3, 4]

export const getClaimerBody = function (room: Room) {
    const level = room.controller?.level ?? 0
    let num = claimerPartsByLevel[level] ?? 1
    if (num <= 0) num = 1
    // 当前容量买不起时逐级下调，避免孵不出来把队列堵死
    while (num > 1 && CalBodyCost(calcBodyPart({[CLAIM]: num, [MOVE]: num})) > room.energyCapacityAvailable) {
        num -= 1
    }
    // MOVE 与 CLAIM 等量：每格疲劳 = CLAIM 数，每 tick 恢复 2×MOVE，移速稳定 1 tile/tick
    return calcBodyPart({[CLAIM]: num, [MOVE]: num})
}

const getAttackerBody = function (room: Room) {
    // 反击队：ATTACK + MOVE 1:1，无疲劳、跑得快。
    // 每对 130 能量、30 DPS，上限 5 对（650 能量，150 DPS），够清 1-2 只弱敌。
    let num = Math.floor(room.energyCapacityAvailable / 130)
    if (num > 5) num = 5
    if (num <= 0) num = 1
    return calcBodyPart({[MOVE]: num, [ATTACK]: num})
}

/**
 * 兜底体型：按当前可用能量算一个刚好买得起的身体。
 * 正常孵化仍然走 getBody 按容量算体型（避免低能量时孵出弱 creep）；
 * 这里只给 spawn 队列在"等能量等太久"时保底用，保证房间至少能孵出一个 creep 破局。
 * 连最小体型都买不起时返回 undefined。
 */
export function getBodyForEnergy(role: CreepRoleConstant, room: Room, energy: number): BodyPartConstant[] | undefined {
    const budget = Math.min(energy, room.energyCapacityAvailable)
    switch (role) {
        case 'harvester':
        case 'remoteHarvester': {
            // 和 getHarvesterBody 同构，只是能量基准换成当前可用量
            const num = Math.floor((budget - 50) / 250)
            if (num <= 0) {
                return undefined
            }
            const capped = Math.min(num, HARVEST_MAX_NUM)
            return calcBodyPart({[CARRY]: 1, [WORK]: 2 * capped, [MOVE]: capped})
        }
        case 'carrier':
        case 'remoteCarrier': {
            const num = Math.floor(budget / 100)
            if (num <= 0) {
                return undefined
            }
            return calcBodyPart({[CARRY]: Math.min(num, 25), [MOVE]: Math.min(num, 25)})
        }
        case 'centerCarrier': {
            // 兜底体型：正常 500 的固定体型买不起时缩到 4 CARRY，仍能搬货
            if (budget >= 500) {
                return getCenterCarrierBody()
            }
            if (budget >= 300) {
                return calcBodyPart({[CARRY]: 4, [MOVE]: 2})
            }
            return undefined
        }
        case 'worker':
        case 'remoteBuilder': {
            const num = Math.floor((budget - 150) / 150)
            if (num <= 0) {
                return undefined
            }
            return calcBodyPart({[CARRY]: 3, [WORK]: Math.min(num, 23), [MOVE]: Math.min(num, 23)})
        }
        case 'viewer':
            return budget >= 100 ? calcBodyPart({[MOVE]: 2}) : undefined
        case 'claimer': {
            const level = room.controller?.level ?? 0
            let num = claimerPartsByLevel[level] ?? 1
            if (num <= 0) num = 1
            while (num > 1 && CalBodyCost(calcBodyPart({[CLAIM]: num, [MOVE]: num})) > budget) {
                num -= 1
            }
            const body = calcBodyPart({[CLAIM]: num, [MOVE]: num})
            return CalBodyCost(body) <= budget ? body : undefined
        }
        case 'attacker': {
            let num = Math.floor(budget / 130)
            if (num > 5) num = 5
            return num > 0 ? calcBodyPart({[MOVE]: num, [ATTACK]: num}) : undefined
        }
        default:
            return undefined
    }
}

const getViewerBody = function (room: Room) {
    let body: any[]
    // 侦察兵只要移动：2 个 MOVE 走 2 格/tick，100 能量，探完原地待命
    body = calcBodyPart({[MOVE]: 2})
    return body
}


export function initializeArray(rows: number, cols: number) {
    let array = [];
    for (let i = 0; i < rows; i++) {
        array[i] = [];
        for (let j = 0; j < cols; j++) {
            array[i][j] = 0;
        }
    }
    return array;
}


// /**
//  * 参考linux内核优先级队列
//  * 使用位图计算最高优先级数组对应的下标.下标越低优先级越高，从0开始
//  * @param x 输入的位图数字
//  * @return 返回优先级数组的索引
//  */
// export function findFirstBit(x: number): number {
//     let r = 0
//     // console.log("find first bit", x, r)
//     if (!(x & 0xf)) {
//         x >>= 4
//         r += 4
//     }
//     // console.log("find first bit", x, r)
//     if (!(x & 3)) {
//         x >>= 2
//         r += 2
//     }
//     // console.log("find first bit", x, r)
//     if (!(x & 1)) {
//         r += 1
//     }
//     // console.log("find first bit", x, r)
//     return r;
// }
//
// /**
//  * 将data push入data池，并添加相应的优先级以及计数
//  * @param role 对应的角色
//  * @param data CreepData
//  * @param priority 对应的优先级，从0到3，越小优先级越高
//  */
// export function pushPool(role: DataConstant, data: TotalData, priority: number = 1) {
//     // console.log(role)
//     if(this.memory.dataPool[role]==undefined) {
//         this.memory.dataPool[role].listLength = 1
//     } else {
//         this.memory.dataPool[role].listLength += 1
//     }
//
//     if(!this.memory.dataPool[role].list[priority]) {
//         this.memory.dataPool[role].list[priority] = []
//     }
//     this.memory.dataPool[role].list[priority].push({
//         data: data,
//     })
//     this.memory.dataPool[role].bitmap |= Math.pow(2, priority)
// }
//
// /**
//  * 从data池中查找当前优先度最高的列表中的data给creep
//  * 没有处理列表为空的时候的情况
//  * 当列表为空的时候会返回undefined
//  * @param role 对应的role
//  */
// export function popPool(role: DataConstant) {
//     if (this.memory.dataPool[role].listLength == 0) {
//         return
//     } else {
//         let priority = findFirstBit(this.memory.dataPool[role].bitmap)
//         // console.log("priority", this.memory.dataPool[role].listLength, priority, this.memory.dataPool[role].bitmap)
//         if(priority>4) {
//             return
//         }
//         this.memory.dataPool[role].listLength -= 1
//
//         let data = this.memory.dataPool[role].list[priority].shift().data
//         if (this.memory.dataPool[role].list[priority].length == 0) {
//             this.memory.dataPool[role].bitmap &= ~(1 << priority)
//         }
//         return data
//     }
// }
//
// export function getPool(role: DataConstant) {
//     if (this.memory.dataPool[role].listLength == 0) {
//         return
//     } else {
//         let priority = findFirstBit(this.memory.dataPool[role].bitmap)
//         // console.log("priority", this.memory.dataPool[role].listLength, priority, this.memory.dataPool[role].bitmap)
//         if(priority>4) {
//             return
//         }
//         let data = this.memory.dataPool[role].list[priority][0].data
//         return data
//     }
//
// }
