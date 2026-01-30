// 定义指令接口
interface myNode {
    alias: string;
    help: string;
    exec: () => string;
}

declare var global: {
    room: {
        [p:string]: {
            terrainMap?:any[]
            energyMap?:any[]
            possibleBase?: any[]
            sources?:any[]
            sourceBFS?:any[]
            controllerBFS?:any[]
            spawnList?: [SpawnData?]
            creepTask?: {
                [task in TaskType]: [TaskEntity?]
            }
            container?:any[]
            containerCount?: number
            resources?:Resource[]
            controllerProgress?: number
            // /**
            //  * dataPool用于收集creep工作用的data，由各模块打包好data以后丢进dataPool中
            //  * 在creep free的时候，会检测dataPool是否有空的值
            //  * 然后取出来直接调用
            //  * 对于建筑来说，dataPool存储的是，建筑work方法用到的数据
            //  * 对于建筑，data取出以后存储在Memory.structures中
            //  */
            // dataPool?: {
            //     [role in Role]?: {
            //         listLength: number
            //         bitmap: number
            //         list: {
            //             data: TotalData
            //         }[][]
            //     }
            // }
        }
    }
    lastRecycleTime:number
    currentMenu:string
    currentRoom: Room
    hasExtension:boolean
    cmdList: [string]
    logLevel: string,
    aliasList: [string?]
    nodeList: [myNode[]?]
    currentNodeIndex: number
    helpText: string
}