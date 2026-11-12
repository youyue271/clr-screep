// 此文件定义的所有Task执行的func都是绑定在Creep的prototype上的
import {
    containerConcurrency,
    containerWatermark,
    harvestSetting,
    opportunitySetting,
    remoteSetting,
    repairPriority,
    repairSetting,
    storageSetting,
    towerSetting,
    upgradeSetting,
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
            // 坐标后面带上房间名：RoomPosition 不能直接存 Memory，裸坐标又只会按当前房间解释
            taskParam: targetPos
                ? [sourceId, targetPos.x, targetPos.y, room.name]
                : [sourceId, null, null, room.name],
            // 平时每个矿点 1 个采集者；容量 2 是为了换班时新旧 harvester 能同时上岗
            capacity: harvestSetting.capacity,
        })
    }
    return tasks
}

/**
 * 升级任务并发：
 * - 有工地时用 RCL 基准值，保证建造有人干（worker 会先抢 upgrade 再抢 construct）
 * - 工地清零后放开到实际 worker 数，把闲置劳动力转成进度
 */
export function upgradeTaskCapacityOf(room: Room): number {
    const level = room.controller ? room.controller.level : 0
    const base = upgradeTaskCapacity[level] ?? 0
    if (!base) {
        return 0
    }
    let capacity: number
    if (room.find(FIND_CONSTRUCTION_SITES).length > 0) {
        // 有工地时压低升级并发（最多 2 个）：把有能量的 worker 让给建造，
        // 尤其是 priority 1 的 extension 工地；工地清零后再按 worker 数放开。
        capacity = Math.max(1, Math.min(base, 2))
    } else {
        // emptyWorker 只是临时取能状态，按 oldRole 折算回原职业。
        // 归属按出生房（spawnRoom）算：worker 跑出主房时既不占本房容量、
        // 又能一直拿着升级任务位，容量会算少，房里的 worker 反而抢不到任务。
        // 老 creep 可能没有 spawnRoom，退回按当前房间算。
        let workerCount = 0
        for (const name in Game.creeps) {
            const creep = Game.creeps[name]
            const role = creep.memory.role === 'emptyWorker'
                ? creep.memory.oldRole
                : creep.memory.role
            if (role !== 'worker') {
                continue
            }
            const home = creep.memory.spawnRoom || (creep.room && creep.room.name)
            if (home === room.name) {
                workerCount++
            }
        }
        capacity = Math.max(base, Math.min(upgradeSetting.maxCapacity, workerCount))
    }
    return capacity
}

export function upgrade(room: Room): MyTask[] {
    const capacity = upgradeTaskCapacityOf(room)
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
    const maxCarry = room.carrierCapacity()
    const tasks: MyTask[] = []
    for (const containerId of containerIds) {
        const container = room.containerById(containerId)
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
            : Math.max(1, Math.min(maxConcurrency, Math.ceil(usable / maxCarry)))
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
    const maxCarry = room.carrierCapacity()
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
        // 并发按这一堆资源能装满几整车算，大堆掉落物一次派一队人去捡，
        // 小堆仍然只派一个人。上限 opportunitySetting.maxCapacity。
        capacity: Math.max(1, Math.min(opportunitySetting.maxCapacity,
            Math.ceil(candidate.amount / maxCarry)))
    }))
}

/**
 * 房间当前是否真的缺能量：spawn/extension 没满，或者有塔低于补能阈值。
 * 全满时从 storage 取能只会取出来再存回去，属于空转。
 */
function hasLocalEnergyDemand(room: Room): boolean {
    if (room.energyAvailable < room.energyCapacityAvailable) {
        return true
    }
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: (object: any) => object.structureType === STRUCTURE_TOWER
    }) as StructureTower[]
    for (const tower of towers) {
        if (tower.store.getUsedCapacity(RESOURCE_ENERGY)
            < tower.store.getCapacity(RESOURCE_ENERGY) * towerSetting.refillThreshold) {
            return true
        }
    }
    return false
}

export function getStorageEnergy(room: Room): MyTask[] {
    const storage = room.storage
    if (!storage) {
        return []
    }
    // 没有补能需求时不要把 storage 的能量派出去：空闲 carrier 取出来以后
    // 没地方可投，只能原样存回 storage（会在 storage 里进进出出空转）
    if (!hasLocalEnergyDemand(room)) {
        return []
    }
    const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY)
    // storage 是储备，低于保留量不再向外派任务
    const usable = energy - storageSetting.reserveEnergy
    if (usable <= 0) {
        return []
    }
    const maxCarry = room.carrierCapacity()
    const capacity = Math.max(1, Math.min(storageSetting.maxCapacity, Math.ceil(usable / maxCarry)))
    return [{
        taskType: 'energyTask',
        taskFunc: 'getEnergyFromStructure',
        priority: 3,
        taskParam: [storage.id, RESOURCE_ENERGY],
        capacity: capacity
    }]
}

/**
 * 中央 carrier 的常驻搬运任务：中央 link -> storage。
 * 任务形式是通用的 [from, to, resourceType]，work 函数 transferResource 只按参数搬运；
 * 以后新增中转（terminal/lab 等）只需再登记一条同样形状的 transferTask。
 */
export function getCoreLinkTransferTask(room: Room): MyTask[] {
    const link = room.getCoreLink()
    const storage = room.storage
    if (!link || !storage) {
        return []
    }
    return [{
        taskType: 'transferTask',
        taskFunc: 'transferResource',
        taskParam: [link.id, storage.id, RESOURCE_ENERGY],
        // 中转链路优先级最高：中央 link 满了转发就会停，外矿车就投不进来了
        priority: 1,
        // 定点单岗，只给一只 centerCarrier
        capacity: 1,
        persistent: true,
        targetId: link.id,
    }]
}

export function getEnergyTask(room: Room): MyTask[] {
    const containTasks = getContainerEnergy(room)
    // 中央 link 由 centerCarrier 的 transferTask 专职搬，本地 carrier 不再插手
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
 * 能量桶补能任务：一个桶一条，targetId 用桶节点坐标当 key。
 * carrier 只认领桶，桶里哪个 extension 空、要不要换目标由 carryBucket 自己决定。
 */
export function getBucketCarryTask(bucketKey: string): MyTask {
    return {
        taskType: 'bucketCarryTask',
        taskFunc: 'carryBucket',
        taskParam: [bucketKey, RESOURCE_ENERGY],
        priority: 1,
        capacity: 1,
        persistent: true,
        targetId: bucketKey
    }
}

/**
 * 外矿采集任务：一个矿点一条，容量 1（常驻 harvester 一人一矿）。
 * taskParam: [sourceId, 外矿房名, 主房名]
 * sourceId 为 null 的探路任务由房间扩展自己构造。
 */
export function getRemoteHarvestTasks(sourceIds: Id<Source>[], targetRoom: string, homeRoom: string): MyTask[] {
    return sourceIds.map(sourceId => ({
        taskType: 'remoteHarvestTask',
        taskFunc: 'remoteHarvest',
        taskParam: [sourceId, targetRoom, homeRoom],
        priority: 3,
        capacity: 1,
        targetId: sourceId,
    }))
}

/**
 * 外矿运输任务：跟着外矿 container 走，循环往返。
 * taskParam: [外矿 containerId, 外矿房名, 主房名, 主房投递目标, 主房 linkId?]
 * linkId 优先于 sinkId：主房有对应 link 时先丢 link，没有就回退普通投递。
 * capacity 不再固定：登记时按 container 当前能量算，之后每 10 tick 由
 * refreshRemoteCarryCapacity 按"能量 / 房间最大 carry 容量"动态更新。
 */
export function getRemoteCarryTasks(
    containerId: Id<StructureContainer>,
    targetRoom: string,
    homeRoom: string,
    capacity: number,
    sinkId?: Id<any>,
    linkId?: Id<StructureLink>
): MyTask[] {
    return [{
        taskType: 'remoteCarryTask',
        taskFunc: 'remoteCarry',
        taskParam: [containerId, targetRoom, homeRoom, sinkId, linkId],
        priority: 3,
        // 至少 1：刚登记时还没看到 container 就按一辆车算，等有视野再按能量调整
        capacity: Math.max(1, Math.min(remoteSetting.carryMax, capacity)),
        persistent: true,
        targetId: containerId,
    }]
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
