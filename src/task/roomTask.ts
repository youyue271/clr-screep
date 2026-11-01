// 此文件定义的所有Task执行的func都是绑定在Creep的prototype上的
import {repairPriority, repairSetting, upgradeTaskCapacity, wallSetting} from "@/setting";

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
            taskParam: targetPos ? [sourceId, targetPos.x, targetPos.y] : [sourceId, null, null]
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
    if(!containerIds){
        return []
    } else {
        return containerIds.map(containerId => ({
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            priority: 2,
            taskParam: [containerId, RESOURCE_ENERGY],
            capacity:10
        }))
    }

}

export function getResourceEnergy(room: Room): MyTask[] {
    const resources = room.getResources()
    if (!resources) {
        return []
    } else {
        return resources.map(resource => ({
            taskType: 'energyTask',
            taskFunc: 'collectEnergy',
            priority: 1,
            taskParam: [resource.id],
            capacity: 3
        }))
    }
}

export function getStorageEnergy(room: Room): MyTask[] {
    const storage = room.storage
    if (!storage) {
        return []
    } else {
        return [{
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            priority:3, 
            taskParam: [storage.id, RESOURCE_ENERGY],
            capacity:5
        }]
    }
}

export function getTombstoneEnergy(room: Room): MyTask[] {
    const tombstones = room.find(FIND_TOMBSTONES)
    if (!tombstones) {
        return []
    } else {
        return tombstones.filter(tombstone => tombstone.store['energy']).map(tombstone => {
            return {
                taskType: 'energyTask',
                taskFunc: 'getEnergyFromStructure',
                priority:3, 
                taskParam: [tombstone.id, RESOURCE_ENERGY],
                capacity: 1
            }
        })
    }
}

export function getEnergyTask(room: Room): MyTask[] {
    let containTasks = getContainerEnergy(room)

    let resourceTasks = getResourceEnergy(room)

    let storageTasks = getStorageEnergy(room)

    let tombstonesTasks = getTombstoneEnergy(room)

    return [...containTasks, ...resourceTasks, ...storageTasks, ...tombstonesTasks]
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
        const priority1Structures: StructureConstant[] = [STRUCTURE_EXTENSION, STRUCTURE_SPAWN, STRUCTURE_CONTAINER]
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
