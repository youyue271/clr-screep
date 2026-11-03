// 此文件定义的所有Task执行的func都是绑定在Creep的prototype上的
import {
    containerConcurrency,
    containerWatermark,
    harvestSetting,
    opportunitySetting,
    repairPriority,
    repairSetting,
    storageSetting,
    upgradeTaskCapacity,
    wallSetting
} from "@/setting";

/**
 * 采集资源Task的包装类, 将room中所有资源转换为采集Task并返回
 * @param room
 */
export function harvestSource(room: Room) {
    const sources = room.sources()
    // TODO: 这里的containerPos是直接返回的数组，需要找到最近的container，大概是一个不超过4的for循环，但是也可以再优化
    const containerPos = room.containerPos().map(item => {
        return room.getPositionAt(item[0], item[1])
    })
    // console.log(containerPos)
    let tasks: MyTask[] = []
    for (const sourceId of sources) {
        const source = Game.getObjectById<Source>(sourceId)
        if (!source) {
            continue
        }
        const pos = source.pos.findInRange(containerPos, 1)
        const targetPos = pos[0]
        tasks.push({
            taskType: 'harvestTask',
            taskFunc: 'harvestSource',
            // 找不到 source 旁的 container / 工地时退化为直接走到 source 旁边采集
            taskParam: targetPos ? [sourceId, targetPos.x, targetPos.y] : [sourceId, null, null],
            // 平时每个矿点 1 个采集者；容量 2 是为了换班时新旧 harvester 能同时上岗
            capacity: harvestSetting.capacity,
        })
    }
    return tasks
}

export function upgrade(room: Room): MyTask[] {
    const capacity = upgradeTaskCapacity[room.controller.level]
    if (!capacity) {
        return []
    }
    return [{
        taskType: 'upgradeTask',
        taskFunc: 'upgrade',
        taskParam: [room.controller.id],
        capacity: capacity,
        persistent: true,
        targetId: room.controller.id
    }]
}

export function construct(ConstructionSiteId: any): MyTask[] {
    return [{
        taskType: 'constructTask',
        taskFunc: 'construct',
        taskParam: [ConstructionSiteId]
    }]
}

export function getContainerEnergy(room: Room): MyTask[] {
    const containerIds = room.getContainer()
    if (!containerIds || !containerIds.length) {
        return []
    }
    const level = room.controller ? room.controller.level : 0
    const watermark = containerWatermark[level] ?? containerWatermark[0]
    const maxConcurrency = containerConcurrency[level] ?? 0
    if (!maxConcurrency) {
        return []
    }
    const avgCarry = room.avgCarrierCapacity()
    const tasks: MyTask[] = []
    for (const containerId of containerIds) {
        const container = Game.getObjectById<StructureContainer>(containerId)
        if (!container) {
            continue
        }
        const energy = container.store.getUsedCapacity(RESOURCE_ENERGY)
        const usable = energy - watermark.low
        // 低于低水位不建任务，留一点缓冲，避免空 container 吸人
        if (usable <= 0) {
            continue
        }
        // 高水位以上并发拉满；介于低/高水位之间按可用能量/平均载重算，
        // 大 carrier 一次能取多，需要的并发自然下降。
        const capacity = energy >= watermark.high
            ? maxConcurrency
            : Math.max(1, Math.min(maxConcurrency, Math.ceil(usable / avgCarry)))
        tasks.push({
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            priority: 2,
            taskParam: [containerId, RESOURCE_ENERGY],
            capacity: capacity
        })
    }
    return tasks
}

/**
 * 掉落物/墓碑的机会队列：都会衰减，不能按固定任务容量管理。
 * 评分越高越优先：量越大、剩余寿命越短、离 spawn 越近。
 * 只保留前 opportunitySetting.maxTasks 条。
 */
export function getOpportunityEnergy(room: Room): MyTask[] {
    const avgCarry = room.avgCarrierCapacity()
    const spawn = room.find(FIND_MY_SPAWNS)[0]
    const candidates: {
        id: Id<any>
        taskFunc: string
        amount: number
        score: number
    }[] = []
    const scoreOf = (amount: number, ticksToDecay: number, distance: number) =>
        amount / ((ticksToDecay + 1) * (10 + distance))
    // 掉落物：直接用 find 拿本 tick 的新鲜对象。
    // global.room 里缓存的 Resource 跨 tick 会失效（id 都读不到），不能用。
    for (const resource of room.find(FIND_DROPPED_RESOURCES)) {
        if (resource.resourceType !== RESOURCE_ENERGY || !resource.amount) {
            continue
        }
        const distance = spawn ? resource.pos.getRangeTo(spawn) : 10
        // @types/screeps 的 Resource 没声明 ticksToDecay，运行时是有的
        const ticksToDecay = (resource as any).ticksToDecay ?? 1000
        candidates.push({
            id: resource.id,
            taskFunc: 'collectEnergy',
            amount: resource.amount,
            score: scoreOf(resource.amount, ticksToDecay, distance)
        })
    }
    // 墓碑：几十 tick 就消失，优先于远处的大堆掉落物
    for (const tombstone of room.find(FIND_TOMBSTONES)) {
        const amount = tombstone.store.getUsedCapacity(RESOURCE_ENERGY)
        if (!amount) {
            continue
        }
        const distance = spawn ? tombstone.pos.getRangeTo(spawn) : 10
        candidates.push({
            id: tombstone.id,
            taskFunc: 'getEnergyFromStructure',
            amount: amount,
            score: scoreOf(amount, tombstone.ticksToDecay ?? 100, distance)
        })
    }
    candidates.sort((a, b) => b.score - a.score)
    return candidates.slice(0, opportunitySetting.maxTasks).map(candidate => ({
        taskType: 'energyTask',
        taskFunc: candidate.taskFunc,
        priority: 1,
        taskParam: [candidate.id, RESOURCE_ENERGY],
        capacity: candidate.amount >= avgCarry ? opportunitySetting.maxCapacity : 1
    }))
}

export function getStorageEnergy(room: Room): MyTask[] {
    const storage = room.storage
    if (!storage) {
        return []
    }
    const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY)
    // storage 是储备，低于保留量不再向外派任务
    const usable = energy - storageSetting.reserveEnergy
    if (usable <= 0) {
        return []
    }
    const avgCarry = room.avgCarrierCapacity()
    const capacity = Math.max(1, Math.min(storageSetting.maxCapacity, Math.ceil(usable / avgCarry)))
    return [{
        taskType: 'energyTask',
        taskFunc: 'getEnergyFromStructure',
        priority: 3,
        taskParam: [storage.id, RESOURCE_ENERGY],
        capacity: capacity
    }]
}

export function getEnergyTask(room: Room): MyTask[] {
    const containTasks = getContainerEnergy(room)
    const opportunityTasks = getOpportunityEnergy(room)
    const storageTasks = getStorageEnergy(room)
    return [...containTasks, ...opportunityTasks, ...storageTasks]
}

// export function getEnergyWithStorage(room: Room): MyTask[] {
//     let tasks = getContainerEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     tasks = getResourceEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     tasks = getStorageEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     return []
// }

// export function getEnergyWithoutStorage(room:Room): MyTask[] {
//     let tasks = getContainerEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     tasks = getResourceEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
// }

export function getCarryList(targetList:Structure[], resourceType:ResourceConstant): MyTask[]{
    return targetList.map(item => {
        return {
            taskType: 'carryTask',
            taskFunc: "carryEnergy",
            taskParam: [item.id, resourceType],
            priority: 1,
            capacity: 1,
            persistent: true,
            targetId: item.id
        }
    })
}

/**
 * 把扫描出的受损建筑转换成 worker 的维修任务。
 * 容量固定为 1，避免同一个建筑上堆太多 worker。
 */
export function getRepairTasks(targetList: Structure[]): MyTask[] {
    return targetList.map(item => ({
        taskType: 'repairTask',
        taskFunc: 'repairStructure',
        priority: repairPriority(item.structureType),
        capacity: repairSetting.capacity,
        persistent: true,
        targetId: item.id,
        taskParam: [item.id],
    }))
}

/**
 * 墙体/防御墙维护任务。和普通维修共用 repairStructure，
 * 但单独放在 wallRepairTask 桶里，数量受 wallSetting.maxTasks 限制。
 */
export function getWallRepairTasks(targetList: Structure[], targetHits: number): MyTask[] {
    return targetList.map(item => ({
        taskType: 'wallRepairTask',
        taskFunc: 'repairStructure',
        priority: item.structureType == STRUCTURE_RAMPART ? 1 : 2,
        capacity: wallSetting.capacity,
        persistent: true,
        targetId: item.id,
        // 第二个参数是维护目标血量：墙/rampart 的 hitsMax 是 3 亿，不能修到满
        taskParam: [item.id, targetHits],
    }))
}

export function createBuildTask(targetList:ConstructionSite[]): MyTask[]{
    return targetList.map(item => {
        let constructionType = item.structureType
        let priority = 3
        // 注意：这里必须用 includes，in 判断的是数组下标而不是元素
        // 前期优先建 spawn/extension（直接决定能孵化多少 creep），container 其次
        const priority1Structures: StructureConstant[] = [STRUCTURE_EXTENSION, STRUCTURE_SPAWN]
        const priority2Structures: StructureConstant[] = [STRUCTURE_TOWER]
        const priority4Structures: StructureConstant[] = [STRUCTURE_ROAD, STRUCTURE_RAMPART, STRUCTURE_WALL]
        if (priority1Structures.includes(constructionType)) {
            priority = 1
        } else if (priority2Structures.includes(constructionType)) {
            priority = 2
        } else if (priority4Structures.includes(constructionType)) {
            priority = 4
        }
        return {
            taskType: 'constructTask',
            taskFunc: "buildConstructionSite",
            taskParam: [item.id],
            priority: priority,
            capacity: 5
        }
    })
} 
