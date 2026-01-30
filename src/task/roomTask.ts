// 此文件定义的所有Task执行的func都是绑定在Creep的prototype上的
import {upgradeTaskNum} from "@/setting";

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
        const pos = Game.getObjectById<Source>(sourceId).pos.findInRange(containerPos, 1)
        tasks.push({
            taskType: 'harvestTask',
            taskFunc: 'harvestSource',
            taskParam: [sourceId, pos[0].x, pos[0].y]
        })
    }
    return tasks
}

export function upgrade(room: Room): MyTask[] {
    let tasks: MyTask[] = []
    for (let i = 0; i < upgradeTaskNum[room.controller.level]; i++) {
        tasks.push({
            taskType: 'upgradeTask',
            taskFunc: 'upgrade',
            taskParam: [room.controller.id]
        })
    }
    return tasks
}

export function construct(ConstructionSiteId: any): MyTask[] {
    return [{
        taskType: 'constructTask',
        taskFunc: 'construct',
        taskParam: [ConstructionSiteId]
    }]
}

export function getContainerEnergy(room: Room): MyTask[] {
    const containerId = room.getContainer()
    if(!containerId){
        return []
    } else {
        return [{
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            taskParam: [containerId, RESOURCE_ENERGY]
        }]
    }

}

export function getResourceEnergy(room: Room): MyTask[] {
    const resource = room.getResources()
    if (!resource) {
        return []
    } else {
        return [{
            taskType: 'energyTask',
            taskFunc: 'collectEnergy',
            taskParam: [resource.id]
        }]
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
            taskParam: [storage.id, RESOURCE_ENERGY]
        }]
    }
}

export function getEnergyWithStorage(room: Room): MyTask[] {
    let tasks = getContainerEnergy(room)
    if (tasks.length) {
        return tasks
    }
    tasks = getResourceEnergy(room)
    if (tasks.length) {
        return tasks
    }
    tasks = getStorageEnergy(room)
    if (tasks.length) {
        return tasks
    }
    return []
}

export function getEnergyWithoutStorage(room:Room): MyTask[] {
    let tasks = getContainerEnergy(room)
    if (tasks.length) {
        return tasks
    }
    tasks = getResourceEnergy(room)
    if (tasks.length) {
        return tasks
    }
}

export function getCarryList(targetList:any[], resourceType:ResourceConstant): MyTask[]{
    return targetList.map(item => {
        return {
            taskType: 'carryTask',
            taskFunc: "carryEnergy",
            taskParam: [item.id, resourceType]
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