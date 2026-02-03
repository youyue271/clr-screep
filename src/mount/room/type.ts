interface RoomMemory {
    timer: {
        [tick: number]: [func?: string, param?: any[]][]
    }

    creepTask?: {
        [task in TaskType]: TaskBucket
    }

    energyList?: Id<StructureExtension | StructureSpawn>[]

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

    globalReset(): void

    energyList(): Id<StructureExtension | StructureSpawn>[]

    addExtensionCarryTasks(structureIds: Id<StructureExtension | StructureSpawn>[]): void

    refreshEnergyCarryTasks(): void

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

    getResources(): Resource

    getContainer(): Id<StructureContainer>

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
