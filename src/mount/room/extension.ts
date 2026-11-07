import {CalBodyCost, calcSpawnTicks, calcTicksPerTile, getBody, getClaimerBody, initializeArray} from "@/util/utils";
import {mapping, plan2_Core, plan2_extensionCluster1, plan2_extensionCluster2, plan2_Lab, plan1} from "@/global/autoplan/autoplan";
import log from "@/util/log";
import {containerWatermark, harvestSetting, remoteSetting, repairSetting, spawnTable, storageSetting, wallSetting} from "@/setting";
import {createBuildTask, getCarryList, getEnergyTask, getRemoteCarryTasks, getRemoteHarvestTasks, getRepairTasks, getWallRepairTasks, harvestSource, upgrade, upgradeTaskCapacityOf} from "@/task/roomTask";
import {checkRoomLevelEvent, showRoomPlanEvent} from "@/event/roomEvent";
import {isHighwayRoom, planRemoteRooms, pruneSourcelessRemoteRooms, recordRoomIntel} from "@/global/autoplan/remotePlan";

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
                // 房间已经不是我们的：清掉旧墙标记，将来重新占领时会重新清理
                if (Memory.legacyWallCleared) {
                    delete Memory.legacyWallCleared[this.name]
                }
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
            'scoutTask': {},
            'claimTask': {}
        }

        this.initResource()
        this.initBuildList()
        this.initSpawn(this.controller.level)
        this.initTask(this.controller.level)
        this.initCarryList()
        this.initCreepRecycle()
        // 房间初始化（含新 claim 的房和推代码重建）时自动配好相邻外矿计划
        this.syncRemotePlan()
        // 推代码后房间任务桶是空的，按顶层 remotePlan 里已知的 container 一次性重建回运任务
        this.rearmRemoteCarryTasks()
        // 回运任务重建后再补 link 规划：新任务能直接挂上已建好的外矿 link
        this.syncLinkPlan()

        this.registEvent(checkRoomLevelEvent(Game.time + 1))
    }

    initBuildList() {
        if (this.memory.creepTask) {
            this.memory.creepTask['constructTask'] = {}
        }
        this.clearLegacyWalls()
        this.construct(this.controller.level)
        // 确保矿点 container 工地存在：已有 container 会被直接复用，不会另起新点
        this.containerPos()
        // 布局完成后计算 spawn 到各矿点的距离，供 harvester 提前换班使用
        this.cacheHarvestSpawnDistances()
        // link 规划要在登记建造任务之前：新工地当 tick 就能进 constructTask
        this.syncLinkPlan()
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
            if (plan) {
                plan.carryActive = 0
                for (const roomName in plan.rooms) {
                    const state = plan.rooms[roomName]
                    if (state) {
                        delete state.carryTaskIds
                    }
                }
            }
            return
        }
        // 侦察兵/claimer 的常驻任务先挂上：新孵化/空闲的它们靠任务领活
        this.syncScoutTask()
        this.syncClaimTask()
        const harvestDesired: MyTask[] = []
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (!state) {
                continue
            }
            // 停用房也要在有视野时复盘：recordRoomIntel 判安全会自动重开，
            // 敌人在场则保持停用。不需要额外的定时扫描，侦察兵轮巡即可覆盖无视野的房。
            const remoteRoom = Game.rooms[roomName]
            if (remoteRoom) {
                this.updateRemoteCache(state, remoteRoom)
            }
            if (state.enabled === false) {
                continue
            }
            const sourceIds = Object.keys(state.sources ?? {}) as Id<Source>[]
            if (!sourceIds.length) {
                // 还没情报的房交给侦察兵探路，不派 harvester 去盲跑
                continue
            }
            harvestDesired.push(...getRemoteHarvestTasks(sourceIds, roomName, this.name))
        }
        // 停用/已移出计划的房：无视视野强制清任务，避免旧任务继续吸人
        this.purgeRemoteTasksOf(plan)
        this.syncRemoteBucket('remoteHarvestTask', harvestDesired)
        // remoteCarryTask 是 container 事件驱动的循环任务，这里不再扫描/补缺
        this.seedRemoteHarvestReservations()
        this.refreshScoutSpawn()
        this.refreshClaimSpawn(plan)
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
        // 探明没矿 / highway 的旧条目先清掉：早期未知房会先占坑，
        // 不清的话会一直占 maxRooms 名额，还会让 claimer 去没有 controller 的房驻守。
        pruneSourcelessRemoteRooms(plan, Memory.mapIntel)
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
     * 常驻一个侦察兵：持续轮巡相邻房，给外矿自动重开和战争情报提供视野。
     * 只要外矿计划开着就一直保持 1 个（存活或排队都算）。priority 2 与 worker 同档：
     * 侦察兵只有 100 能量、6 tick 就孵完，排在 4 会被 harvester/外矿任务长期压住。
     */
    private refreshScoutSpawn(): void {
        const plan = Memory.remotePlan?.[this.name]
        if (!plan || plan.enabled === false) {
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
     * 常驻 claim/reserve 任务：每个主房一条，priority 4。
     * 每个目标房在 spawn 时绑定一只 claimer（memory.claimerTarget），
     * 所以 capacity 要能同时容纳多个 claimer；具体去哪个房由 claimer 自己按绑定执行。
     */
    private syncClaimTask(): void {
        const buckets = this.normalizeTaskBuckets('claimTask')
        for (const key in buckets) {
            delete buckets[key]
        }
        buckets['4'] = [{
            id: `claim-${this.name}`,
            taskFunc: 'claim',
            taskParam: [this.name],
            priority: 4,
            // 每个外矿保留房 + 显式 claim 目标各一只，给足并发
            capacity: 16,
            persistent: true,
            targetId: this.name,
            reservedBy: [],
        }]
    }

    /**
     * 按目标房维持 claimer（每个目标一只常驻）：
     * - Memory.claimPlan 有目标：立刻要，不受富余能量门槛限制（用户显式指定）
     * - 已启用、安全的外矿房：各常驻一只负责续保留，按富余能量门槛孵化
     * 每只 claimer 孵化时绑定目标房（taskParam[4]），避免一只在多房之间来回跑。
     */
    private refreshClaimSpawn(plan: RemotePlan): void {
        if (plan.enabled === false) {
            return
        }
        // claimer 最小体型是 CLAIM+MOVE（650）。容量买不起时排进队列也孵不出来，
        // 会永远卡在 spawn 队首，把后面同优先级的 remoteHarvester 全部堵死
        // （官服 RCL2 容量 550 就踩过这个坑）。getClaimerBody 已按容量降级过体型，
        // 降级到最小仍超容量，说明这个房间现在物理上养不起 claimer，直接不排。
        if (CalBodyCost(getClaimerBody(this)) > this.energyCapacityAvailable) {
            return
        }
        // 显式 claim 目标优先：一次只补一个，避免多个目标同时占满 spawn
        if (Memory.claimPlan) {
            for (const roomName in Memory.claimPlan) {
                const entry = Memory.claimPlan[roomName]
                if (!entry || (entry.retryAt !== undefined && entry.retryAt > Game.time)) {
                    continue
                }
                if (!this.hasClaimerFor(roomName)) {
                    this.addToSpawnList('claimer', undefined, roomName)
                }
                return
            }
        }
        // 外矿保留：房间还在计划里且安全，就一直保持一只驻守 claimer
        if (!plan.force && !this.remoteGate()) {
            return
        }
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (!state || state.enabled === false) {
                continue
            }
            const intel = Memory.mapIntel?.[roomName]
            if (intel?.unsafe || intel?.unreachable) {
                continue
            }
            // highway / 探明无 source：没有 controller 可保留，别孵 claimer 去边界打转
            const sources = intel?.sources
            if (isHighwayRoom(roomName) || (Array.isArray(sources) && sources.length === 0)) {
                continue
            }
            if (!this.hasClaimerFor(roomName)) {
                this.addToSpawnList('claimer', undefined, roomName)
            }
        }
    }

    /**
     * 目标房是否已经有一只"还能撑一阵"的 claimer（存活或已排队孵化）。
     * TTL <= 200 不算覆盖：提前排一只接班的，避免控制器出现无人续约的空窗。
     */
    private hasClaimerFor(roomName: string): boolean {
        // 刚孵化成功、creep 还没进 Game.creeps 的窗口
        const spawnedAt = this.memory.claimerSpawnTick?.[roomName]
        if (spawnedAt !== undefined && Game.time - spawnedAt <= 20) {
            return true
        }
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName]
            if (creep.memory.spawnRoom !== this.name || creep.memory.role !== 'claimer') {
                continue
            }
            if (creep.memory.claimerTarget === roomName && (creep.ticksToLive ?? 0) > 200) {
                return true
            }
        }
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            for (const task of spawnBuckets[key] ?? []) {
                if (task?.taskParam?.[0] === 'claimer' && task?.taskParam?.[4] === roomName) {
                    return true
                }
            }
        }
        return false
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
        // remoteCarrier 不再专门孵化：本地 carrier 没活时按回运任务存在与否自动转换，
        // 所以这里只需要补 remoteHarvester。
        this.refreshRemoteHarvesterSpawn(plan)
    }

    /**
     * 登记外矿 container 的循环回运任务（幂等）。
     * 事件来源：外矿 harvester 第一次看到 container / container 换 id / 推代码重建。
     * 只读写顶层 memory 和主房任务桶，不扫描世界。
     */
    registerRemoteCarryTask(remoteRoom: string, sourceId: string, containerId: string, linkId?: Id<StructureLink>): void {
        // 推代码后房间还没 init：先不建，globalReset 的 rearm 会统一补
        if (!this.memory.creepTask) {
            return
        }
        const plan = Memory.remotePlan?.[this.name]
        const state = plan?.rooms?.[remoteRoom]
        if (!plan || !state) {
            return
        }
        if (!state.carryTaskIds) {
            state.carryTaskIds = {}
        }
        if (state.carryTaskIds[containerId]) {
            // 任务已经在：只补 link，不重复登记
            if (linkId) {
                this.updateRemoteCarryLink(containerId, linkId)
            }
            return
        }
        const sinkId = this.remoteEnergySink()
        const effectiveLink = linkId ?? this.remoteLinkOfRoom(remoteRoom)
        const created = this.registTask(getRemoteCarryTasks(
            containerId as Id<StructureContainer>, remoteRoom, this.name, sinkId, effectiveLink
        ))
        const task = created[0]
        if (!task) {
            return
        }
        state.carryTaskIds[containerId] = task.id
        plan.carryActive = (plan.carryActive ?? 0) + 1
    }

    /**
     * container 消失/停用：删任务并清 index。
     */
    removeRemoteCarryTask(containerId: string): void {
        this.dropRemoteCarryIndex(containerId)
        // 目标被确认没了：顺手清掉顶层缓存里的 containerId，
        // 否则下次推代码 rearm 又会拿旧 id 重建任务。
        const plan = Memory.remotePlan?.[this.name]
        for (const roomName in plan?.rooms ?? {}) {
            const sources = plan.rooms[roomName]?.sources
            for (const sourceId in sources ?? {}) {
                if (sources[sourceId]?.containerId === containerId) {
                    delete sources[sourceId].containerId
                }
            }
        }
        const buckets = this.memory.creepTask?.remoteCarryTask
        if (!buckets) {
            return
        }
        for (const key in buckets) {
            const queue = buckets[key]
            if (!queue || !queue.length) {
                continue
            }
            const next = queue.filter(task => (task.targetId ?? task.taskParam?.[0]) !== containerId)
            if (next.length) {
                buckets[key] = next
            } else {
                delete buckets[key]
            }
        }
    }

    /**
     * 停用/移出计划的房：把它所有回运任务一次清掉。
     */
    removeRemoteCarryTasksOfRoom(remoteRoom: string): void {
        const ids = Memory.remotePlan?.[this.name]?.rooms?.[remoteRoom]?.carryTaskIds
        if (!ids) {
            return
        }
        for (const containerId in ids) {
            this.removeRemoteCarryTask(containerId)
        }
    }

    /**
     * 推代码后房间任务桶是空的，但顶层 remotePlan 里的 containerId 还在。
     * 按这些已知 container 一次性重建任务（不是周期扫描）。
     */
    rearmRemoteCarryTasks(): void {
        if (!this.memory.creepTask) {
            return
        }
        const plan = Memory.remotePlan?.[this.name]
        if (!plan?.rooms) {
            return
        }
        plan.carryActive = 0
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (!state) {
                continue
            }
            // 旧任务 id 已经随 Memory.rooms 一起被清了
            delete state.carryTaskIds
            if (state.enabled === false) {
                continue
            }
            for (const sourceId in state.sources ?? {}) {
                const containerId = state.sources[sourceId]?.containerId
                if (!containerId) {
                    continue
                }
                this.registerRemoteCarryTask(roomName, sourceId, containerId)
            }
        }
    }

    /**
     * 是否有可领的外矿回运任务。O(1) 读计数器，不给 carrier 额外做遍历。
     */
    hasRemoteCarryTask(): boolean {
        return (Memory.remotePlan?.[this.name]?.carryActive ?? 0) > 0
    }

    /**
     * link 建成/发现后，把 linkId 补进对应 container 的任务参数。
     */
    updateRemoteCarryLink(containerId: string, linkId: Id<StructureLink>): void {
        const plan = Memory.remotePlan?.[this.name]
        let taskId: string | undefined
        for (const roomName in plan?.rooms ?? {}) {
            const state = plan.rooms[roomName]
            if (state?.carryTaskIds?.[containerId]) {
                taskId = state.carryTaskIds[containerId]
                break
            }
        }
        if (!taskId) {
            return
        }
        const buckets = this.memory.creepTask?.remoteCarryTask
        if (!buckets) {
            return
        }
        for (const key in buckets) {
            for (const task of buckets[key] ?? []) {
                if (task.id === taskId) {
                    task.taskParam[4] = linkId
                    return
                }
            }
        }
    }

    /**
     * link 建成事件：坐标对上规划位就把 linkId 记下来并补进外矿任务。
     */
    onLinkBuilt(link: StructureLink): void {
        const pos: [number, number] = [link.pos.x, link.pos.y]
        const linkId = link.id as Id<StructureLink>
        const linkPlan = this.memory.linkPlan
        if (linkPlan?.corePos && this.samePos(linkPlan.corePos, pos)) {
            linkPlan.coreId = linkId
        }
        if (linkPlan?.sources) {
            for (const sourceId in linkPlan.sources) {
                const entry = linkPlan.sources[sourceId]
                if (entry?.pos && this.samePos(entry.pos, pos)) {
                    entry.id = linkId
                }
            }
        }
        if (linkPlan?.remotes) {
            for (const roomName in linkPlan.remotes) {
                const entry = linkPlan.remotes[roomName]
                if (entry?.pos && this.samePos(entry.pos, pos)) {
                    entry.id = linkId
                }
            }
        }
        // 外矿 link 的 id 要写进顶层 memory（推代码后还在），并把任务参数补上
        const plan = Memory.remotePlan?.[this.name]
        for (const roomName in plan?.rooms ?? {}) {
            const state = plan.rooms[roomName]
            const remotePos = state?.remoteLinkPos
            if (!state || !remotePos) {
                continue
            }
            if (!this.samePos(remotePos, pos)) {
                continue
            }
            state.remoteLinkId = linkId
            for (const containerId in state.carryTaskIds ?? {}) {
                this.updateRemoteCarryLink(containerId, linkId)
            }
        }
    }

    /**
     * link 规划/补工地：
     * - 中央 link：布局里的 L 格（plan1 / plan2_Core）
     * - 矿点 link：贴着矿点 container，但不贴矿点（优先）
     * - 外矿 link：主房里靠近通往该外矿的出口，取离出口 3~6 格
     * 建造优先级：中央 > 外矿（离中央越远越先）> 矿点；
     * 数量只补到当前 RCL 上限，已建/已有工地的规划位只回填 id。
     */
    syncLinkPlan(): void {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return
        }
        const corePos = this.layoutLinkPos()
        if (!corePos) {
            return
        }
        const plan = this.memory.linkPlan ?? (this.memory.linkPlan = {})
        plan.corePos = corePos
        const assigned: [number, number][] = [corePos]

        // 矿点 link：container 位置来自 containerPos() 的缓存（全局重置后会重算）
        const sources = plan.sources ?? (plan.sources = {})
        for (const sourceId of this.sources()) {
            const cached = sources[sourceId]?.pos
            if (cached) {
                assigned.push(cached)
                continue
            }
            const pos = this.sourceLinkPos(sourceId, assigned)
            if (pos) {
                sources[sourceId] = { pos }
                assigned.push(pos)
            }
        }

        // 外矿 link：位置持久化在顶层 remotePlan 里，推代码后不用重新寻路
        const remotes = plan.remotes ?? (plan.remotes = {})
        const remotePlan = Memory.remotePlan?.[this.name]
        for (const roomName in remotePlan?.rooms ?? {}) {
            const state = remotePlan.rooms[roomName]
            if (!state || state.enabled === false) {
                continue
            }
            // 还没探明/还没 container 的房先不给 link，别占掉有限的 link 名额
            if (!this.remoteRoomHasContainer(state)) {
                continue
            }
            let pos = state.remoteLinkPos
            if (!pos) {
                pos = this.computeRemoteLinkPos(roomName, assigned)
                if (pos) {
                    state.remoteLinkPos = pos
                }
            }
            if (!pos) {
                continue
            }
            remotes[roomName] = { pos }
            assigned.push(pos)
        }

        // 回填/清理 id：结构被拆后旧 id 不能留着
        plan.coreId = this.linkIdAt(corePos)
        if (plan.coreId === undefined) {
            delete plan.coreId
        }
        for (const sourceId in sources) {
            const id = this.linkIdAt(sources[sourceId].pos)
            if (id) {
                sources[sourceId].id = id
            } else {
                delete sources[sourceId].id
            }
        }
        for (const roomName in remotes) {
            const entry = remotes[roomName]
            const id = this.linkIdAt(entry.pos)
            if (id) {
                entry.id = id
            } else {
                delete entry.id
            }
            const state = Memory.remotePlan?.[this.name]?.rooms?.[roomName]
            if (state) {
                if (id) {
                    state.remoteLinkId = id
                } else {
                    delete state.remoteLinkId
                }
            }
        }

        // 外矿/矿点 link 有能量就转发中央 link。
        // 不能只在 creep 投递成功当 tick 转发：transfer 是 intent，回合末才结算，
        // 当 tick 读到的 link.energy 还是 0。放这里按 10 tick 扫描兜底。
        this.forwardRemoteLinks(plan)

        // 按优先级补工地，数量受 RCL 的 link 上限约束
        const level = this.controller.level
        const limit = (CONTROLLER_STRUCTURES[STRUCTURE_LINK] as any)[level] ?? 0
        const built = this.find(FIND_MY_STRUCTURES, {
            filter: (structure: Structure) => structure.structureType === STRUCTURE_LINK
        }).length
        const sites = this.find(FIND_CONSTRUCTION_SITES, {
            filter: (site: ConstructionSite) => site.structureType === STRUCTURE_LINK
        }).length
        let slots = limit - built - sites
        plan.order = this.linkBuildOrder(corePos)
        if (slots <= 0) {
            return
        }
        for (const key of plan.order) {
            if (slots <= 0) {
                break
            }
            const pos = this.linkPlanPosOfKey(key, plan)
            if (!pos) {
                continue
            }
            if (this.linkIdAt(pos)) {
                continue
            }
            if (this.siteAt(pos)) {
                continue
            }
            if (!this.linkTileFree(pos)) {
                continue
            }
            if (this.createConstructionSite(pos[0], pos[1], STRUCTURE_LINK) !== OK) {
                continue
            }
            slots--
            // 当 tick 就把新工地登记进建造队列，不用等下一次 initBuildList
            const site = this.getPositionAt(pos[0], pos[1])?.lookFor(LOOK_CONSTRUCTION_SITES)[0]
            if (site && !this.hasBuildTaskFor(site.id)) {
                this.registTask(createBuildTask([site]))
            }
        }
    }

    /**
     * 布局里中央 link（大写 L）的坐标，公式和 constructPlan1 / buildLayout 保持一致。
     */
    private layoutLinkPos(): [number, number] | undefined {
        const planType = this.memory.roomPlanType
        const anchor = planType === 2 ? this.memory.plan2Pos?.core : this.memory.plan1Pos
        if (!anchor) {
            return undefined
        }
        const map = planType === 2 ? plan2_Core : plan1
        // plan1: anchor + x - 11；plan2: anchor + x - 7 + 1
        const offset = planType === 2 ? 1 : 0
        for (let y = 0; y < map.length; y++) {
            const row = map[y].split(' ')
            for (let x = 0; x < row.length; x++) {
                if (row[x][0] !== 'L') {
                    continue
                }
                return [anchor[0] + x - map.length + offset, anchor[1] + y - map.length + offset]
            }
        }
        return undefined
    }

    /**
     * 矿点 link 位置：贴着矿点 container，但不贴矿点（用户指定的优先规则）。
     * 没有非贴矿点的空格时才退回到贴矿点的 container 邻格。
     */
    private sourceLinkPos(sourceId: string, assigned: [number, number][]): [number, number] | undefined {
        const container = this.memory.containerPosById?.[sourceId]
        if (!container) {
            return undefined
        }
        const source = Game.getObjectById<Source>(sourceId as Id<Source>)
        if (!source) {
            return undefined
        }
        const corePos = this.memory.linkPlan?.corePos
        const core = corePos ? this.getPositionAt(corePos[0], corePos[1]) : undefined
        const preferred: RoomPosition[] = []
        const fallback: RoomPosition[] = []
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) {
                    continue
                }
                const x = container[0] + dx
                const y = container[1] + dy
                if (assigned.some(item => item[0] === x && item[1] === y)) {
                    continue
                }
                if (!this.linkTileFree([x, y])) {
                    continue
                }
                const pos = this.getPositionAt(x, y)
                if (!pos) {
                    continue
                }
                // 贴矿点：harvester 站位/采集路径会被 link 占掉，只能兜底
                if (pos.inRangeTo(source, 1)) {
                    fallback.push(pos)
                } else {
                    preferred.push(pos)
                }
            }
        }
        const pick = (list: RoomPosition[]): [number, number] | undefined => {
            if (!list.length) {
                return undefined
            }
            if (!core) {
                return [list[0].x, list[0].y]
            }
            const best = core.findClosestByRange(list)
            return best ? [best.x, best.y] : undefined
        }
        return pick(preferred) ?? pick(fallback)
    }

    /**
     * 外矿 link 位置：主房里靠近通往该外矿的出口，沿中央 link -> 出口的路径
     * 取离出口 3~6 格的第一块空地（太贴边容易被过路 creep 堵，太远省不了路）。
     */
    private computeRemoteLinkPos(remoteRoom: string, assigned: [number, number][]): [number, number] | undefined {
        const exits = Game.map.describeExits(this.name)
        if (!exits) {
            return undefined
        }
        let dirKey: string | undefined
        for (const key in exits) {
            if (exits[key] === remoteRoom) {
                dirKey = key
                break
            }
        }
        if (!dirKey) {
            return undefined
        }
        const exitFind: { [dir: string]: FindConstant } = {
            '1': FIND_EXIT_TOP, '3': FIND_EXIT_RIGHT, '5': FIND_EXIT_BOTTOM, '7': FIND_EXIT_LEFT,
        }
        if (exitFind[dirKey] === undefined) {
            return undefined
        }
        const exitTiles = this.find(exitFind[dirKey]) as RoomPosition[]
        if (!exitTiles.length) {
            return undefined
        }
        const corePos = this.memory.linkPlan?.corePos
        const core = corePos ? this.getPositionAt(corePos[0], corePos[1]) : undefined
        if (!core) {
            return undefined
        }
        const exitTile = core.findClosestByPath(exitTiles, {ignoreCreeps: true})
            ?? core.findClosestByRange(exitTiles)
        if (!exitTile) {
            return undefined
        }
        const borderDistance = (x: number, y: number): number => {
            if (dirKey === '3') return 49 - x
            if (dirKey === '7') return x
            if (dirKey === '5') return 49 - y
            return y
        }
        const isVertical = dirKey === '1' || dirKey === '5'
        const path = this.findPath(core, exitTile, {ignoreCreeps: true, ignoreDestructibleStructures: true})
        // 从出口往回扫：路径上第一块落在 3~6 格带内、没建筑/工地的格子
        for (let i = path.length - 1; i >= 0; i--) {
            const step = path[i]
            const distance = borderDistance(step.x, step.y)
            if (distance < 3 || distance > 6) {
                continue
            }
            if (assigned.some(item => item[0] === step.x && item[1] === step.y)) {
                continue
            }
            if (!this.linkTileFree([step.x, step.y])) {
                continue
            }
            return [step.x, step.y]
        }
        // 路径被建筑占满时，在出口附近小块区域兜底
        for (const depth of [3, 4, 5, 6]) {
            for (const along of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
                const x = isVertical ? exitTile.x + along : (dirKey === '3' ? 49 - depth : depth)
                const y = isVertical ? (dirKey === '5' ? 49 - depth : depth) : exitTile.y + along
                if (x < 0 || x > 49 || y < 0 || y > 49) {
                    continue
                }
                if (assigned.some(item => item[0] === x && item[1] === y)) {
                    continue
                }
                if (!this.linkTileFree([x, y])) {
                    continue
                }
                return [x, y]
            }
        }
        return undefined
    }

    /**
     * 外矿房是否已经有可回运的 container（或回运任务）。
     * 只看过顶层缓存，不扫描世界。
     */
    private remoteRoomHasContainer(state: RemoteRoomState): boolean {
        for (const containerId in state.carryTaskIds ?? {}) {
            if (containerId) {
                return true
            }
        }
        for (const sourceId in state.sources ?? {}) {
            const entry = state.sources[sourceId]
            if (entry?.containerId || entry?.containerPos) {
                return true
            }
        }
        return false
    }

    /**
     * 建造顺序：中央 > 外矿（离中央越远越先）> 矿点（同样远的先建）。
     */
    private linkBuildOrder(corePos: [number, number]): string[] {
        const plan = this.memory.linkPlan
        if (!plan) {
            return []
        }
        const remotePlan = Memory.remotePlan?.[this.name]
        const rangeOf = (pos: [number, number]) =>
            Math.max(Math.abs(corePos[0] - pos[0]), Math.abs(corePos[1] - pos[1]))
        const remotes = Object.keys(plan.remotes ?? {})
            .filter(roomName => remotePlan?.rooms?.[roomName]
                && remotePlan.rooms[roomName].enabled !== false
                && this.remoteRoomHasContainer(remotePlan.rooms[roomName])
                && plan.remotes?.[roomName]?.pos)
            .sort((a, b) => rangeOf(plan.remotes![b].pos) - rangeOf(plan.remotes![a].pos))
        const sources = Object.keys(plan.sources ?? {})
            .filter(sourceId => plan.sources?.[sourceId]?.pos)
            .sort((a, b) => rangeOf(plan.sources![b].pos) - rangeOf(plan.sources![a].pos))
        return [
            'core',
            ...remotes.map(roomName => `remote:${roomName}`),
            ...sources.map(sourceId => `source:${sourceId}`),
        ]
    }

    /**
     * 把外矿/矿点 link 里攒下的能量转发给中央 link。
     * 每个 link 有 20 tick 发送冷却，这里按扫描频率尝试即可；
     * 中央 link 满了就先不转，等 carrier 取走后再转。
     */
    private forwardRemoteLinks(plan: LinkPlan): void {
        if (!plan.coreId) {
            return
        }
        const core = Game.getObjectById<StructureLink>(plan.coreId)
        if (!core) {
            return
        }
        if (core.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
            return
        }
        const linkIds: Id<StructureLink>[] = []
        for (const roomName in plan.remotes ?? {}) {
            const id = plan.remotes[roomName].id
            if (id) {
                linkIds.push(id)
            }
        }
        for (const sourceId in plan.sources ?? {}) {
            const id = plan.sources[sourceId].id
            if (id) {
                linkIds.push(id)
            }
        }
        for (const linkId of linkIds) {
            if (core.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
                return
            }
            const link = Game.getObjectById<StructureLink>(linkId)
            if (!link || link.cooldown > 0 || !link.store.getUsedCapacity(RESOURCE_ENERGY)) {
                continue
            }
            link.transferEnergy(core)
        }
    }

    private linkPlanPosOfKey(key: string, plan: LinkPlan): [number, number] | undefined {
        if (key === 'core') {
            return plan.corePos
        }
        if (key.startsWith('remote:')) {
            return plan.remotes?.[key.slice(7)]?.pos
        }
        if (key.startsWith('source:')) {
            return plan.sources?.[key.slice(7)]?.pos
        }
        return undefined
    }

    private samePos(a: [number, number], b: [number, number]): boolean {
        return a[0] === b[0] && a[1] === b[1]
    }

    /**
     * 指定格子上的 link；没有就返回 undefined。
     */
    private linkIdAt(pos: [number, number]): Id<StructureLink> | undefined {
        const structures = this.getPositionAt(pos[0], pos[1])?.lookFor(LOOK_STRUCTURES) ?? []
        for (const structure of structures) {
            if (structure.structureType === STRUCTURE_LINK) {
                return structure.id as Id<StructureLink>
            }
        }
        return undefined
    }

    private siteAt(pos: [number, number]): ConstructionSite | undefined {
        return this.getPositionAt(pos[0], pos[1])?.lookFor(LOOK_CONSTRUCTION_SITES)[0]
    }

    /**
     * link 可以放：不是墙、没有建筑、没有工地。
     */
    private linkTileFree(pos: [number, number]): boolean {
        const terrain = this.getTerrain()
        if (terrain.get(pos[0], pos[1]) === TERRAIN_MASK_WALL) {
            return false
        }
        const position = this.getPositionAt(pos[0], pos[1])
        if (!position) {
            return false
        }
        if (position.lookFor(LOOK_STRUCTURES).length) {
            return false
        }
        if (position.lookFor(LOOK_CONSTRUCTION_SITES).length) {
            return false
        }
        return true
    }

    private hasBuildTaskFor(siteId: string): boolean {
        const buckets = this.memory.creepTask?.constructTask
        for (const key in buckets ?? {}) {
            for (const task of buckets[key] ?? []) {
                if ((task.targetId ?? task.taskParam?.[0]) === siteId) {
                    return true
                }
            }
        }
        return false
    }

    /**
     * 中央 link：link 规划/建好后才有。
     */
    getCoreLink(): StructureLink | undefined {
        const id = this.memory.linkPlan?.coreId
        if (!id) {
            return undefined
        }
        return Game.getObjectById<StructureLink>(id) ?? undefined
    }

    /**
     * 从顶层 memory 里查这个外矿房对应的 link（还在不在由引擎判定）。
     */
    private remoteLinkOfRoom(remoteRoom: string): Id<StructureLink> | undefined {
        const linkId = Memory.remotePlan?.[this.name]?.rooms?.[remoteRoom]?.remoteLinkId
        if (!linkId) {
            return undefined
        }
        const link = Game.getObjectById<StructureLink>(linkId)
        return link ? link.id as Id<StructureLink> : undefined
    }

    /**
     * 从顶层 index 里删一个 container 的登记，并修正计数器。
     */
    private dropRemoteCarryIndex(containerId?: string, remoteRoom?: string): void {
        if (!containerId) {
            return
        }
        const plan = Memory.remotePlan?.[this.name]
        if (!plan?.rooms) {
            return
        }
        let removed = false
        const roomNames = remoteRoom ? [remoteRoom] : Object.keys(plan.rooms)
        for (const roomName of roomNames) {
            const state = plan.rooms[roomName]
            const ids = state?.carryTaskIds
            if (ids && ids[containerId]) {
                delete ids[containerId]
                removed = true
                break
            }
        }
        if (removed) {
            plan.carryActive = Math.max(0, (plan.carryActive ?? 0) - 1)
        }
    }

    /**
     * 按每个外矿矿点补 remoteHarvester（和主矿 ensureHarvesterForSource 同一套思路）：
     * 覆盖判定看 creep 的绑定矿点，排队判定看 spawn 任务里带的矿点，
     * 孵化时把矿点 id 写进 harvestSourceId，新 creep 才会只认这一个矿。
     */
    private refreshRemoteHarvesterSpawn(plan: RemotePlan): void {
        // 旧逻辑留下的、没绑定矿点的孵化任务没法计入任何一个矿点的覆盖，直接清掉
        this.cancelUnboundRemoteHarvestSpawnTasks()
        if (!plan.force && !this.remoteGate()) {
            return
        }
        const body = getBody('remoteHarvester', this)
        const spawnTicks = calcSpawnTicks(body)
        const ticksPerTile = calcTicksPerTile(body)
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (!state || state.enabled === false) {
                continue
            }
            // 赶路距离按房间数估：相邻房最远 50 格，再留 25 格余量
            const travel = Game.map.getRoomLinearDistance(this.name, roomName) * 50 + 25
            const threshold = spawnTicks + travel * ticksPerTile + harvestSetting.earlyMargin
            for (const sourceId in state.sources ?? {}) {
                if (this.remoteHarvestCovered(sourceId, threshold)) {
                    // 有健康的人就清掉多余替补，避免扫描间隔内重复排队
                    this.cancelRemoteHarvestSpawnTasks(sourceId)
                    continue
                }
                if (this.remoteHarvestPending(sourceId)) {
                    continue
                }
                this.addToSpawnList('remoteHarvester', sourceId as Id<Source>, roomName)
            }
        }
    }

    /**
     * 这个矿点是否有健康的外矿 harvester：绑定到该矿点、没被召回、剩余寿命够换班。
     * 绑定信息优先读 harvestSourceId，推代码后老 creep 退回 currentWork 里的矿点。
     */
    private remoteHarvestCovered(sourceId: string, threshold: number): boolean {
        for (const name in Game.creeps) {
            const creep = Game.creeps[name]
            if (creep.memory.spawnRoom !== this.name
                || creep.memory.role !== 'remoteHarvester'
                || creep.memory.recall) {
                continue
            }
            if (this.remoteHarvestSourceOf(creep) !== sourceId) {
                continue
            }
            if (creep.ticksToLive === undefined || creep.ticksToLive > threshold) {
                return true
            }
        }
        return false
    }

    /**
     * 该矿点是否已经排了孵化/正在孵化（spawn 任务或 spawning 中的 creep 带同一矿点）
     */
    private remoteHarvestPending(sourceId: string): boolean {
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            for (const task of spawnBuckets[key] ?? []) {
                if (task?.taskParam?.[0] === 'remoteHarvester'
                    && task?.taskParam?.[2] === sourceId) {
                    return true
                }
            }
        }
        for (const spawn of this.find(FIND_MY_SPAWNS)) {
            const spawningName = spawn.spawning?.name
            const spawningMemory = spawningName ? Memory.creeps[spawningName] : undefined
            if (spawningMemory && spawningMemory.role === 'remoteHarvester'
                && spawningMemory.harvestSourceId === sourceId) {
                return true
            }
        }
        return false
    }

    private remoteHarvestSourceOf(creep: Creep): string | undefined {
        return (creep.memory.harvestSourceId
            ?? creep.memory.currentWork?.taskParam?.[0]) as string | undefined
    }

    private cancelRemoteHarvestSpawnTasks(sourceId: string): void {
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            const queue = spawnBuckets[key]
            if (!queue || !queue.length) {
                continue
            }
            const next = queue.filter(task =>
                !(task?.taskParam?.[0] === 'remoteHarvester' && task?.taskParam?.[2] === sourceId))
            if (next.length) {
                spawnBuckets[key] = next
            } else {
                delete spawnBuckets[key]
            }
        }
    }

    private cancelUnboundRemoteHarvestSpawnTasks(): void {
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            const queue = spawnBuckets[key]
            if (!queue || !queue.length) {
                continue
            }
            const next = queue.filter(task =>
                !(task?.taskParam?.[0] === 'remoteHarvester' && !task?.taskParam?.[2]))
            if (next.length) {
                spawnBuckets[key] = next
            } else {
                delete spawnBuckets[key]
            }
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
            const container = this.containerById(id)
            if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) >= watermark.high) {
                return true
            }
        }
        return false
    }

    /**
     * 取能 container：按 getContainer() 的顺序（离阵型中心由近到远）扫描，
     * 先找一车能装满的，没有就退回最近的、高于低水位的那个。
     * carrier 不需要分散，越近越好；worker 的分散交给任务队列的 reservedBy 排序。
     * 给 carryTask 自带取能用：carrier 保持 priority 1 的补能任务，
     * 不需要降级成 emptyWorker 去和 worker 抢通用 energyTask。
     */
    bestEnergyContainer(freeCapacity = 0): StructureLink | StructureContainer | undefined {
        const level = this.controller ? this.controller.level : 0
        const low = (containerWatermark[level] ?? containerWatermark[0]).low
        // 中央 link 优先搬：外矿 link 转发过来的能量堆在这里，满了外矿 carrier
        // 就只能绕路回主房投递。link 在基地核心，取一趟很短，有能量就顺路带走；
        // 取空后下一 tick 自然回退到 container。后面由专用中央 carrier 接管。
        const core = this.getCoreLink()
        if (core && core.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            return core
        }
        let fallback: StructureContainer | undefined
        for (const id of this.getContainer()) {
            const container = this.containerById(id)
            if (!container) {
                continue
            }
            const energy = container.store.getUsedCapacity(RESOURCE_ENERGY)
            if (energy <= low) {
                continue
            }
            if (!fallback) {
                fallback = container
            }
            // 够装满这一车就直接拿，少跑一趟
            if (energy >= freeCapacity) {
                return container
            }
        }
        return fallback
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
            const container = this.containerById(id)
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
     * 清掉停用房/已移出计划房的外矿任务。
     * syncRemoteBucket 在没视野时会保留找不到目标的任务（避免误删），
     * 但停用是明确决定，不能等视野。房后来被我们 claim 时会从 plan 删除，
     * 也走这里，避免旧任务继续把人派过去。
     */
    private purgeRemoteTasksOf(plan: RemotePlan): void {
        const allowed: { [roomName: string]: boolean } = {}
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName]
            if (state && state.enabled !== false) {
                allowed[roomName] = true
            }
        }
        for (const taskType of ['remoteHarvestTask', 'remoteCarryTask'] as TaskType[]) {
            const buckets = this.memory.creepTask?.[taskType]
            if (!buckets) {
                continue
            }
            for (const key in buckets) {
                const queue = buckets[key]
                if (!queue || !queue.length) {
                    continue
                }
                const next: TaskEntity[] = []
                for (const task of queue) {
                    const roomName = task?.taskParam?.[1] as string | undefined
                    if (!roomName || !!allowed[roomName]) {
                        next.push(task)
                        continue
                    }
                    // 回运任务被清：同步删掉顶层 index，并修正计数器
                    if (taskType === 'remoteCarryTask') {
                        this.dropRemoteCarryIndex(task.taskParam?.[0], roomName)
                    }
                }
                if (next.length) {
                    buckets[key] = next
                } else {
                    delete buckets[key]
                }
            }
        }
        // 已经排上的外矿 harvester 孵化任务也要撤掉，别把 creep 派去送死
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask')
        for (const key in spawnBuckets) {
            const queue = spawnBuckets[key]
            if (!queue || !queue.length) {
                continue
            }
            const next = queue.filter(task => {
                if (task?.taskParam?.[0] !== 'remoteHarvester') {
                    return true
                }
                const roomName = task.taskParam?.[4] as string | undefined
                return !roomName || !!allowed[roomName]
            })
            if (next.length) {
                spawnBuckets[key] = next
            } else {
                delete spawnBuckets[key]
            }
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
                || creep.memory.recall) {
                continue
            }
            // 推代码后 harvestSourceId 可能还没写回，退回 currentWork 里的矿点
            const sourceId = this.remoteHarvestSourceOf(creep)
            if (!sourceId) {
                continue
            }
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
            // 外矿运输不特招：本地 carrier 没活时按回运任务自动转换，配额保持 0
            'remoteCarrier': 0,
            // 侦察兵不参与自动补员：refreshScoutSpawn 常驻维持 1 个
            'viewer': 0,
            // claimer 同理：refreshClaimSpawn 按 reserve 到期/claimPlan 按需补
            'claimer': 0,
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
                // claimer 绑定的目标房也要保住，否则每次推代码都会解绑回主房重孵
                const savedClaimerTarget = creep.memory.claimerTarget
                // 外矿召回标记也要保住：否则推代码后召回过的 harvester 会重新领任务
                // 跑回停用房；保住后它继续在主房待命到死
                const savedRecall = creep.memory.recall
                delete Memory.creeps[creepName]
                creep.remember()
                creep.memory.spawnRoom = this.name
                if (savedWork) {
                    creep.memory.currentWork = savedWork
                    creep.memory.currentWorkType = savedWorkType
                    creep.memory.working = true
                }
                if (savedClaimerTarget) {
                    creep.memory.claimerTarget = savedClaimerTarget
                }
                if (savedRecall) {
                    creep.memory.recall = true
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
                if (role === 'harvester' || role === 'remoteHarvester') {
                    if (assignedSource) {
                        creep.memory.harvestSourceId = assignedSource
                    }
                    // 只有主矿 harvester 有换班事件；外矿补员由 10 tick 扫描按矿点补
                    if (role === 'harvester') {
                        this.scheduleHarvesterHandover(creep)
                    }
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

    addToSpawnList(role: Role, sourceId?: Id<Source>, targetRoom?: string) {
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
            // 第三、四、五个参数：矿点 id（提前换班的 harvester 只认这个矿点）、
            // reSpawn 标记、目标房（claimer 绑定要驻守/占领的房）。
            // 外矿/侦察角色的补员统一由扫描逻辑决定，死亡后不走
            // creepRecycle 无条件重孵：否则两者会在死亡同一 tick 各补一只（竞态超编），
            // 停用房也会继续补人
            taskParam: [role, getBody(role, this), sourceId,
                role !== 'remoteHarvester' && role !== 'remoteCarrier' && role !== 'viewer'
                && role !== 'claimer',
                targetRoom],
            // 记录排队时间：spawn 等能量超过阈值后会按当前能量缩小体型兜底，
            // 避免 carrier 全灭时 priority 0 的大体型任务把整队堵死
            queuedAt: Game.time,
            // 记录排队时的能量高水位：能量还在增长就说明房间在回血，先不缩体型
            queuedEnergy: this.energyAvailable,
            createdAt: Game.time,
            // 外矿/侦察兵排在最后：本地换班/补员都做完了才轮得到它们
            priority: role == 'harvester' ? 0
                : role == 'carrier' ? 1
                : role == 'viewer' ? 2
                : role == 'remoteHarvester' ? 3
                : role == 'remoteCarrier' ? 3
                : role == 'claimer' ? 3
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
        // 只有在本房里采的才算覆盖：跑丢到隔壁房的 creep 虽然还挂着预约，
        // 但它根本没在挖这个矿，不能因此不补人
        const covered = reservers.concat(miners)
            .some(creep => creep.room.name === this.name && isHealthy(creep))
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
            // 新建 link：坐标对上规划位时把 linkId 补进对应外矿回运任务
            if (structure.structureType === STRUCTURE_LINK) {
                this.onLinkBuilt(structure as StructureLink)
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
    registTask(tasks: MyTask[]): TaskEntity[] {
        const created: TaskEntity[] = []
        for (const task of tasks) {
            const bucketKey = String(task.priority ?? 2)
            const buckets = this.normalizeTaskBuckets(task.taskType)
            if (!buckets[bucketKey]) {
                buckets[bucketKey] = []
            }
            const entity: TaskEntity = {
                id: `${task.taskFunc}-${Game.time}-${Math.random().toString(36).slice(2)}`,
                taskFunc: task.taskFunc,
                taskParam: task.taskParam,
                priority: task.priority ?? 2,
                capacity: task.capacity ?? 1,
                persistent: task.persistent ?? false,
                targetId: task.targetId,
                reservedBy: []
            }
            buckets[bucketKey].push(entity)
            this.memory.creepTask[task.taskType] = buckets
            created.push(entity)
        }
        return created
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
     * 容器 id 列表。新建由 buildOver 立即刷新；被拆时由第一个撞到死 id 的
     * 调用方（containerById）登记下一 tick 的刷新，不再定时全量扫描。
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
        // 按到阵型中心的距离排序：近的排前面，carrier 取能和任务队列的插入顺序都直接受益。
        // 只排缓存列表，不改 containerPos()：那里的下标还和旧缓存/矿点映射绑定。
        const anchor = this.memory.roomPlanType === 2 && this.memory.plan2Pos?.core
            ? this.memory.plan2Pos.core
            : this.memory.plan1Pos
        if (anchor) {
            const center = this.getPositionAt(anchor[0], anchor[1])
            if (center) {
                containers.sort((a, b) => {
                    const containerA = Game.getObjectById<StructureContainer>(a)
                    const containerB = Game.getObjectById<StructureContainer>(b)
                    if (!containerA || !containerB) {
                        return 0
                    }
                    return center.getRangeTo(containerA) - center.getRangeTo(containerB)
                })
            }
        }
        global.room[this.name].container = containers
        return containers
    }

    /**
     * 按 id 取 container。id 已经失效（container 被拆）时登记下一 tick 的刷新，
     * 把死 id 从缓存里清掉；正常取到的路径和 Game.getObjectById 一样便宜。
     */
    containerById(id: Id<StructureContainer>): StructureContainer | undefined {
        const container = Game.getObjectById<StructureContainer>(id)
        if (!container) {
            this.requestContainerRefresh()
        }
        return container
    }

    /**
     * 补建 container 工地后的下一 tick：把该位置的工地登记进建造任务。
     * 工地创建当 tick 查不到，所以要事件延后一 tick。
     */
    registerContainerSiteTask(x: number, y: number): void {
        const pos = this.getPositionAt(x, y)
        const site = pos?.lookFor(LOOK_CONSTRUCTION_SITES)
            .find(item => item.structureType === STRUCTURE_CONTAINER)
        if (site && !this.hasBuildTaskFor(site.id)) {
            this.registTask(createBuildTask([site]))
        }
    }

    /**
     * 容器被拆后的缓存清理：下一 tick 重扫一次 container 列表。
     * 同一 tick 里多个 creep/任务同时撞到死 id 只登记一次。
     */
    requestContainerRefresh(): void {
        if (!global.room[this.name]) {
            global.room[this.name] = {}
        }
        const cache = global.room[this.name]
        if (cache.containerRefreshQueuedTick === Game.time) {
            return
        }
        cache.containerRefreshQueuedTick = Game.time
        this.registEvent({
            triggerTime: Game.time + 1,
            triggerFunc: 'refreshContainers',
            param: []
        })
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
                // 能走到这里说明矿点周围已经没有 container / 工地，缓存坐标是旧 container 的位置。
                // 优先在原位置补工地：坐标不变，路径和 link 规划都不用重算；
                // 只有原位置已经被别的建筑占了，才丢掉缓存走下面的重新选点。
                if (pos && !pos.lookFor(LOOK_STRUCTURES).length && !pos.lookFor(LOOK_CONSTRUCTION_SITES).length) {
                    rememberPos(item, pos)
                    if (this.createConstructionSite(pos.x, pos.y, STRUCTURE_CONTAINER) === OK) {
                        // 新工地当 tick 查不到（引擎下一 tick 才生效），下 tick 再登记建造任务。
                        // 下一个 checkRoomLevel 可能要几千 tick，不能等它。
                        this.registEvent({
                            triggerTime: Game.time + 1,
                            triggerFunc: 'registerContainerSiteTask',
                            param: [pos.x, pos.y]
                        })
                    }
                    return
                }
                delete byId[item]
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
            // 工地任务统一由 initBuildList 的 createBuildTask 按真实工地列表登记，
            // 这里不再单独注册：以前这里会注册 taskFunc 'construct' 的任务，
            // 而 Creep 上没有 construct 方法，worker 领到就会每 tick 抛错卡死。
            this.createConstructionSite(finalPos.x, finalPos.y, STRUCTURE_CONTAINER)
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

    /**
     * 清掉前主人留下的 constructedWall。
     * 引擎把所有 constructedWall 都当无主结构（API 里没有 owner/my），
     * 无法按归属区分，所以只在每个房间第一次初始化时清一次，
     * 之后建的墙不会再动。清墙标记放顶层 Memory，能扛住 globalInit 的 delete Memory.rooms。
     * 有敌对 creep 时 destroy 返回 ERR_BUSY，标记不落，下一轮 initBuildList 自动重试。
     */
    clearLegacyWalls() {
        if (Memory.legacyWallCleared?.[this.name]) {
            return
        }
        if (!this.controller || !this.controller.my) {
            return
        }
        // ticksToLive 只出现在自动生成的新手区边界墙上，这种墙不能拆
        const walls = this.find(FIND_STRUCTURES, {
            filter: (s: Structure) =>
                s.structureType === STRUCTURE_WALL && !(s as StructureWall).ticksToLive,
        }) as StructureWall[]

        let failed = 0
        if (walls.length) {
            let cleared = 0
            for (const wall of walls) {
                if (wall.destroy() === OK) {
                    cleared++
                } else {
                    failed++
                }
            }
            log.info(`[${this.name}] legacy walls: destroyed ${cleared}, failed ${failed}`)
            if (failed) {
                return
            }
        }

        if (!Memory.legacyWallCleared) {
            Memory.legacyWallCleared = {}
        }
        Memory.legacyWallCleared[this.name] = true
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
