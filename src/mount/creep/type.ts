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
    // 外矿运输车孵化时绑定的矿点/外矿房：只领这个矿点 container 的回运任务，
    // 按"每个矿一只"专门孵化，不再由本地 carrier 转换而来
    remoteCarrySourceId?: Id<Source>
    remoteCarryRoom?: string
    // 外矿房停用（敌对/被别人占用/已移出计划）后的召回标记：
    // creep 交还任务回主房原地待命到死，不再被算作该矿点的覆盖
    recall?: boolean
    // 外矿 carrier 往返标记：已经离开外矿房、正在往回走
    remoteReturn?: boolean
    // 外矿 carrier 回主房后 link 已满、正在等空位的连续 tick 数；
    // 超过 remoteSetting.linkFullWaitTicks 才退回 drop 暂存
    linkWaitTicks?: number
    // 外矿 container 已经消失（外矿房停用/被拆）：本次回程卸完货就结束循环
    remoteAbort?: boolean
    // 侦察兵当前要探的房间；探完清空，等待新目标
    scoutTarget?: string
    // claimer 孵化时绑定的目标房（显式 claim 或外矿保留），
    // 每个目标房常驻一只，避免一只 claimer 在多房间之间来回跑
    claimerTarget?: string
    // 反击队孵化时绑定的外矿房（旧字段，任务化以后不再写入/读取）
    attackerTarget?: string
    // 作战单位孵化时绑定的 L3 任务 id（Memory.war.missions）
    missionId?: string
    // 本 tick 已经发出的 transfer 量。transfer 要到回合末才结算，本 tick 读到的
    // store 还是旧值，只能自己记账推算目标结算后会不会满（Game.time 变了就重置）
    transferTick?: number
    transferIssued?: number
    // 外矿任务最后绑定的房间：finishRemoteTrip / 交还任务会把 remoteCarryRoom、
    // currentWork 清掉，死亡回收时只能靠这里做归因
    lastRemoteRoom?: string
    // 最后所在房间 + 进入时间：用于死亡时判断是否刚离开外矿（边界被打回主房）
    lastRoom?: string
    lastRoomAt?: number
    // 出生时算好的自然死亡 tick：Game.time 明显早于它就是提前死亡（被敌人打死）
    dieAt?: number
    // 这次事故已经上报给 war L1：死亡回收时不再重复上报
    warReported?: boolean
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
    // 弱敌反击队：ATTACK + MOVE，只打外矿房里没有 HEAL 的小股武装
    | 'attacker'
    // 矿采空后的睡眠态：每 tick 只说 zzz，矿重生时由 wakeCreep 事件唤醒回原职业
    | 'sleep'
    // 中央搬运：站在 link/storage/terminal 中间的固定格，只做建筑之间的中转搬运。
    // 不领本地补能任务，任务形式是通用的 transferTask（from/to/resourceType）
    | 'centerCarrier'

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
    /**
     * 自毁并立刻安排补员：给主房挂下一 tick 的 creepRecycle 事件。
     * 普通死亡要等 spawn 时按自然 TTL 挂的事件，部件被打光提前死会空名额很久。
     */
    suicideAndRespawn(): void
    carryEnergy(targetId: Id<any>, resourceType: ResourceConstant): boolean
    /**
     * 通用搬运：从 from 取 resourceType 送到 to，参数完全来自 transferTask。
     * 目标满/来源空时原地等（persistent 任务不释放），目标消失才结束任务。
     */
    transferResource(fromId: Id<any>, toId: Id<any>, resourceType: ResourceConstant): boolean
    /**
     * 把能量补进一个桶：站桶节点，找桶内第一个没满的成员投递。
     * 桶内全部补满后自己把任务从队列里删掉。
     */
    carryBucket(bucketKey: string, resourceType: ResourceConstant): boolean
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
    remoteCarry(containerId: Id<StructureContainer>, targetRoom: string, homeRoom: string, sinkId?: Id<any>, linkId?: Id<StructureLink>): boolean
    /**
     * 侦察兵常驻任务：探明相邻房间并写情报；没有目标时原地随机走，等新任务。
     * 一直返回 false，只有主房关掉外矿时才回主房释放任务。
     */
    scout(homeRoom: string): boolean
    /**
     * 睡眠态的唯一动作：每 tick 说 zzz。
     * 唤醒由主房事件队列里的 wakeCreep 负责，不做每 tick 的条件判断。
     */
    sleep(): boolean
}