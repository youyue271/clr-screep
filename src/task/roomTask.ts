// 此文件定义的所有Task执行的func都是绑定在Creep的prototype上的
import {upgradeTaskCapacity} from "@/setting";

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
            taskParam: [sourceId, targetPos.x, targetPos.y]
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
            taskParam: [containerId, RESOURCE_ENERGY]
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
            taskParam: [resource.id]
        }))
    }
}

export function getStorageEnergy(room: Room): MyTask[] {
    const storage = room.storage
    console.log(room.storage)
    if (!storage) {
        return []
    } else {
        return [{
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            priority:3, 
            taskParam: [storage.id, RESOURCE_ENERGY]
        }]
    }
}

export function getTombstoneEnergy(room: Room): MyTask[] {
    const tombstones = room.find(FIND_TOMBSTONES)
    if (!tombstones) {
        return []
    } else {
        return tombstones.map(tombstone => ({
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            priority:3, 
            taskParam: [tombstone.id, RESOURCE_ENERGY]
        }))
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

export function createBuildTask(targetList:any[]): MyTask[]{
    return targetList.map(item => {
        return {
            taskType: 'constructTask',
            taskFunc: "buildConstructionSite",
            taskParam: [item.id]
        }
    })
} 
