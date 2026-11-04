import {spawnPercent} from "@/setting";

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

    }
}


/**
 //  * 返回harvester的body
 //  * @param room
 //  * @returns
 //  */
const getHarvesterBody = function (room: Room) {
    // CARRY 保持最小：站在 container 上采集时，溢出的能量由引擎自动填进脚下 container，
    // 不需要转身卸货，采集不会被打断。
    const energyBase = Math.min(room.energyAvailable, room.energyCapacityAvailable * spawnPercent)
    let num = Math.floor((energyBase - 50) / 250)
    if (num > 3) {
        num = 3
    }
    if (num <= 0) {
        num = 1
    }
    return calcBodyPart({[CARRY]: 1, [WORK]: 2 * num, [MOVE]: num})
}

const getCarrierBody = function (room: Room) {
    let body: any[];
    const energyBase = Math.min(room.energyAvailable, room.energyCapacityAvailable * spawnPercent)
    let num = Math.floor(energyBase / 100)
    if (num > 25) num = 25
    if (num <= 0) num = 1
    body = calcBodyPart({[CARRY]: num, [MOVE]: num})
    return body
}

const getWorkerBody = function (room: Room) {
    let body: any[];
    let num = Math.floor((room.energyCapacityAvailable * spawnPercent - 150) / 150);
    if (num > 23) num = 23
    if (num <= 0) num = 1
    body = calcBodyPart({[CARRY]: 3, [WORK]: num, [MOVE]: num})
    return body
}


const getClaimerBody = function (room: Room) {
    let body: any[]
    let num = Math.floor((room.energyCapacityAvailable * spawnPercent) / 750);
    if (num > 12) num = 12
    if (num <= 0) num = 1
    body = calcBodyPart({[CLAIM]: num, [MOVE]: num * 3})
    return body
}

const getAttackerBody = function (room: Room) {
    let body: any[]
    let num = Math.floor((room.energyCapacityAvailable * spawnPercent) / 200);
    if (num > 10) num = 10
    if (num <= 0) num = 1
    body = calcBodyPart({[TOUGH]: num * 2, [MOVE]: num * 2, [ATTACK]: num})
    return body
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
