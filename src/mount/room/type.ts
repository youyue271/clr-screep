/**
 * 外矿计划存顶层 Memory（不存 Room.memory）：
 * globalInit 每次推代码都会 delete Memory.rooms，只有顶层键能活下来。
 */
interface RemoteSourceState {
    containerId?: Id<StructureContainer>
    containerPos?: [number, number]
}

interface RemoteRoomState {
    enabled?: boolean
    sources?: { [sourceId: string]: RemoteSourceState }
}

interface RemotePlan {
    enabled?: boolean
    // 调试/测试用：忽略"富余能量"门槛，强制孵化外矿 harvester
    force?: boolean
    rooms: { [roomName: string]: RemoteRoomState }
}

interface Memory {
    // 主房名 -> 外矿计划
    remotePlan?: { [homeRoom: string]: RemotePlan }
}

interface RoomMemory {
    timer: {
        [tick: number]: [func?: string, param?: any[]][]
    }

    creepTask?: {
        [task in TaskType]: TaskBucket
    }

    lastEnergyTaskTick?: number

    roomPlanType?: number
    roomType?: number
    plan1Pos?: [number, number]
    plan2Pos?: {
        core: [number, number]
        ext1: [number, number]
        ext2: [number, number]
        lab: [number, number]
    }
    containerPos?: any[]
    // 按 sourceId 缓存矿点 container 位置，避免 sources 顺序变化导致换点
    containerPosById?: { [sourceId: string]: [number, number] }
    // 布局时计算的 spawn -> 矿点路径长度（tile 数），用于 harvester 提前换班
    harvestSpawnDistance?: { [sourceId: string]: number }
    harvestSpawnPos?: [number, number]
}

interface Room {

    /**
     * 初始化部分
     */
    init(): void

    initCarryList(): void

    initResource(): void

    initCreepRecycle(): void

    globalReset(): void

    normalizeTaskBuckets(taskType: TaskType): TaskBucket

    /**
     * 按布局集群顺序返回 spawn/extension 的固定 id 列表
     */
    energyStructureOrder(): Id<StructureSpawn | StructureExtension>[]

    /**
     * 新建/拆除后重建能量结构顺序表
     */
    refreshEnergyStructures(): void

    /**
     * 把新建的 spawn/extension 登记进顺序表
     */
    registerEnergyStructure(id: Id<StructureSpawn | StructureExtension>): void

    /**
     * 按固定顺序挑出刚好够 cost 的结构；usedIds 是实际贡献能量的结构
     */
    pickEnergyStructures(cost: number): {
        structures: (StructureSpawn | StructureExtension)[]
        usedIds: Id<StructureSpawn | StructureExtension>[]
    } | undefined

    /**
     * spawn 成功后 +1 tick 给被扣能量的结构登记 carry 任务
     */
    refillAfterSpawn(structureIds: Id<StructureSpawn | StructureExtension>[]): void

    addExtensionCarryTasks(structureIds: Id<StructureExtension | StructureSpawn>[]): void

    ensureEnergyCarryTask(structureId: Id<AnyStoreStructure>): void

    refreshEnergyCarryTasks(): void

    /**
     * 定期把新出现的能量来源（container / 掉落物 / storage / tombstone）补进 energyTask
     */
    refreshEnergyTasks(): void

    /**
     * 按工地状态同步升级任务的并发数
     */
    refreshUpgradeTask(): void

    /**
     * 同步外矿采集/运输任务（任务统一登记在主房队列）
     */
    refreshRemoteTasks(): void

    /**
     * 按富余能量门槛孵化外矿 harvester
     */
    refreshRemoteSpawn(): void

    /**
     * 房间环境扫描（敌对/受伤/维修队列），结果缓存在 global.room
     */
    scan(): void

    dropRepairTarget(id: Id<Structure>): void

    syncRepairTasks(): void

    syncWallRepairTasks(): void

    /**
     * 确保某个矿点有 harvester（换班/死亡补员用）
     */
    ensureHarvesterForSource(sourceId: Id<Source>): boolean

    /**
     * 初始化Spawn列表
     */
    initSpawnList(): void

    /**
     * 对添加孵化列表的简单封装
     * @param role
     */
    addToSpawnList(role: Role, sourceId?: Id<Source>): void

    /**
     * event相关
     */
    hello(): void

    registEvent(event: myEvent): void

    runEvent(): void

    buildOver(x: number, y: number): void

    checkRoomLevel(): void

    /**
     * task相关
     */

    registTask(tasks: MyTask[]): void

    /**
     * 房间缓存
     */
    calSourceMap(): void

    sources(): any[]

    getResources(): Resource[]

    getContainer(): Id<StructureContainer>[]

    refreshContainers(): Id<StructureContainer>[]

    avgCarrierCapacity(): number

    containerPos(): any[]


    /**
     * autoPlan相关
     */
    checkError(): void

    loadTerrain(): void

    calDistance(x: number, y: number): any[]

    getBiggestSquare(threshold: number): void

    visualizeMap(map: any[]): void

    calPerfectBasePos(): any[]

    visualize(level?: number): void

    showRoomPlan(): void

    construct(level: number): void
}
