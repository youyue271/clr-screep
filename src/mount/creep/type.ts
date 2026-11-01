interface CreepMemory {
    role: Role
    oldRole?: Role
    working: boolean
    spawnRoom: string
    currentWork?: TaskEntity
    currentWorkType?: TaskType
    reSpawn: boolean
}

type Role = 'worker'
    | 'carrier'
    | 'harvester'
    | 'emptyWorker'

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
}