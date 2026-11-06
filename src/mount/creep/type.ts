interface CreepMemory {
    role: Role
    oldRole?: Role
    working: boolean
    spawnRoom: string
    currentWork?: TaskEntity
    currentWorkType?: TaskType
    reSpawn: boolean
    // 提前换班的 harvester 孵化时指定的矿点，保证接替的是同一个矿
    harvestSourceId?: Id<Source>
    // 外矿房停用（敌对/被别人占用/已移出计划）后的召回标记：
    // creep 交还任务回主房原地待命到死，不再被算作该矿点的覆盖
    recall?: boolean
    // 外矿 carrier 往返标记：已经离开外矿房、正在往回走
    remoteReturn?: boolean
    // 侦察兵当前要探的房间；探完清空，等待新目标
    scoutTarget?: string
    // claimer 孵化时绑定的目标房（显式 claim 或外矿保留），
    // 每个目标房常驻一只，避免一只 claimer 在多房间之间来回跑
    claimerTarget?: string
}

type Role = 'worker'
    | 'carrier'
    | 'harvester'
    | 'emptyWorker'
    | 'remoteHarvester'
    // 外矿专用运输：只领 remoteCarryTask，不和本地 carrier 抢补能任务
    | 'remoteCarrier'
    // 侦察兵：只有 MOVE 部件，负责探明相邻外矿房并写情报
    | 'viewer'
    // 占领/保留控制器：CLAIM + MOVE，reserve 由它自动续，claim 只执行显式 claimPlan
    | 'claimer'

interface Creep {

    /**
     * creep的工作函数，自循环减少了完成工作时候的1tick延迟
     */
    work(): void

    /**
     * 如果getWork成功，新工作存入creep的currentWork中
     * 否则，表示creep角色对应的所有工作都做完了
     */
    getWork(): boolean

    /**
     * 主要用于调配相近部件creep的数量关系
     */
    changeRole(role:Role): boolean
    releaseCurrentWork(): void
    removeCurrentWorkFromQueue():void
    /**
     * 采能量矿逻辑
     * @param sourceId
     * @param containerPosX
     * @param ContainerPosY
     */
    harvestSource(sourceId: Id<any>, containerPosX?:number, ContainerPosY?:number): boolean
    getEnergyFromStructure(id: Id<any>, energyType: ResourceConstant): boolean
    collectEnergy(id: Id<any>): boolean
    upgrade(controllerId: Id<StructureController>): boolean
    remember(): void
    carryEnergy(targetId: Id<any>, resourceType: ResourceConstant): boolean
    buildConstructionSite(constructionId: Id<any>):boolean
    /**
     * 按房间名走到目标房间。没有视野时用房间出口导航，只支持相邻房间
     */
    moveToRoom(roomName: string): boolean
    /**
     * 外矿常驻采集：到矿点后站 container 上采，矿点空了顺手修 container。
     * 这个任务一直持有到 creep 死亡，永远返回 false。
     */
    remoteHarvest(sourceId: Id<Source> | null, targetRoom: string, homeRoom: string): boolean
    /**
     * 外矿运输：去外矿 container 取能，回到主房投递后才结束任务。
     */
    remoteCarry(containerId: Id<StructureContainer>, targetRoom: string, homeRoom: string, sinkId?: Id<any>): boolean
    /**
     * 侦察兵常驻任务：探明相邻房间并写情报；没有目标时原地随机走，等新任务。
     * 一直返回 false，只有主房关掉外矿时才回主房释放任务。
     */
    scout(homeRoom: string): boolean
}