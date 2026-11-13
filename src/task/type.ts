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
    // 任务创建 tick：spawn 队列用它判断"等能量等了多久"，超时后按现有能量兜底
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
    | 'bucketCarryTask'
    | 'upgradeTask'
    | "constructTask"
    | 'repairTask'
    | 'wallRepairTask'
    | 'energyTask'
    | 'spawnTask'
    | 'remoteHarvestTask'
    | 'remoteCarryTask'
    // 通用建筑间搬运：taskParam = [fromId, toId, resourceType]
    | 'transferTask'
    | 'scoutTask'
    | 'claimTask'
    // 矿物常驻采集：miner 只领这一条
    | 'mineralHarvestTask'
    // 矿物回运：采矿格 container/地上矿堆 -> storage
    | 'mineralCarryTask'
