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
    // 按布局集群顺序排好的 spawn/extension id，spawn 孵化时按这个顺序扣能量
    energyStructureOrder?: Id<StructureSpawn | StructureExtension>[]
    lastEnergyStructureScan?: number
    // container 列表改为带时间戳的缓存，不再取到一次就永久锁死
    lastContainerScan?: number
    // 存活 carrier 的平均载重（同 tick 内复用）
    avgCarrierCapacity?: number
    avgCarrierCapacityTick?: number
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
