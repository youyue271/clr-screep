import {calcSpawnTicks, calcTicksPerTile, getBody, initializeArray} from "@/util/utils";
import {mapping, plan2_Core, plan2_extensionCluster1, plan2_extensionCluster2, plan2_Lab, plan1} from "@/global/autoplan/autoplan";
import log from "@/util/log";
import {harvestSetting, repairSetting, spawnTable, wallSetting} from "@/setting";
import {construct, createBuildTask, getCarryList, getEnergyTask, getRepairTasks, getWallRepairTasks, harvestSource, upgrade} from "@/task/roomTask";
import {checkRoomLevelEvent, showRoomPlanEvent} from "@/event/roomEvent";

export default class RoomExtension extends Room {
    /**
     * 初始化部分
     */
    init() {
        if (!this.memory.timer) {
            this.memory.timer = {}
        }
        // 暂时就分三种， 0是主基地，1是分基地也就是矿场，用于reserve，2是其他房间
        if (!this.controller){
            this.memory.roomType = 2
        } else {
            if(!this.controller.my){
                this.memory.roomType = 2
            } else {
                this.memory.roomType = 0
                this.globalReset()
            }
        }
        
    }

    globalReset() {
        if (!this.controller || !this.controller.my) {
            return
        }
        global.room[this.name] = {}
        this.memory.creepTask = {
            'harvestTask': {},
            'workTask': {},
            'carryTask': {},
            'upgradeTask': {},
            'constructTask': {},
            'repairTask': {},
            'wallRepairTask': {},
            'energyTask': {},
            'spawnTask': {}
        }

        this.initEnergyList()
        this.initResource()
        this.initBuildList()
        this.initSpawn(this.controller.level)
        this.initTask(this.controller.level)
        this.initCarryList()
        this.initCreepRecycle()
        
        this.registEvent(checkRoomLevelEvent(Game.time + 1))
    }

    initEnergyList(): void {
        const extensions = this.find(FIND_MY_STRUCTURES, {
            filter: (object: any) => {
                return object.structureType == STRUCTURE_EXTENSION && object.store['energy']
            }
        })
        this.memory.energyList = extensions.map((extension: StructureExtension) => extension.id)
    }

    initBuildList() {
        if (this.memory.creepTask) {
            this.memory.creepTask['constructTask'] = {}
        }
        this.construct(this.controller.level)
        // 确保矿点 container 工地存在：已有 container 会被直接复用，不会另起新点
        this.containerPos()
        // 布局完成后计算 spawn 到各矿点的距离，供 harvester 提前换班使用
        this.cacheHarvestSpawnDistances()
        const constructionSites = this.find(FIND_CONSTRUCTION_SITES)
        this.registTask(createBuildTask(constructionSites))
    }

    /**
     * 布局阶段计算 spawn 到每个矿点的路径长度，存进 Memory。
     * spawn 位置不变时直接复用缓存，避免频繁寻路。
     */
    private cacheHarvestSpawnDistances() {
        const spawn = this.find(FIND_MY_SPAWNS)[0]
        if (!spawn) {
            return
        }
        const spawnPos = spawn.pos
        const storedPos = this.memory.harvestSpawnPos
        if (storedPos && storedPos[0] === spawnPos.x && storedPos[1] === spawnPos.y
            && this.memory.harvestSpawnDistance) {
            return
        }
        const distances: { [sourceId: string]: number } = {}
        for (const sourceId of this.sources()) {
            const source = Game.getObjectById<Source>(sourceId)
            if (!source) {
                continue
            }
            distances[sourceId] = this.findPath(spawnPos, source.pos, {ignoreCreeps: true}).length
        }
        this.memory.harvestSpawnDistance = distances
        this.memory.harvestSpawnPos = [spawnPos.x, spawnPos.y]
    }

    initResource() {
        const resources = this.find(FIND_DROPPED_RESOURCES)
        global.room[this.name].resources = resources
    }

    initCreepRecycle(): void {
        for(const creep of this.find(FIND_MY_CREEPS)){
            this.registEvent({
            triggerTime: Game.time + creep.ticksToLive + 1,
            triggerFunc: "creepRecycle",
            param: []
        })
        }
    }

    normalizeTaskBuckets(taskType: TaskType): TaskBucket {
        if (!this.memory.creepTask) {
            return {}
        }
        let buckets = this.memory.creepTask[taskType] as TaskBucket | undefined
        if (!buckets) {
            buckets = {}
            this.memory.creepTask[taskType] = buckets
        }
        return buckets
    }

    initCarryList() {
        if (!this.memory.creepTask) {
            return
        }
        const structureList:Structure[] = this.find(FIND_MY_STRUCTURES, {
            filter: (object: any) => {
                // console.log(object.structureType)
                if (!object.store) {
                    return false;
                }
                if (object.structureType == STRUCTURE_EXTENSION
                    || object.structureType == STRUCTURE_TOWER
                    || object.structureType == STRUCTURE_SPAWN) {
                    if (object.store.getFreeCapacity(RESOURCE_ENERGY)) {
                        // console.log(object.structureType, object.store.getFreeCapacity(RESOURCE_ENERGY))
                        return true;
                    } else {
                        return false
                    }
                } else {
                    return false
                }
            }
        })
        // console.log(structureList)
        this.registTask(getCarryList(structureList, RESOURCE_ENERGY))
    }

    refreshEnergyCarryTasks() {
        if (!this.memory.creepTask) {
            return
        }
        const structureList = this.find(FIND_MY_STRUCTURES, {
            filter: (object: any) => {
                if (!object.store) {
                    return false
                }
                const isEnergyStructure = object.structureType == STRUCTURE_EXTENSION || object.structureType == STRUCTURE_SPAWN
                if (!isEnergyStructure) {
                    return false
                }
                return object.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            }
        }) as (StructureExtension | StructureSpawn)[]
        const carryBuckets = this.normalizeTaskBuckets('carryTask')
        const neededIds = new Set(structureList.map(item => item.id))
        const existingIds = new Set<string>()
        for (const key in carryBuckets) {
            const bucket = carryBuckets[key]
            if (!bucket || !bucket.length) {
                delete carryBuckets[key]
                continue
            }
            const nextBucket: TaskEntity[] = []
            for (const task of bucket) {
                if (!task) {
                    continue
                }
                const taskTargetId = task.targetId ?? task.taskParam?.[0]
                if (!taskTargetId || !neededIds.has(taskTargetId)) {
                    continue
                }
                existingIds.add(taskTargetId)
                nextBucket.push(task)
            }
            if (nextBucket.length) {
                carryBuckets[key] = nextBucket
            } else {
                delete carryBuckets[key]
            }
        }
        this.memory.creepTask['carryTask'] = carryBuckets
        const toAdd = structureList.filter(item => !existingIds.has(item.id))
        if (toAdd.length) {
            this.registTask(getCarryList(toAdd, RESOURCE_ENERGY))
        }
    }

    /**
     * 定期刷新取能任务：只补充还不存在的目标，已有的任务不重复登记。
     * 空 container 的任务会在 creep 取不到能量时被移除，这里负责在它重新有能量后补回来。
     */
    refreshEnergyTasks() {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return
        }
        const tasks = getEnergyTask(this)
        if (!tasks.length) {
            return
        }
        const buckets = this.normalizeTaskBuckets('energyTask')
        const existingIds = new Set<string>()
        for (const key in buckets) {
            const bucket = buckets[key]
            if (!bucket || !bucket.length) {
                continue
            }
            for (const task of bucket) {
                const targetId = task?.targetId ?? task?.taskParam?.[0]
                if (targetId) {
                    existingIds.add(targetId)
                }
            }
        }
        const toAdd = tasks.filter(task => {
            const targetId = task.targetId ?? task.taskParam?.[0]
            return !!targetId && !existingIds.has(targetId)
        })
        if (toAdd.length) {
            this.registTask(toAdd)
        }
    }

    addExtensionCarryTasks(structureIds: Id<StructureExtension | StructureSpawn>[]) {
        if (!this.memory.creepTask) {
            return
        }
        const carryBuckets = this.normalizeTaskBuckets('carryTask')
        const existingIds = new Set<string>()
        for (const key in carryBuckets) {
            const bucket = carryBuckets[key]
            if (!bucket || !bucket.length) {
                continue
            }
            for (const task of bucket) {
                if (!task) {
                    continue
                }
                const taskTargetId = task.targetId ?? task.taskParam?.[0]
                if (taskTargetId) {
                    existingIds.add(taskTargetId)
                }
            }
        }
        const toAdd: (StructureExtension | StructureSpawn)[] = []
        for (const id of structureIds) {
            const structure = Game.getObjectById<StructureExtension | StructureSpawn>(id)
            if (!structure) {
                continue
            }
            if (!structure.store.getFreeCapacity(RESOURCE_ENERGY)) {
                continue
            }
            if (existingIds.has(structure.id)) {
                continue
            }
            toAdd.push(structure)
        }
        if (toAdd.length) {
            this.registTask(getCarryList(toAdd, RESOURCE_ENERGY))
        }
    }

    /**
     * 为单个结构登记补能任务（塔等主动请求补能用）。
     * 已经存在指向该结构的 carryTask 时不重复登记。
     */
    ensureEnergyCarryTask(structureId: Id<AnyStoreStructure>) {
        if (!this.memory.creepTask) {
            return
        }
        const structure = Game.getObjectById<AnyStoreStructure>(structureId)
        if (!structure || !structure.store.getFreeCapacity(RESOURCE_ENERGY)) {
            return
        }
        const carryBuckets = this.normalizeTaskBuckets('carryTask')
        for (const key in carryBuckets) {
            const bucket = carryBuckets[key]
            if (!bucket || !bucket.length) {
                continue
            }
            for (const task of bucket) {
                if (!task) {
                    continue
                }
                const taskTargetId = task.targetId ?? task.taskParam?.[0]
                if (taskTargetId === structureId) {
                    return
                }
            }
        }
        this.registTask(getCarryList([structure], RESOURCE_ENERGY))
    }

    /**
     * 把扫描缓存里的维修队列同步成 worker 任务。
     * 由 scan() 每 repairScanInterval tick 调用一次。
     */
    syncRepairTasks() {
        const cache = global.room[this.name]
        if (!cache || !cache.repairQueue) {
            return
        }
        this.syncTaskQueue('repairTask', cache.repairQueue, repairSetting.maxTasks, getRepairTasks)
    }

    /**
     * 同步墙体/防御墙维护任务，数量受 wallSetting.maxTasks 限制。
     */
    syncWallRepairTasks() {
        const cache = global.room[this.name]
        if (!cache || !cache.maintenanceQueue || !this.controller) {
            return
        }
        const targetHits = wallSetting.targetHits[this.controller.level] ?? 0
        if (!targetHits) {
            return
        }
        this.syncTaskQueue('wallRepairTask', cache.maintenanceQueue, wallSetting.maxTasks,
            targets => getWallRepairTasks(targets, targetHits))
    }

    /**
     * 通用任务同步：清理失效任务，再从队列头部补足到 maxTasks。
     * 已经有人领取的任务保留，等 worker 自己释放。
     */
    private syncTaskQueue(taskType: TaskType, sourceIds: string[], maxTasks: number, factory: (targets: Structure[]) => MyTask[]) {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return
        }
        const buckets = this.normalizeTaskBuckets(taskType)
        const knownTargets = new Set<string>()
        for (const key in buckets) {
            const queue = buckets[key]
            if (!queue || !queue.length) {
                delete buckets[key]
                continue
            }
            const next: TaskEntity[] = []
            for (const task of queue) {
                if (!task) {
                    continue
                }
                const targetId = task.targetId ?? task.taskParam?.[0]
                const target = targetId ? Game.getObjectById<Structure>(targetId as Id<Structure>) : null
                const reserved = !!(task.reservedBy && task.reservedBy.length)
                // 目标血量可能是任务参数里的维护目标（墙/rampart），没有则修到 hitsMax
                const goalHits = target
                    ? (typeof task.taskParam?.[1] === 'number' ? task.taskParam[1] : target.hitsMax)
                    : 0
                // 已经修好/消失且没人在修的任务直接删掉；有人在修的等 worker 自己释放
                if ((!target || target.hits >= goalHits) && !reserved) {
                    continue
                }
                if (targetId) {
                    knownTargets.add(targetId)
                }
                next.push(task)
            }
            if (next.length) {
                buckets[key] = next
            } else {
                delete buckets[key]
            }
        }
        let taskCount = knownTargets.size
        if (taskCount >= maxTasks) {
            return
        }
        const toAdd: Structure[] = []
        for (const id of sourceIds) {
            if (taskCount + toAdd.length >= maxTasks) {
                break
            }
            if (knownTargets.has(id)) {
                continue
            }
            const structure = Game.getObjectById<Structure>(id as Id<Structure>)
            if (!structure) {
                continue
            }
            toAdd.push(structure)
        }
        if (toAdd.length) {
            this.registTask(factory(toAdd))
        }
    }

    /**
     * 临时函数
     */
    initSpawnList() {
        for (let i = 0; i < 2; i++) {
            this.addToSpawnList('harvester')
            this.addToSpawnList('worker')
        }
    }

    /**
     * Spawn相关
     */
    initSpawn(level: number) {
        console.log("Global init Spawn")
        let spawnNum: { [role in Role]: number } = {
            'harvester': this.find(FIND_SOURCES).length,
            'carrier': spawnTable['carrier'][level],
            'worker': spawnTable['worker'][level],
            'emptyWorker': spawnTable['emptyWorker'][level],
        }
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName]
            // console.log(creepName, creep, creep.memory.spawnRoom)
            if (creep.memory.spawnRoom == this.name) {
                // console.log(1)
                // remember() 会重建 Memory.creeps 条目，先保住 harvester 绑定的矿点，
                // 否则每次推送代码都会丢掉矿点归属，补员/换班就会数错人数
                const assignedSource = creep.memory.harvestSourceId
                    ?? (creep.memory.currentWork?.taskParam?.[0] as Id<Source> | undefined)
                delete Memory.creeps[creepName]
                creep.remember()
                // emptyWorker 只是临时取能状态，按原职业统计，否则每次推送代码都会
                // 把正在取能的 worker 当成缺失，重复排队孵化
                const role = creep.memory.role === 'emptyWorker'
                    ? (creep.memory.oldRole ?? creep.memory.role)
                    : creep.memory.role
                // 代码推送会清空 Memory.rooms（包括事件），这里给现存的 harvester 重新挂换班事件
                if (role === 'harvester') {
                    if (assignedSource) {
                        creep.memory.harvestSourceId = assignedSource
                    }
                    this.scheduleHarvesterHandover(creep)
                }

                // 还需要孵化, 那就直接拿现成的, 把任务扔掉就行
                if (spawnNum[role]) {
                    spawnNum[role] -= 1
                    creep.memory.reSpawn = true
                } else {
                    // 不需要孵化了
                    creep.memory.reSpawn = false
                }
            }
        }
        for (const role in spawnNum) {
            for (let i = 0; i < spawnNum[role]; i++) {
                this.addToSpawnList(<Role>role)
            }
        }
    }

    addToSpawnList(role: Role, sourceId?: Id<Source>) {
        if (!this.memory.creepTask) {
            return
        }
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        if (!spawnBuckets) {
            return
        }
        const task: TaskEntity = {
            id: `spawn-${role}-${Game.time}-${Math.random().toString(36).slice(2)}`,
            taskFunc: "spawnCreep",
            // 第三个参数是矿点 id：提前换班的 harvester 孵化后只认这个矿点
            taskParam: [role, getBody(role, this), sourceId],
            priority: role == 'harvester' ? 0 : role == 'carrier' ? 1 : 2,
            capacity: 1,
            persistent: false, 
            reservedBy: []
        }
        const key = String(task.priority)
        if (!spawnBuckets[key]) {
            spawnBuckets[key] = []
        }
        spawnBuckets[key].push(task)
    }

    /**
     * 给 harvester 挂一个换班事件：TTL 降到「孵化 + 赶路 + 余量」门槛时触发一次。
     * 这样不需要定期扫描所有 creep，每个 harvester 一生只触发一次。
     */
    scheduleHarvesterHandover(creep: Creep) {
        const ticksToLive = creep.ticksToLive
        if (ticksToLive === undefined) {
            return
        }
        const threshold = this.harvesterHandoverThreshold(creep)
        const countdown = Math.max(1, ticksToLive - threshold)
        this.registEvent({
            triggerTime: Game.time + countdown,
            triggerFunc: 'harvesterHandover',
            param: [creep.name]
        })
    }

    /**
     * 换班事件：creep 快死了，确保它负责的矿点有替补。
     * 只看这一个矿点，不做全局扫描。
     */
    harvesterHandover(creepName: string) {
        const creep = Game.creeps[creepName]
        if (!creep) {
            // creep 已经死了，由 creepRecycle 兜底补员
            return
        }
        const sourceId = this.harvesterSourceOf(creep)
        if (!sourceId) {
            return
        }
        if (!this.ensureHarvesterForSource(sourceId as Id<Source>)) {
            // 暂时没法处理（比如还没有 spawn），稍后重试
            this.registEvent({
                triggerTime: Game.time + 20,
                triggerFunc: 'harvesterHandover',
                param: [creepName]
            })
        }
    }

    /**
     * 确保某个矿点有健康的 harvester：有就清掉多余替补，没有就排一个指定矿点的替补。
     * @returns false 表示当前无法处理（房间没有 spawn 等）
     */
    ensureHarvesterForSource(sourceId: Id<Source>): boolean {
        if (!this.controller || !this.controller.my || !this.memory.creepTask) {
            return true
        }
        if (!this.find(FIND_MY_SPAWNS).length) {
            return false
        }
        const distances = this.memory.harvestSpawnDistance ?? {}
        const body = getBody('harvester', this)
        const spawnTicks = calcSpawnTicks(body)
        const ticksPerTile = calcTicksPerTile(body)
        const thresholdOf = (creep: Creep) => {
            const distance = distances[sourceId as string] || this.maxHarvestDistance(distances)
            return spawnTicks + distance * ticksPerTile + harvestSetting.earlyMargin
        }
        const isHealthy = (creep: Creep) =>
            creep.ticksToLive === undefined || creep.ticksToLive > thresholdOf(creep)

        // 该矿点任务上的预约
        const reservers: Creep[] = []
        const buckets = this.normalizeTaskBuckets('harvestTask')
        for (const key in buckets) {
            const queue = buckets[key]
            if (!queue || !queue.length) {
                continue
            }
            for (const task of queue) {
                if (!task || task.taskParam?.[0] !== sourceId) {
                    continue
                }
                for (const item of task.reservedBy ?? []) {
                    const creep = item && Game.creeps[item.name]
                    if (creep) {
                        reservers.push(creep)
                    }
                }
            }
        }
        // 代码推送后预约可能被清空，但 creep 内存里还记着矿点，仍算有效覆盖
        const miners = this.find(FIND_MY_CREEPS).filter(creep =>
            creep.memory.role === 'harvester' && this.harvesterSourceOf(creep) === sourceId)
        const covered = reservers.concat(miners).some(creep => isHealthy(creep))
        if (covered) {
            this.cancelHarvestSpawnTasks(sourceId as string)
            return true
        }
        if (this.hasHarvesterPending(sourceId as string)) {
            return true
        }
        this.addToSpawnList('harvester', sourceId)
        return true
    }

    /**
     * 该矿点是否已经有在排队/孵化中的 harvester（包括没指定矿点的通用补员）
     */
    private hasHarvesterPending(sourceId: string): boolean {
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            const queue = spawnBuckets[key]
            if (!queue || !queue.length) {
                continue
            }
            for (const task of queue) {
                if (task && task.taskParam?.[0] === 'harvester'
                    && (task.taskParam?.[2] === sourceId || !task.taskParam?.[2])) {
                    return true
                }
            }
        }
        for (const spawn of this.find(FIND_MY_SPAWNS)) {
            const spawningName = spawn.spawning?.name
            const spawningMemory = spawningName ? Memory.creeps[spawningName] : undefined
            if (spawningMemory && spawningMemory.role === 'harvester'
                && (spawningMemory.harvestSourceId === sourceId || !spawningMemory.harvestSourceId)) {
                return true
            }
        }
        return false
    }

    /**
     * 移除指定矿点多余的 harvester 替补 spawn 任务
     */
    private cancelHarvestSpawnTasks(sourceId: string) {
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            const queue = spawnBuckets[key]
            if (!queue || !queue.length) {
                continue
            }
            const next = queue.filter(task =>
                !(task && task.taskParam?.[0] === 'harvester' && task.taskParam?.[2] === sourceId))
            if (next.length) {
                spawnBuckets[key] = next
            } else {
                delete spawnBuckets[key]
            }
        }
    }

    private harvesterSourceOf(creep: Creep): string | undefined {
        return (creep.memory.harvestSourceId
            ?? creep.memory.currentWork?.taskParam?.[0]) as string | undefined
    }

    private harvesterHandoverThreshold(creep: Creep): number {
        const body = getBody('harvester', this)
        const distances = this.memory.harvestSpawnDistance ?? {}
        const sourceId = this.harvesterSourceOf(creep)
        const distance = (sourceId && distances[sourceId]) || this.maxHarvestDistance(distances)
        return calcSpawnTicks(body) + distance * calcTicksPerTile(body) + harvestSetting.earlyMargin
    }

    private maxHarvestDistance(distances: { [sourceId: string]: number }): number {
        let max = 0
        for (const sourceId in distances) {
            if (distances[sourceId] > max) {
                max = distances[sourceId]
            }
        }
        return max || harvestSetting.defaultDistance
    }

    creepRecycle() {
        const currentTimestamp = Game.time;
        // 检查上次调用时间
        const lastRecycleTimestamp = global.lastRecycleTime
        if (currentTimestamp === lastRecycleTimestamp) {
            // 如果当前时间与上次调用时间相同，说明已经在本 tick 内调用过 recycle 函数，直接返回
            return;
        }
        for (let creepName in Memory.creeps) {
            if (!Game.creeps[creepName]) {
                // creep 已经死了
                const memory = Memory.creeps[creepName]
                const room = Game.rooms[memory.spawnRoom]
                // 从房间所有任务队列里清除该 creep 的预约（persistent 任务同样要清）
                if (room && room.memory.creepTask) {
                    for (const taskType in room.memory.creepTask) {
                        const buckets = room.memory.creepTask[taskType] as TaskBucket
                        if (!buckets) {
                            continue
                        }
                        for (const key in buckets) {
                            const queue = buckets[key]
                            if (!queue || !queue.length) {
                                continue
                            }
                            for (const task of queue) {
                                if (task && task.reservedBy) {
                                    task.reservedBy = task.reservedBy.filter(item => item.name !== creepName)
                                }
                            }
                        }
                    }
                }
                if (room && memory.spawnRoom && memory.reSpawn) {
                    if (memory.oldRole) {
                        memory.role = memory.oldRole
                    }
                    if (memory.role === 'harvester') {
                        // harvester 正常由换班事件提前替补；意外死亡时在这里兜底补员
                        const sourceId = (memory.harvestSourceId
                            ?? memory.currentWork?.taskParam?.[0]) as string | undefined
                        if (sourceId) {
                            room.ensureHarvesterForSource(sourceId as Id<Source>)
                        }
                    } else {
                        room.addToSpawnList(memory.role)
                    }
                }
                delete Memory.creeps[creepName]
            }
        }
        global.lastRecycleTime = currentTimestamp
    }

    /**
     * event相关
     * @param event
     */

    registEvent(event: myEvent) {
        if (!this.memory.timer) {
            this.memory.timer = {}
        }
        if (!this.memory.timer[event.triggerTime]) {
            this.memory.timer[event.triggerTime] = []
        }
        this.memory.timer[event.triggerTime].push([event.triggerFunc, <any>event.param])
    }

    runEvent() {
        if (!this.memory.timer) {
            this.memory.timer = {}
            return
        }
        while (this.memory.timer[Game.time] && this.memory.timer[Game.time].length) {
            const [func, param] = this.memory.timer[Game.time].pop()
            // console.log(func)
            this[func](...param)
        }
        delete this.memory.timer[Game.time]
        
        
    }

    calSpawningTime(SpawnId: Id<StructureSpawn>) {
        const thisSpawn = Game.getObjectById(SpawnId)
        const nextEnergyList: Id<StructureExtension>[] = []
        for (const id of thisSpawn.room.energyList()) {
            const extension = Game.getObjectById(id)
            if (!extension) {
                continue
            }
            if (extension.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                thisSpawn.room.registTask(getCarryList([extension], RESOURCE_ENERGY))
            }
            if (extension.store['energy']){
                nextEnergyList.push(id)
            }
        }
        for (const spawn of thisSpawn.room.find(FIND_MY_SPAWNS)) {
            if (spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                spawn.room.registTask(getCarryList([spawn], RESOURCE_ENERGY))
            }
        }
        thisSpawn.room.memory.energyList = nextEnergyList
        this.registEvent({
            triggerTime: Game.time + thisSpawn.spawning.remainingTime + 1,
            triggerFunc: "calRecycleTime",
            param: [thisSpawn.spawning.name]
        })
    }

    calRecycleTime(creepName: string) {
        const creep = Game.creeps[creepName]
        if (!creep) {
            return
        }
        this.registEvent({
            triggerTime: Game.time + creep.ticksToLive + 1,
            triggerFunc: "creepRecycle",
            param: []
        })
        // 孵化完成时给 harvester 挂换班事件，到期只检查它自己的矿点
        if (creep.memory.role === 'harvester') {
            this.scheduleHarvesterHandover(creep)
        }
    }

    buildOver(x: number, y: number) {
        const structure = this.lookForAt(LOOK_STRUCTURES, x, y)[0]
        if (structure.onBuild) {
            structure.onBuild()
        }
    }

    checkRoomLevel() {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        if (this.memory.roomType) {
            return
        }
        if (global.room[this.name].controllerProgress === undefined) {
            global.room[this.name].controllerProgress = this.controller.progress
            this.registEvent(checkRoomLevelEvent(Game.time + 1))
            return
        }
        const lastProgress = global.room[this.name].controllerProgress
        const currentProgress = this.controller.progress
        global.room[this.name].controllerProgress = currentProgress
        const diff = currentProgress - lastProgress
        const progressTotal = this.controller.progressTotal
        const remain = progressTotal - currentProgress
        this.initBuildList()
        if (this.controller.level == 8) {
            this.registEvent(checkRoomLevelEvent(Game.time + this.controller.ticksToDowngrade + 1))
            return 
        }
        if (diff === 0) {
            if (remain <1000) {
                this.registEvent(checkRoomLevelEvent(Game.time + remain +1))
                return
            } else {
                const tickGap = Math.ceil(remain / 100)
                this.registEvent(checkRoomLevelEvent(Game.time + tickGap))
                return
            }
        } else {
            const tickGap = Math.ceil(remain / diff)
            this.registEvent(checkRoomLevelEvent(Game.time + tickGap))
            return
        }
    }



    hello() {
        log.debug("hello world")
    }

    /**
     * task相关
     */

    initTask(level: number) {
        this.registTask(harvestSource(this))
        this.registTask(upgrade(this))
    }

    /**
     * 注册任务, 支持同时注册多个
     * @param tasks
     */
    registTask(tasks: MyTask[]) {
        for (const task of tasks) {
            const bucketKey = String(task.priority ?? 2)
            const buckets = this.normalizeTaskBuckets(task.taskType)
            if (!buckets[bucketKey]) {
                buckets[bucketKey] = []
            }
            buckets[bucketKey].push({
                id: `${task.taskFunc}-${Game.time}-${Math.random().toString(36).slice(2)}`,
                taskFunc: task.taskFunc,
                taskParam: task.taskParam,
                priority: task.priority ?? 2,
                capacity: task.capacity ?? 1,
                persistent: task.persistent ?? false,
                targetId: task.targetId,
                reservedBy: []
            })
            this.memory.creepTask[task.taskType] = buckets
        }
        // console.log()
    }

    /**
     * 房间缓存
     */
    calSourceMap() {
        function outOfMap(x: number, y: number) {
            return x < 0 || x > 49 || x < 0 || y > 49
        }

        if (!global.room[this.name].terrainMap) {
            this.loadTerrain()
        }
        const terrainMap = global.room[this.name].terrainMap
        const containerPoses = this.containerPos()
        let map = initializeArray(50, 50)
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ]
        for (let i = 0; i < 50; i++) {
            for (let j = 0; j < 50; j++) {
                map[i][j] = -1
            }
        }
        let queue = []
        for (let i in containerPoses) {
            queue.push(containerPoses[i])
            map[containerPoses[i][0]][containerPoses[i][1]] = i
        }
        while (queue.length > 0) {
            const [xx, yy] = queue.shift()
            const value = map[xx][yy]
            for (let direction of directions) {
                let x = xx + direction[0]
                let y = yy + direction[1]
                if (!outOfMap(x, y) && map[x][y] == -1 && terrainMap[x][y]) {
                    map[x][y] = value
                    queue.push([x, y])
                }
            }
        }
        this.visualizeMap(map)
    }

    getResources() {
        if ((Game.time % 10 === 1)) {
            let resources = this.find(FIND_DROPPED_RESOURCES)
            global.room[this.name].resources = resources
           
        } 
        return global.room[this.name].resources
    }

    getContainer(): Id<StructureContainer>[] {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        if (!global.room[this.name].container) {
            global.room[this.name].containerCount = 0
            const containers: Id<StructureContainer>[] = []
            const posList = this.containerPos() ?? []
            for (const [x, y] of posList) {
                const pos = this.getPositionAt(x, y)
                if (!pos) {
                    continue
                }
                const structure = pos.lookFor(LOOK_STRUCTURES)
                    .find(item => item.structureType === STRUCTURE_CONTAINER) as StructureContainer | undefined
                if (structure) {
                    containers.push(structure.id)
                }
            }
            if (!containers.length) {
                return
            }
            global.room[this.name].container = containers
        }
        // global.room[this.name].containerCount = (global.room[this.name].containerCount + 1) % global.room[this.name].container.length
        // return global.room[this.name].container[global.room[this.name].containerCount]
        return global.room[this.name].container
    }

    sources(): Id<Source> [] {
        if (!global.room[this.name].sources) {
            let sources = this.find(FIND_SOURCES).map(item => {
                return item.id
            })
            global.room[this.name].sources = sources
            return sources
        } else {
            return global.room[this.name].sources
        }
    }

    containerPos() {
        const sources = this.sources()
        // 按 sourceId 缓存，避免 sources 顺序变化（global 重置/代码推送）后下标错位
        const byId: { [sourceId: string]: [number, number] } = this.memory.containerPosById ?? {}
        const legacy = this.memory.containerPos ?? []
        const containerPos: [number, number][] = []
        const rememberPos = (sourceId: string, pos: RoomPosition) => {
            const point: [number, number] = [pos.x, pos.y]
            byId[sourceId] = point
            containerPos.push(point)
        }
        sources.forEach((item, index) => {
            const source = Game.getObjectById<Source>(item)
            if (!source) {
                return
            }
            // container 没有 owner，必须用 FIND_STRUCTURES；FIND_MY_STRUCTURES 永远查不到
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (object: any) => object.structureType === STRUCTURE_CONTAINER
            }) as StructureContainer[]
            if (containers.length > 0) {
                // 已经建好的 container 优先复用，绝不在别处另起工地
                rememberPos(item, containers[0].pos)
                return
            }
            const constructionSites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
                filter: {structureType: STRUCTURE_CONTAINER}
            })
            if (constructionSites.length > 0) {
                rememberPos(item, constructionSites[0].pos)
                return
            }
            let cachedPos = byId[item]
            if (!cachedPos && legacy[index]) {
                // 旧缓存是按 sources 下标存的，global 重置后顺序可能变化，必须校验是否贴着这个矿点
                const candidate = legacy[index]
                const candidatePos = this.getPositionAt(candidate[0], candidate[1])
                if (candidatePos && candidatePos.inRangeTo(source, 1)) {
                    cachedPos = [candidate[0], candidate[1]]
                }
            }
            if (cachedPos) {
                const pos = this.getPositionAt(cachedPos[0], cachedPos[1])
                if (pos) {
                    rememberPos(item, pos)
                }
                return
            }
            const direction = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1], [0, 1],
                [1, -1], [1, 0], [1, 1]
            ]
            const containerPosList: RoomPosition[] = []
            for (const [xx, yy] of direction) {
                const x = xx + source.pos.x
                const y = yy + source.pos.y
                const pos = new RoomPosition(x, y, this.name)
                if (pos.lookFor(LOOK_TERRAIN)[0] != 'wall') {
                    const targetPos = this.getPositionAt(x, y)
                    if (targetPos) {
                        containerPosList.push(targetPos)
                    }
                }
            }
            if (!containerPosList.length) {
                return
            }
            let finalPos: RoomPosition = containerPosList[0]
            let anchorPos: [number, number] | null = null
            if (this.memory.roomPlanType === 2 && this.memory.plan2Pos?.core) {
                anchorPos = this.memory.plan2Pos.core
            } else if (this.memory.plan1Pos) {
                anchorPos = this.memory.plan1Pos
            }
            const planPos = anchorPos
                ? this.getPositionAt(anchorPos[0], anchorPos[1])
                : null
            if (planPos) {
                const bestPos = planPos.findClosestByPath(containerPosList, {algorithm: "astar"})
                if (bestPos) {
                    finalPos = bestPos
                }
            }
            rememberPos(item, finalPos)
            // 目标格已经有建筑/工地时不再创建，避免重复工地
            if (finalPos.lookFor(LOOK_STRUCTURES).length || finalPos.lookFor(LOOK_CONSTRUCTION_SITES).length) {
                return
            }
            const createResult = this.createConstructionSite(finalPos.x, finalPos.y, STRUCTURE_CONTAINER)
            if (createResult == OK) {
                const site = finalPos.lookFor(LOOK_CONSTRUCTION_SITES)[0]
                if (site) {
                    this.registTask(construct(site.id))
                }
            }
        })
        this.memory.containerPosById = byId
        this.memory.containerPos = containerPos
        return containerPos
    }

    energyList() {
        if (this.memory.energyList) {
            return this.memory.energyList
        }
        const structures = this.find(FIND_MY_STRUCTURES, {
            filter: (object: any) => {
                if (!object.store) {
                    return false
                }
                const isEnergyStructure = object.structureType === STRUCTURE_EXTENSION
                return isEnergyStructure && object.store['energy']
            }
        }) as (StructureExtension)[]
        this.memory.energyList = structures.map(obj=>{return obj.id})
        return structures.map(obj=>{return obj.id})
    }

    /**
     * autoPlan相关
     */
    loadTerrain() {
        let mapBuffer = initializeArray(50, 50)
        let terrain = this.getTerrain()
        for (let i = 0; i < 50; i++) {
            for (let j = 0; j < 50; j++) {
                if (terrain.get(i, j) == TERRAIN_MASK_WALL) {
                    mapBuffer[i][j] = 0
                } else {
                    mapBuffer[i][j] = 1
                }
            }
        }
        global.room[this.name].terrainMap = mapBuffer
    }

    calDistance(x: number, y: number) {
        if (!global.room[this.name] || !global.room[this.name].terrainMap) {
            this.loadTerrain()
        }
        const terrainMap = global.room[this.name].terrainMap
        let queue = []
        let directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ]
        let bfsMap = initializeArray(50, 50)

        function outOfMap(x: number, y: number) {
            return x < 0 || x > 49 || x < 0 || y > 49
        }

        queue.push([x, y])
        while (queue.length > 0) {
            let xx: number
            let yy: number
            [xx, yy] = queue.shift()
            for (const direction of directions) {
                const dx = direction[0] + xx
                const dy = direction[1] + yy
                if (!outOfMap(dx, dy) && !bfsMap[dx][dy] && terrainMap[dx][dy]) {
                    bfsMap[dx][dy] = bfsMap[xx][yy] + 1
                    queue.push([dx, dy])
                }
            }
        }
        return bfsMap
    }

    getBiggestSquare(threshold: number) {
        // console.log("getBiggestSquare")
        if (!global.room[this.name] || !global.room[this.name].terrainMap) {
            this.loadTerrain()
        }
        let mapBuffer = global.room[this.name].terrainMap
        let anchors = []

        // 动态规划遍历所有点
        for (let x = 3; x < 48; x++) {
            for (let y = 3; y < 48; y++) {
                if (mapBuffer[x][y]) {     // 如果是空地
                    mapBuffer[x][y] = 1 + Math.min(mapBuffer[x - 1][y - 1], mapBuffer[x - 1][y], mapBuffer[x][y - 1]);   // 递推公式
                    if (mapBuffer[x][y] >= threshold) {     // 大于阈值
                        anchors.push([x, y]);   // 记录坐标
                    }
                } // else buffer[x][y] = 0 即初始值
            }
        }
        // visualizeSquare(anchors, mapBuffer, this.name)
        // this.visualizeMap(mapBuffer)
        // this.visualizeMap(mapBuffer)
        return anchors
    }

    checkError() {
        if (!this.memory.timer) {
            this.memory.timer = {}
            return
        }
        for (const tick in this.memory.timer) {
            // console.log(tick)
            if (Number(tick) < Game.time) {
                delete this.memory.timer[tick]
            } else {
                break
            }
        }
    }

    visualizeMap(map: any[]) {
        const visualTarget = this.visual
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                visualTarget.text(map[x][y], x, y);
            }
        }
    }

    calPerfectBasePos() {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        
        // Prepare BFS maps if not exist
        if (!global.room[this.name].sourceBFS) {
            const sourcesPos = this.sources().map(item => {
                const sourcePos = <Source>Game.getObjectById(item)
                return [sourcePos.pos.x, sourcePos.pos.y]
            })
            global.room[this.name].sourceBFS = []
            for (const [x, y] of sourcesPos) {
                global.room[this.name].sourceBFS.push(this.calDistance(x, y))
            }
        }
        if (!global.room[this.name].controllerBFS) {
            global.room[this.name].controllerBFS = []
            global.room[this.name].controllerBFS.push(this.calDistance(this.controller.pos.x, this.controller.pos.y))
        }

        // Try Plan 1
        const plan1Pos = this.calPlan1Pos()
        if (plan1Pos) {
            this.memory.roomPlanType = 1
            this.memory.plan1Pos = plan1Pos
            return plan1Pos
        }

        // Try Plan 2
        const plan2Pos = this.calPlan2Pos()
        if (plan2Pos) {
            this.memory.roomPlanType = 2
            this.memory.plan2Pos = plan2Pos
            // Use core position as basePos for compatibility
            this.memory.plan1Pos = plan2Pos.core
            return plan2Pos.core
        }

        return undefined
    }

    calPlan1Pos(): [number, number] | undefined {
        if (!global.room[this.name].possibleBase) {
            // Plan 1 uses 11x11, but original code used 13, likely for padding
            const anchor = this.getBiggestSquare(13)
            global.room[this.name].possibleBase = anchor
        }
        
        const possibleBase = global.room[this.name].possibleBase
        const sourceBFS = global.room[this.name].sourceBFS
        const controllerBFS = global.room[this.name].controllerBFS
        
        let minCost = 999
        let [xx, yy] = [-1, -1]
        
        for (const [x, y] of possibleBase) {
            let cost = 0
            sourceBFS.forEach(item => {
                cost += item[x - 6][y - 6]
            })
            controllerBFS.forEach(item => {
                cost += item[x - 6][y - 6]
            })
            if (cost < minCost) {
                [xx, yy] = [x, y]
                minCost = cost
            }
        }
        
        if (xx == -1) return undefined
        return [xx, yy]
    }

    calPlan2Pos() {
        const sourceBFS = global.room[this.name].sourceBFS
        const controllerBFS = global.room[this.name].controllerBFS

        // 1. Core (7x7)
        const coreAnchors = this.getBiggestSquare(7)
        if (coreAnchors.length === 0) return undefined
        
        let bestCore: [number, number] | null = null
        let minCoreCost = Infinity
        
        for (const [x, y] of coreAnchors) {
             let cost = 0
             // Center of 7x7 (0..6) is 3.
             const cx = x - 3
             const cy = y - 3
             
             sourceBFS.forEach(bfs => cost += bfs[cx][cy])
             controllerBFS.forEach(bfs => cost += bfs[cx][cy])
             
             if (cost < minCoreCost) {
                 minCoreCost = cost
                 bestCore = [x, y]
             }
        }
        
        if (!bestCore) return undefined
        
        // 2. Ext1 (6x6) - Nearest to Source 0
        const extAnchors = this.getBiggestSquare(6)
        let bestExt1: [number, number] | null = null
        let minExt1Cost = Infinity
        const source0BFS = sourceBFS[0]
        
        for (const [x, y] of extAnchors) {
            if (this.checkOverlap(bestCore, 7, [x, y], 6)) continue
            
            const cx = x - 3 // Center approx
            const cy = y - 3
            // Use Source 0 distance
            const cost = source0BFS[cx][cy]
            
            if (cost < minExt1Cost) {
                minExt1Cost = cost
                bestExt1 = [x, y]
            }
        }
        
        if (!bestExt1) return undefined

        // 3. Ext2 (6x6) - Nearest to Source 1 (or 0)
        let bestExt2: [number, number] | null = null
        let minExt2Cost = Infinity
        const source1BFS = sourceBFS.length > 1 ? sourceBFS[1] : sourceBFS[0]
        
        for (const [x, y] of extAnchors) {
            if (this.checkOverlap(bestCore, 7, [x, y], 6)) continue
            if (this.checkOverlap(bestExt1, 6, [x, y], 6)) continue
            
            const cx = x - 3
            const cy = y - 3
            const cost = source1BFS[cx][cy]
            
            if (cost < minExt2Cost) {
                minExt2Cost = cost
                bestExt2 = [x, y]
            }
        }
        
        if (!bestExt2) return undefined

        // 4. Lab (4x4) - Nearest to others
        const labAnchors = this.getBiggestSquare(4)
        let bestLab: [number, number] | null = null
        let minLabCost = Infinity
        
        const coreCenter = [bestCore[0]-3, bestCore[1]-3]
        const ext1Center = [bestExt1[0]-3, bestExt1[1]-3]
        const ext2Center = [bestExt2[0]-3, bestExt2[1]-3]
        
        for (const [x, y] of labAnchors) {
             if (this.checkOverlap(bestCore, 7, [x, y], 4)) continue
             if (this.checkOverlap(bestExt1, 6, [x, y], 4)) continue
             if (this.checkOverlap(bestExt2, 6, [x, y], 4)) continue
             
             const cx = x - 2
             const cy = y - 2
             
             const dist = this.getRange(cx, cy, coreCenter[0], coreCenter[1]) +
                          this.getRange(cx, cy, ext1Center[0], ext1Center[1]) + 
                          this.getRange(cx, cy, ext2Center[0], ext2Center[1])
             
             if (dist < minLabCost) {
                 minLabCost = dist
                 bestLab = [x, y]
             }
        }
        
        if (!bestLab) return undefined
        
        return {
            core: bestCore,
            ext1: bestExt1,
            ext2: bestExt2,
            lab: bestLab
        }
    }

    checkOverlap(pos1: [number, number], size1: number, pos2: [number, number], size2: number, padding: number = 1) {
        // pos is bottom-right [x, y]
        // Rect: [pos[0]-size+1, pos[1]-size+1] to [pos[0], pos[1]]
        
        const l1 = pos1[0] - size1 + 1 - padding
        const r1 = pos1[0] + padding
        const t1 = pos1[1] - size1 + 1 - padding
        const b1 = pos1[1] + padding
        
        const l2 = pos2[0] - size2 + 1
        const r2 = pos2[0]
        const t2 = pos2[1] - size2 + 1
        const b2 = pos2[1]
        
        return !(l1 > r2 || r1 < l2 || t1 > b2 || b1 < t2)
    }
    
    getRange(x1: number, y1: number, x2: number, y2: number) {
        return Math.max(Math.abs(x1-x2), Math.abs(y1-y2))
    }

    visualize(level: number = 0) {
        const planType = this.memory.roomPlanType || 1
        
        if (planType === 2) {
            const plan2Pos = this.memory.plan2Pos
            this.visualize_plan2(level, plan2Pos)
        } else {
            if (!this.memory.plan1Pos) return
            const [xx, yy] = this.memory.plan1Pos
            this.visualize_plan1(plan1, xx, yy, level)
        }
    }

    visualize_plan1(map: string[], xx: number, yy: number, level: number = 0) {
        const visualTarget = this.visual
        for (let y = 0; y < map.length; y++) {
            const row = map[y].split(" ")
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue
                    }
                }
                const structureType = mapping[row[x][0]]
                visualTarget.structure(xx + x - map.length, yy + y - map.length, structureType)
            }
        }
    }

    visualize_plan2(level: number, plan2Pos: any) {
        if (!plan2Pos) return
        const { core, ext1, ext2, lab } = plan2Pos
        
        this.visualize_layout(plan2_Core, core, level)
        this.visualize_layout(plan2_extensionCluster1, ext1, level)
        this.visualize_layout(plan2_extensionCluster2, ext2, level)
        this.visualize_layout(plan2_Lab, lab, level)
    }

    visualize_layout(map: string[], pos: [number, number], level: number) {
        const visualTarget = this.visual
        let [xx, yy] = pos
        for (let y = 0; y < map.length; y++) {
            const row = map[y].split(" ")
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue
                    }
                }
                const structureType = mapping[row[x][0]]
                if (structureType && structureType !== "Null") {
                    visualTarget.structure(xx + x - map.length + 1, yy + y - map.length + 1, structureType)
                }
            }
        }
    }

    showRoomPlan() {
        if (!this.memory.plan1Pos) return
        
        for (let i = 1; i <= 8; i++) {
            this.registEvent(showRoomPlanEvent(
                Game.time + i, 
                i%8+1
            ))
        }
    }

    construct(level: number) {
        if (!this.memory.plan1Pos) {
            this.calPerfectBasePos()
        }
        
        if (!this.memory.plan1Pos) {
            console.log(`[${this.name}] Warning: Cannot find perfect base position, skipping construction.`)
            return
        }

        if (this.memory.roomPlanType === 2) {
            this.constructPlan2(level)
        } else {
            this.constructPlan1(level)
        }
    }

    constructPlan1(level: number) {
        let [xx, yy] = this.memory.plan1Pos
        for (let y = 0; y < plan1.length; y++) {
            const row = plan1[y].split(" ")
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue
                    }
                }
                const structureType = mapping[row[x][0]]
                this.createConstructionSite(xx + x - plan1.length, yy + y - plan1.length, structureType)
            }
        }
    }

    constructPlan2(level: number) {
        if (!this.memory.plan2Pos) return
        const { core, ext1, ext2, lab } = this.memory.plan2Pos
        
        this.buildLayout(plan2_Core, core, level)
        this.buildLayout(plan2_extensionCluster1, ext1, level)
        this.buildLayout(plan2_extensionCluster2, ext2, level)
        this.buildLayout(plan2_Lab, lab, level)
    }

    buildLayout(map: string[], pos: [number, number], level: number) {
        let [xx, yy] = pos
        for (let y = 0; y < map.length; y++) {
            const row = map[y].split(" ")
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue
                    }
                }
                const structureType = mapping[row[x][0]]
                if (structureType && structureType !== "Null") {
                    this.createConstructionSite(xx + x - map.length + 1, yy + y - map.length + 1, structureType)
                }
            }
        }
    }
}
