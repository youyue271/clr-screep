interface RoomMemory {
    timer: {
        [tick: number]: [func?: string, param?: any[]][]
    }

    creepTask?: {
        [task in TaskType]: TaskBucket
    }

    energyList?: Id<StructureExtension>[]
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
}

interface Room {

    /**
     * 初始化部分
     */
    init(): void

    initCarryList(): void

    initResource(): void

    initEnergyList(): void
    
    initCreepRecycle(): void

    globalReset(): void

    normalizeTaskBuckets(taskType: TaskType): TaskBucket

    energyList(): Id<StructureExtension >[]

    addExtensionCarryTasks(structureIds: Id<StructureExtension | StructureSpawn>[]): void

    ensureEnergyCarryTask(structureId: Id<AnyStoreStructure>): void

    refreshEnergyCarryTasks(): void

    /**
     * 房间环境扫描（敌对/受伤/维修队列），结果缓存在 global.room
     */
    scan(): void

    dropRepairTarget(id: Id<Structure>): void

    syncRepairTasks(): void

    /**
     * 初始化Spawn列表
     */
    initSpawnList(): void

    /**
     * 对添加孵化列表的简单封装
     * @param role
     */
    addToSpawnList(role: Role): void

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
