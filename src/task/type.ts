interface MyTask {
    taskType: TaskType
    taskFunc: string
    taskParam: any[]
    priority?: number
    capacity?: number
    persistent?: boolean
    targetId?: string
}

interface TaskEntity {
    id: string
    taskFunc: string
    taskParam: any[]
    priority: number
    capacity: number
    persistent: boolean
    targetId?: string
    reservedBy: {
        name: string
        lastTick: number
    }[]
}

type TaskBucket = {
    [priority: string]: TaskEntity[]
}



type TaskType = 'workTask'
    | 'harvestTask'
    | 'carryTask'
    | 'upgradeTask'
    | "constructTask"
    | 'energyTask'
    | 'spawnTask'
