import {calcSpawnTicks, calcTicksPerTile, getBody, initializeArray} from "@/util/utils";
import {mapping, plan2_Core, plan2_extensionCluster1, plan2_extensionCluster2, plan2_Lab, plan1} from "@/global/autoplan/autoplan";
import log from "@/util/log";
import {containerWatermark, harvestSetting, remoteSetting, repairSetting, spawnTable, storageSetting, wallSetting} from "@/setting";
import {construct, createBuildTask, getCarryList, getEnergyTask, getRemoteCarryTasks, getRemoteHarvestTasks, getRepairTasks, getWallRepairTasks, harvestSource, upgrade, upgradeTaskCapacityOf} from "@/task/roomTask";
import {checkRoomLevelEvent, showRoomPlanEvent} from "@/event/roomEvent";
import {planRemoteRooms, recordRoomIntel} from "@/global/autoplan/remotePlan";

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
            'spawnTask': {},
            'remoteHarvestTask': {},
            'remoteCarryTask': {},
            'scoutTask': {}
        }

        this.initResource()
        this.initBuildList()
        this.initSpawn(this.controller.level)
        this.initTask(this.controller.level)
        this.initCarryList()
        this.initCreepRecycle()
        // 房间初始化（含新 claim 的房和推代码重建）时自动配好相邻外矿计划
        this.syncRemotePlan()

        this.registEvent(checkRoomLevelEvent(Game.time + 1))
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
        // 只从 spawn/extension 登记表里取，不再每 tick find。
        // tower 不放进这张表，它走 ensureEnergyCarryTask 的 60% 阈值补能。
        const structureList = this.energyStructureOrder()
            .map(id => Game.getObjectById<StructureSpawn | StructureExtension>(id))
            .filter((structure): structure is StructureSpawn | StructureExtension =>
                !!structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        this.registTask(getCarryList(structureList, RESOURCE_ENERGY))
    }

    refreshEnergyCarryTasks() {
        if (!this.memory.creepTask) {
            return
        }
        // 直接遍历 spawn/extension 登记表，状态实时读 store，不再 find
        const structureList = this.energyStructureOrder()
            .map(id => Game.getObjectById<StructureSpawn | StructureExtension>(id))
            .filter((structure): structure is StructureSpawn | StructureExtension =>
                !!structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        const carryBuckets = this.normalizeTaskBuckets('carryTask')
        // 只清理 spawn/extension 自己的补能任务；塔等其它目标的任务不能动，
        // 它们由各自的触发逻辑（ensureEnergyCarryTask）管理。
        const orderIds = new Set<string>(this.energyStructureOrder())
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
                if (!taskTargetId) {
                    continue
                }
                if (orderIds.has(taskTargetId) && !neededIds.has(taskTargetId)) {
                    // 这个 spawn/extension 已经满了，任务作废
                    continue
                }
                if (neededIds.has(taskTargetId)) {
                    existingIds.add(taskTargetId)
                }
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
     * 按布局集群顺序返回 spawn/extension 的固定 id 列表。
     * 顺序在布局阶段就由 plan1/plan2 的数组顺序决定，和存量无关。
     */
    energyStructureOrder(): Id<StructureSpawn | StructureExtension>[] {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        if (!global.room[this.name].energyStructureOrder) {
            return this.buildEnergyStructureOrder()
        }
        return global.room[this.name].energyStructureOrder
    }

    /**
     * 重建能量结构顺序：
     * - plan2: Core -> extensionCluster1 -> extensionCluster2（和建造顺序一致）
     * - plan1: 整个 plan1 行优先
     * - 不在布局里的结构追加到最后，按到 spawn 的距离排
     */
    private buildEnergyStructureOrder(): Id<StructureSpawn | StructureExtension>[] {
        const rankMap: { [pos: string]: number } = {}
        let rank = 0
        const addPlan = (map: string[], anchor?: [number, number], plusOne: boolean = true) => {
            if (!anchor || !map) {
                return
            }
            // 与 buildLayout / constructPlan1 的坐标计算保持一致
            const offset = plusOne ? map.length - 1 : map.length
            for (let y = 0; y < map.length; y++) {
                const row = map[y].split(" ")
                for (let x = 0; x < row.length; x++) {
                    const cell = row[x]
                    if (!cell) {
                        continue
                    }
                    const type = mapping[cell[0]]
                    if (type !== STRUCTURE_EXTENSION && type !== STRUCTURE_SPAWN) {
                        continue
                    }
                    rankMap[`${anchor[0] + x - offset},${anchor[1] + y - offset}`] = rank++
                }
            }
        }
        if (this.memory.roomPlanType === 2 && this.memory.plan2Pos) {
            const planPos = this.memory.plan2Pos
            addPlan(plan2_Core, planPos.core)
            addPlan(plan2_extensionCluster1, planPos.ext1)
            addPlan(plan2_extensionCluster2, planPos.ext2)
        } else if (this.memory.plan1Pos) {
            addPlan(plan1, this.memory.plan1Pos, false)
        }

        const structures = this.find(FIND_MY_STRUCTURES, {
            filter: (object: any) => object.structureType === STRUCTURE_SPAWN
                || object.structureType === STRUCTURE_EXTENSION
        }) as (StructureSpawn | StructureExtension)[]
        const spawn = this.find(FIND_MY_SPAWNS)[0]
        const spawnPos = spawn ? spawn.pos : undefined
        structures.sort((a, b) => {
            const rankA = rankMap[`${a.pos.x},${a.pos.y}`]
            const rankB = rankMap[`${b.pos.x},${b.pos.y}`]
            const aPlanned = rankA !== undefined
            const bPlanned = rankB !== undefined
            if (aPlanned && bPlanned && rankA !== rankB) {
                return rankA - rankB
            }
            if (aPlanned !== bPlanned) {
                return aPlanned ? -1 : 1
            }
            const distanceA = spawnPos ? a.pos.getRangeTo(spawnPos) : 0
            const distanceB = spawnPos ? b.pos.getRangeTo(spawnPos) : 0
            if (distanceA !== distanceB) {
                return distanceA - distanceB
            }
            if (a.pos.y !== b.pos.y) {
                return a.pos.y - b.pos.y
            }
            return a.pos.x - b.pos.x
        })
        const order = structures.map(structure => structure.id)
        global.room[this.name].energyStructureOrder = order
        return order
    }

    /**
     * 新建的 spawn/extension 加入顺序表；已经在表里则不动。
     */
    registerEnergyStructure(id: Id<StructureSpawn | StructureExtension>) {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        const order = global.room[this.name].energyStructureOrder
        if (order && order.includes(id)) {
            return
        }
        this.buildEnergyStructureOrder()
    }

    /**
     * 定期兜底重建顺序表，处理漏掉的建成/拆除。
     */
    refreshEnergyStructures() {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return
        }
        this.buildEnergyStructureOrder()
    }

    /**
     * 按布局固定顺序挑出"刚好够" cost 的结构，不做任何按存量排序。
     * spawnCreep 会严格按返回顺序扣能量，usedIds 就是实际贡献了能量的结构。
     */
    pickEnergyStructures(cost: number): {
        structures: (StructureSpawn | StructureExtension)[]
        usedIds: Id<StructureSpawn | StructureExtension>[]
    } | undefined {
        let result = this.selectEnergyStructures(this.energyStructureOrder(), cost)
        if (!result) {
            // 顺序表可能漏了刚建好的结构，强制重建一次再试
            result = this.selectEnergyStructures(this.buildEnergyStructureOrder(), cost)
        }
        if (result) {
            return result
        }
        // 最后兜底：直接用房间里的全部 spawn/extension
        const all = this.find(FIND_MY_STRUCTURES, {
            filter: (object: any) => object.structureType === STRUCTURE_SPAWN
                || object.structureType === STRUCTURE_EXTENSION
        }) as (StructureSpawn | StructureExtension)[]
        return this.selectEnergyStructures(all.map(structure => structure.id), cost)
    }

    private selectEnergyStructures(ids: Id<StructureSpawn | StructureExtension>[], cost: number): {
        structures: (StructureSpawn | StructureExtension)[]
        usedIds: Id<StructureSpawn | StructureExtension>[]
    } | undefined {
        let energy = 0
        const structures: (StructureSpawn | StructureExtension)[] = []
        const usedIds: Id<StructureSpawn | StructureExtension>[] = []
        for (const id of ids) {
            if (energy >= cost) {
                break
            }
            const structure = Game.getObjectById<StructureSpawn | StructureExtension>(id)
            if (!structure) {
                continue
            }
            const stored = structure.store.getUsedCapacity(RESOURCE_ENERGY)
            if (!stored) {
                continue
            }
            structures.push(structure)
            usedIds.push(id)
            energy += stored
        }
        if (energy < cost) {
            return
        }
        return {structures, usedIds}
    }

    /**
     * spawn 成功后 +1 tick 调用：spawnCreep 是 intent，回合末才扣能量，
     * 下一 tick 这些结构才会真正出现空位。只给实际贡献了能量的结构登记 carry 任务。
     */
    refillAfterSpawn(structureIds: Id<StructureSpawn | StructureExtension>[]) {
        if (!structureIds || !structureIds.length) {
            return
        }
        this.addExtensionCarryTasks(structureIds)
    }

    /**
     * 定期刷新取能任务：先剔除失效任务，再补缺失的目标。
     * 以前只加不删，墓碑/掉落物消失后会留下永久的死任务。
     */
    refreshEnergyTasks() {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return
        }
        const level = this.controller.level
        const watermark = containerWatermark[level] ?? containerWatermark[0]
        // 先算出这一轮应有的任务，既用来补缺，也用来同步已有任务的并发数
        const tasks = getEnergyTask(this)
        const desired: { [targetId: string]: MyTask } = {}
        for (const task of tasks) {
            const targetId = task.targetId ?? task.taskParam?.[0]
            if (targetId) {
                desired[targetId] = task
            }
        }
        const buckets = this.normalizeTaskBuckets('energyTask')
        const existingIds = new Set<string>()
        for (const key in buckets) {
            const bucket = buckets[key]
            if (!bucket || !bucket.length) {
                delete buckets[key]
                continue
            }
            const nextBucket: TaskEntity[] = []
            for (const task of bucket) {
                if (!task) {
                    continue
                }
                const targetId = task.targetId ?? task.taskParam?.[0]
                if (!targetId) {
                    continue
                }
                const target = Game.getObjectById(targetId) as any
                // 目标已经不存在（墓碑/掉落物过期、结构被拆）直接删
                if (!target) {
                    continue
                }
                const energy = this.energyOf(target)
                if (energy <= 0) {
                    continue
                }
                const structureType = target.structureType
                if (structureType === STRUCTURE_CONTAINER && energy < watermark.low) {
                    // 低于低水位，不再派人去取，留一点缓冲
                    continue
                }
                if (structureType === STRUCTURE_STORAGE && energy <= storageSetting.reserveEnergy) {
                    continue
                }
                // container 能量变化后并发数要跟着变
                const wanted = desired[targetId]
                if (wanted) {
                    task.capacity = wanted.capacity ?? 1
                }
                nextBucket.push(task)
                existingIds.add(targetId)
            }
            if (nextBucket.length) {
                buckets[key] = nextBucket
            } else {
                delete buckets[key]
            }
        }
        this.memory.creepTask['energyTask'] = buckets
        const toAdd = tasks.filter(task => {
            const targetId = task.targetId ?? task.taskParam?.[0]
            return !!targetId && !existingIds.has(targetId)
        })
        if (toAdd.length) {
            this.registTask(toAdd)
        }
    }

    /**
     * 升级任务的并发数随工地状态变化：有工地用 RCL 基准值，
     * 工地清零后放开到实际 worker 数。只更新容量，不强踢已经预约的 worker，
     * 他们在下一次补能后会按新容量自然分流。
     */
    refreshUpgradeTask(): void {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return
        }
        const capacity = upgradeTaskCapacityOf(this)
        if (!capacity) {
            return
        }
        const buckets = this.normalizeTaskBuckets('upgradeTask')
        for (const key in buckets) {
            const bucket = buckets[key]
            if (!bucket) {
                continue
            }
            for (const task of bucket) {
                if (task && task.taskFunc === 'upgrade') {
                    task.capacity = capacity
                    return
                }
            }
        }
        // 任务被清掉了（例如推送代码后），补注册一条
        this.registTask(upgrade(this))
    }

    /**
     * 外矿任务同步（10 tick 一次）。
     * 任务统一登记在主房队列，creep 靠 memory.currentWork 跨房执行；
     * 外矿房本身不初始化、不建任务桶。
     */
    refreshRemoteTasks(): void {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return
        }
        const plan = Memory.remotePlan?.[this.name]
        if (!plan || plan.enabled === false) {
            // 总开关关闭：清掉外矿任务桶。已经在外面的 creep 手里有任务副本，会干到死。
            for (const taskType of ['remoteHarvestTask', 'remoteCarryTask', 'scoutTask'] as TaskType[]) {
                if (this.memory.creepTask[taskType]) {
                    delete this.memory.creepTask[taskType]
                }
            }
            return
        }
        // 侦察兵的常驻任务先挂上：新孵化/空闲的侦察兵靠它领活
        this.syncScoutTask()
        const harvestDesired: MyTask[] = []
        const carryDesired: MyTask[] = []
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (!state || state.enabled === false) {
                continue
            }
            const remoteRoom = Game.rooms[roomName]
            if (remoteRoom) {
                this.updateRemoteCache(state, remoteRoom)
            }
            const sourceIds = Object.keys(state.sources ?? {}) as Id<Source>[]
            if (!sourceIds.length) {
                // 还没情报的房交给侦察兵探路，不派 harvester 去盲跑
                continue
            }
            harvestDesired.push(...getRemoteHarvestTasks(sourceIds, roomName, this.name))
            // 只有看得见外矿 container 里有能量时才登记运输任务，避免 carrier 白跑
            if (!remoteRoom || !state.sources) {
                continue
            }
            const sinkId = this.remoteEnergySink()
            if (!sinkId) {
                continue
            }
            for (const sourceId in state.sources) {
                const entry = state.sources[sourceId]
                if (!entry || !entry.containerId) {
                    continue
                }
                const container = Game.getObjectById<StructureContainer>(entry.containerId)
                if (!container || container.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) {
                    continue
                }
                carryDesired.push(...getRemoteCarryTasks(entry.containerId, roomName, this.name, sinkId))
            }
        }
        this.syncRemoteBucket('remoteHarvestTask', harvestDesired)
        this.syncRemoteBucket('remoteCarryTask', carryDesired)
        this.seedRemoteHarvestReservations()
        this.refreshScoutSpawn()
    }

    /**
     * 自动补全外矿计划：房间 init / 10 tick 扫描时调用。
     * - 第一次遇到这个房时创建总开关（enabled: true）
     * - 用户手动关掉总开关后不再自动加房
     * - 只补到 remoteSetting.maxRooms，unsafe 的房由 autoplan 排除
     */
    syncRemotePlan(): void {
        if (!this.controller || !this.controller.my) {
            return
        }
        if (!Memory.remotePlan) {
            Memory.remotePlan = {}
        }
        const plan = Memory.remotePlan[this.name] ?? (Memory.remotePlan[this.name] = {enabled: true, rooms: {}})
        if (!plan.rooms) {
            plan.rooms = {}
        }
        if (plan.enabled === false) {
            return
        }
        let active = 0
        for (const roomName in plan.rooms) {
            if (!Memory.mapIntel?.[roomName]?.unsafe) {
                active += 1
            }
        }
        let capacity = remoteSetting.maxRooms - active
        if (capacity <= 0) {
            return
        }
        for (const roomName of planRemoteRooms(this.name)) {
            if (capacity <= 0) {
                break
            }
            if (plan.rooms[roomName]) {
                continue
            }
            plan.rooms[roomName] = {}
            capacity -= 1
        }
    }

    /**
     * 常驻侦察任务：每个主房一个，capacity 1，priority 4（不挡富余能量门槛）。
     * 侦察兵认领后一直持有，内部自己从 plan 里挑下一个要探的房。
     */
    private syncScoutTask(): void {
        const buckets = this.normalizeTaskBuckets('scoutTask')
        for (const key in buckets) {
            delete buckets[key]
        }
        buckets['4'] = [{
            id: `scout-${this.name}`,
            taskFunc: 'scout',
            taskParam: [this.name],
            priority: 4,
            capacity: 1,
            persistent: true,
            targetId: this.name,
            reservedBy: [],
        }]
    }

    /**
     * 有房间缺情报且没有存活/排队的侦察兵时，补一个 priority 4 的 viewer。
     */
    private refreshScoutSpawn(): void {
        const plan = Memory.remotePlan?.[this.name]
        if (!plan || plan.enabled === false) {
            return
        }
        let needScout = false
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (!state || state.enabled === false) {
                continue
            }
            if (state.sources && Object.keys(state.sources).length) {
                continue
            }
            const intel = Memory.mapIntel?.[roomName]
            if (intel?.unsafe || intel?.scoutedAt) {
                continue
            }
            needScout = true
            break
        }
        if (!needScout) {
            return
        }
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName]
            if (creep.memory.spawnRoom === this.name && creep.memory.role === 'viewer') {
                return
            }
        }
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            for (const task of spawnBuckets[key] ?? []) {
                if (task?.taskParam?.[0] === 'viewer') {
                    return
                }
            }
        }
        this.addToSpawnList('viewer')
    }

    /**
     * 按富余能量门槛孵化外矿 harvester。
     * 外矿角色不进 initSpawn 的配额（reSpawn=false），补员完全由这里决定，
     * 所以随时可以关掉，不会和主房抢 spawn。
     */
    refreshRemoteSpawn(): void {
        if (!this.memory.creepTask || !this.controller) {
            return
        }
        const plan = Memory.remotePlan?.[this.name]
        if (!plan || plan.enabled === false) {
            return
        }
        let want = 0
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (!state || state.enabled === false) {
                continue
            }
            // 还没情报的房交给侦察兵，不在这里派 harvester
            want += Object.keys(state.sources ?? {}).length
        }
        if (!want) {
            return
        }
        let alive = 0
        for (const name in Game.creeps) {
            const creep = Game.creeps[name]
            if (creep.memory.spawnRoom === this.name && creep.memory.role === 'remoteHarvester') {
                alive += 1
            }
        }
        let queued = 0
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            for (const task of spawnBuckets[key] ?? []) {
                if (task?.taskParam?.[0] === 'remoteHarvester') {
                    queued += 1
                }
            }
        }
        if (alive + queued >= want) {
            return
        }
        if (!plan.force && !this.remoteGate()) {
            return
        }
        for (let i = alive + queued; i < want; i++) {
            this.addToSpawnList('remoteHarvester')
        }
    }

    /**
     * 富余能量门槛：主房没有待孵化任务、能量结构满、本地 container 超过高水位。
     * 三条同时满足才认为"有多余能量"，可以拿去养外矿。
     */
    private remoteGate(): boolean {
        if (!this.controller) {
            return false
        }
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            if (Number(key) < 3 && (spawnBuckets[key] ?? []).length) {
                return false
            }
        }
        if (this.energyAvailable < this.energyCapacityAvailable) {
            return false
        }
        const level = this.controller.level
        const watermark = containerWatermark[level] ?? containerWatermark[0]
        for (const id of this.getContainer()) {
            const container = Game.getObjectById<StructureContainer>(id)
            if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) >= watermark.high) {
                return true
            }
        }
        return false
    }

    /**
     * 有视野时把外矿矿点/container 的最新情况写回顶层缓存。
     */
    private updateRemoteCache(state: RemoteRoomState, remoteRoom: Room): void {
        if (!state.sources) {
            state.sources = {}
        }
        const sources = remoteRoom.find(FIND_SOURCES) as Source[]
        for (const source of sources) {
            let entry = state.sources[source.id]
            if (!entry) {
                entry = state.sources[source.id] = {}
            }
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (object: any) => object.structureType === STRUCTURE_CONTAINER
            }) as StructureContainer[]
            if (containers.length) {
                entry.containerId = containers[0].id
                entry.containerPos = [containers[0].pos.x, containers[0].pos.y]
                continue
            }
            const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
                filter: (object: any) => object.structureType === STRUCTURE_CONTAINER
            }) as ConstructionSite[]
            if (sites.length) {
                entry.containerPos = [sites[0].pos.x, sites[0].pos.y]
            }
        }
        for (const sourceId in state.sources) {
            if (!sources.some(source => source.id === sourceId)) {
                delete state.sources[sourceId]
            }
        }
        // 顺带刷新情报：有主/被他人 reserve/有敌对时会把该外矿房停用
        recordRoomIntel(this.name, remoteRoom)
    }

    /**
     * 主房接收外矿能量的目标：storage 优先，没有 storage 就选空位最多的 container，
     * 再没有 container 就补给 spawn/extension。
     */
    private remoteEnergySink(): Id<any> | undefined {
        if (this.storage && this.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            return this.storage.id
        }
        let best: Id<StructureContainer> | undefined
        let bestFree = 0
        for (const id of this.getContainer()) {
            const container = Game.getObjectById<StructureContainer>(id)
            if (!container) {
                continue
            }
            const free = container.store.getFreeCapacity(RESOURCE_ENERGY)
            if (free > bestFree) {
                best = id
                bestFree = free
            }
        }
        if (best) {
            return best
        }
        for (const id of this.energyStructureOrder()) {
            const structure = Game.getObjectById<StructureExtension | StructureSpawn>(id)
            if (structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                return structure.id
            }
        }
        return undefined
    }

    /**
     * 按 targetId 同步一个外矿任务桶：更新并发、清掉失效任务、补缺。
     * 没有视野时不删任务（此时 getObjectById 查不到不代表目标没了）。
     */
    private syncRemoteBucket(taskType: TaskType, desired: MyTask[]): void {
        const buckets = this.normalizeTaskBuckets(taskType)
        const desiredById: { [targetId: string]: MyTask } = {}
        for (const task of desired) {
            const targetId = task.targetId ?? task.taskParam?.[0]
            if (targetId) {
                desiredById[targetId] = task
            }
        }
        const existing = new Set<string>()
        for (const key in buckets) {
            const bucket = buckets[key]
            if (!bucket || !bucket.length) {
                delete buckets[key]
                continue
            }
            const next: TaskEntity[] = []
            for (const task of bucket) {
                if (!task) {
                    continue
                }
                const targetId = task.targetId ?? task.taskParam?.[0]
                if (!targetId) {
                    continue
                }
                const roomName = task.taskParam?.[1] as string | undefined
                const hasVision = !roomName || !!Game.rooms[roomName]
                const wanted = desiredById[targetId]
                if (!wanted) {
                    if (!hasVision) {
                        next.push(task)
                    }
                    continue
                }
                const realId = task.taskParam?.[0]
                if (hasVision && realId && !Game.getObjectById(realId)) {
                    continue
                }
                task.capacity = wanted.capacity ?? task.capacity
                next.push(task)
                existing.add(targetId)
            }
            if (next.length) {
                buckets[key] = next
            } else {
                delete buckets[key]
            }
        }
        const toAdd = desired.filter(task => {
            const targetId = task.targetId ?? task.taskParam?.[0]
            return !!targetId && !existing.has(targetId)
        })
        if (toAdd.length) {
            this.registTask(toAdd)
        }
    }

    /**
     * 推代码后队列重建、task 的 reservedBy 是空的，但老 creep 的 currentWork 还在。
     * 不把已经在采这个矿的 harvester 补进预约，就会再派一个去同一个矿。
     */
    private seedRemoteHarvestReservations(): void {
        const buckets = this.normalizeTaskBuckets('remoteHarvestTask')
        const assigned: { [sourceId: string]: string[] } = {}
        for (const name in Game.creeps) {
            const creep = Game.creeps[name]
            if (creep.memory.spawnRoom !== this.name
                || creep.memory.role !== 'remoteHarvester'
                || !creep.memory.harvestSourceId) {
                continue
            }
            const sourceId = creep.memory.harvestSourceId
            const list = assigned[sourceId] ?? (assigned[sourceId] = [])
            list.push(name)
        }
        for (const key in buckets) {
            for (const task of buckets[key] ?? []) {
                if (!task) {
                    continue
                }
                const sourceId = task.taskParam?.[0]
                if (!sourceId) {
                    continue
                }
                const names = assigned[sourceId]
                if (!names || !names.length) {
                    continue
                }
                task.reservedBy = task.reservedBy ?? []
                for (const name of names) {
                    if (!task.reservedBy.some(item => item?.name === name)) {
                        task.reservedBy.push({ name, lastTick: Game.time })
                    }
                }
            }
        }
    }

    /**
     * 取能目标当前可用能量：container/storage/tombstone 读 store，掉落物读 amount。
     */
    private energyOf(target: any): number {
        if (target.store && typeof target.store.getUsedCapacity == 'function') {
            return target.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0
        }
        if (target.resourceType === RESOURCE_ENERGY || target.resourceType === undefined) {
            return target.amount ?? 0
        }
        return 0
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
            // 外矿 harvester 不参与自动补员：配额故意为 0，让它 reSpawn=false，
            // 由 refreshRemoteSpawn 按"富余能量"门槛决定要不要孵化
            'remoteHarvester': 0,
            // 侦察兵同样不参与自动补员，由 refreshScoutSpawn 按需补
            'viewer': 0,
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
                // remember() 会用 creep 当前所在房间重建 spawnRoom，并丢掉 currentWork。
                // 跨房执行外矿任务时两者都不能丢：spawnRoom 丢了会让补员/回收认错房间，
                // currentWork 丢了会让 creep 在外矿/路上没法从主房队列重新领任务。
                const outsideHome = creep.room.name !== this.name
                const savedWork = outsideHome ? creep.memory.currentWork : undefined
                const savedWorkType = outsideHome ? creep.memory.currentWorkType : undefined
                delete Memory.creeps[creepName]
                creep.remember()
                creep.memory.spawnRoom = this.name
                if (savedWork) {
                    creep.memory.currentWork = savedWork
                    creep.memory.currentWorkType = savedWorkType
                    creep.memory.working = true
                }
                // 推代码会清空所有事件；外矿 creep 不在主房，initCreepRecycle 扫不到，
                // 这里补一个回收事件，保证死亡后能清内存/按 reSpawn 补员
                if (outsideHome && creep.ticksToLive !== undefined) {
                    this.registEvent({
                        triggerTime: Game.time + creep.ticksToLive + 1,
                        triggerFunc: 'creepRecycle',
                        param: []
                    })
                }
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
            // 记录排队时间：spawn 等能量超过阈值后会按当前能量缩小体型兜底，
            // 避免 carrier 全灭时 priority 0 的大体型任务把整队堵死
            queuedAt: Game.time,
            // 外矿/侦察兵排在最后：本地换班/补员都做完了才轮得到它们
            priority: role == 'harvester' ? 0
                : role == 'carrier' ? 1
                : role == 'viewer' ? 4
                : role == 'remoteHarvester' ? 3
                : 2,
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
        if (!thisSpawn || !thisSpawn.spawning) {
            return
        }
        // spawn 消耗产生的补能需求由 refillAfterSpawn 在 +1 tick 登记，
        // 这里只负责在孵化完成后安排 recycle 事件
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
        const structures = this.lookForAt(LOOK_STRUCTURES, x, y)
        for (const structure of structures) {
            if (structure.onBuild) {
                structure.onBuild()
            }
            // 新建的 spawn/extension 加入能量结构顺序表，后续 spawn 就能直接用它
            if (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) {
                this.registerEnergyStructure(structure.id as Id<StructureSpawn | StructureExtension>)
            }
            // 新建 container 立即刷新容器列表，不用等 100 tick 兜底
            if (structure.structureType === STRUCTURE_CONTAINER) {
                this.refreshContainers()
            }
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
        // progress 在升级时会归零重算，所以 diff < 0 就是刚刚升级的信号。
        // 此时 initBuildList 已经用新等级重建了工地；这里再按新等级的
        // spawnTable 重算孵化配额，并让升级并发跟着新工地回落。
        // 下一 tick 先重新测量新等级的升级速度，再进入正常排期。
        if (diff < 0) {
            if (this.memory.creepTask) {
                // initSpawn 只按存活 creep 算差额、不统计已排队未孵化的任务，
                // 先清空避免重复排队（与 globalReset 的做法一致）
                this.memory.creepTask.spawnTask = {}
            }
            this.initSpawn(this.controller.level)
            this.refreshUpgradeTask()
            this.registEvent(checkRoomLevelEvent(Game.time + 1))
            return
        }
        // 预测间隔除以 3：提前触发会用新测到的 diff 重新预测，
        // 升级速度变化时最多 1/3 个旧预估就能纠正，避免一次排到几百 tick 后。
        let tickGap: number
        if (diff === 0) {
            if (remain < 1000) {
                // 进度停滞后恢复，按 1 progress/tick 的保守值每 1/5 检查一次
                tickGap = Math.ceil(remain / 5) + 1
            } else {
                tickGap = Math.max(10, Math.ceil(remain / 300))
            }
        } else {
            // 最低 10 tick，避免接近升级时极限情况下每 tick 都跑一遍 initBuildList
            tickGap = Math.max(10, Math.ceil(remain / diff / 3))
        }
        this.registEvent(checkRoomLevelEvent(Game.time + tickGap))
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

    /**
     * 容器 id 列表。以前取到一次就永久缓存，新 container 建成后永远进不来；
     * 现在按 containerScanInterval 兜底刷新，建成时由 buildOver 立即刷新。
     */
    getContainer(): Id<StructureContainer>[] {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        if (!global.room[this.name].container) {
            return this.refreshContainers()
        }
        return global.room[this.name].container
    }

    refreshContainers(): Id<StructureContainer>[] {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
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
        global.room[this.name].container = containers
        global.room[this.name].lastContainerScan = Game.time
        return containers
    }

    /**
     * 存活 carrier 的平均载重。取能任务的并发数按它算：
     * carrier 越大，同一个 container 需要的人越少。
     * 同 tick 内只算一次。
     */
    avgCarrierCapacity(): number {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        const cache = global.room[this.name]
        if (cache.avgCarrierCapacityTick === Game.time && cache.avgCarrierCapacity !== undefined) {
            return cache.avgCarrierCapacity
        }
        let total = 0
        let count = 0
        for (const name in Game.creeps) {
            const creep = Game.creeps[name]
            if (creep.memory.role !== 'carrier') {
                continue
            }
            const capacity = creep.store.getCapacity()
            if (capacity) {
                total += capacity
                count += 1
            }
        }
        let average = count ? total / count : 0
        if (!average) {
            // 还没孵化过 carrier 时按计划 body 兜底
            const carryParts = getBody('carrier', this).filter(part => part === CARRY).length
            average = Math.max(carryParts * 50, 50)
        }
        cache.avgCarrierCapacity = average
        cache.avgCarrierCapacityTick = Game.time
        return average
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
