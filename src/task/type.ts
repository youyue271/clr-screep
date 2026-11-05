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
    // 任务创建 tick：spawn 队列用它判断"等能量等了多久"，超时后按现有能量兜底缩小体型
    queuedAt?: number
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
    | 'repairTask'
    | 'wallRepairTask'
    | 'energyTask'
    | 'spawnTask'
    | 'remoteHarvestTask'
    | 'remoteCarryTask'
    | 'scoutTask'
