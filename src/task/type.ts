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
    // 上次看到的可用能量高水位：能量还在增长说明房间正在回血，先不兜底
    queuedEnergy?: number
    // 任务首次入队 tick：兜底判断的总时长硬上限，避免房间缓慢回血时无限等待
    createdAt?: number
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
    | 'scoutTask'
    | 'claimTask'
