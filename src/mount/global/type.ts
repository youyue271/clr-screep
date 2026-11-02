// 定义指令接口
interface myNode {
    alias: string;
    help: string;
    exec: () => string;
}

/**
 * 房间的堆内存缓存。只存 id / 数字，不存游戏对象引用，
 * 因为每个 tick 的对象都会重建；global 在代码更新时会整体清空，可安全丢弃。
 */
interface RoomGlobalCache {
    terrainMap?:any[]
    energyMap?:any[]
    possibleBase?: any[]
    sources?:any[]
    sourceBFS?:any[]
    controllerBFS?:any[]
    energyExtensionList?: Id<StructureExtension | StructureSpawn>[]
    container?:any[]
    containerCount?: number
    resources?:Resource[]
    controllerProgress?: number

    // 塔用缓存
    threatMode?: 'peace' | 'defend'
    hostileIds?: Id<Creep>[]
    hurtCreepIds?: Id<Creep>[]
    repairQueue?: Id<Structure>[]
    maintenanceQueue?: Id<StructureWall | StructureRampart>[]
    lastThreatScan?: number
    lastRepairScan?: number
    lastMaintenanceScan?: number
    lastEnergyTaskScan?: number
    calmTicks?: number
    // towerId -> 上次请求补能的 tick
    refillTicks?: { [towerId: string]: number }
}

declare var global: {
    room: {
        [p:string]: RoomGlobalCache
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
    debug?: boolean
}
