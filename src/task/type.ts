interface MyTask {
    taskType: TaskType
    taskFunc: string
    taskParam: any[]
}

interface TaskEntity {
    taskFunc: string
    taskParam: any[]
}



type TaskType = 'workTask'
    | 'harvestTask'
    | 'carryTask'
    | 'upgradeTask'
    | "constructTask"
    | 'energyTask'
