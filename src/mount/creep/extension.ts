import { getEnergyTask } from "@/task/roomTask";
import { remoteSetting } from "@/setting";
import log from "@/util/log";
import { recordRoomIntel } from "@/global/autoplan/remotePlan";
// import {getCarryList, getEnergyWithStorage} from "@/task/roomTask";

const roleToTask: { [role in Role]: TaskType[] } = {
    'harvester': ['harvestTask'],
    // 维修排在升级前，但维修任务总量受 repairSetting.maxTasks 限制，
    // 只有少数 worker 会短暂转去维修，修完后自动回来升级
    'worker': ['repairTask', 'wallRepairTask', 'upgradeTask', 'constructTask'],
    'emptyWorker': ['energyTask'],
    // 本地补能永远先认领，空闲时才去外矿拉货
    'carrier': ['carryTask', 'remoteCarryTask'],
    'remoteHarvester': ['remoteHarvestTask'],
    // 侦察兵只有一个常驻任务，自己从外矿计划里挑要探的房间
    'viewer': ['scoutTask'],
}

export default class CreepExtension extends Creep {

    /**
     * 在编写work函数的时候需要注意working标志和res返回的结果
     * res返回的结果表示此回合还需不需要继续
     * working的结果表示工作做完了没有
     * 因为creep的res的OK表示纳入计划, 最后在回合结束时统一结算, 所以会出现,工作做完了,但是这个回合不需要继续的情况
     */
    work() {
        // console.log(this.name)
        if (this.spawning) {
            // console.log(this.ticksToLive)
            return
        }
        let loop = 0
        while (loop < 4) {
            if (!this.memory.role) {
                log.error(this.name + " ERROR!")
                this.remember()
                return
            }
            if (!this.memory.working) {
                if (!this.getWork()) {
                    this.say('🤓 没活辣,随便走走')
                    const directions = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT]
                    const randIndex = Math.floor(Math.random() * directions.length)
                    this.move(directions[randIndex])
                    return
                }
            }
            const res = this[this.memory.currentWork.taskFunc](...this.memory.currentWork.taskParam);
            if (!res) {
                // false return , true not
                return
            }
            this.releaseCurrentWork()
            loop += 1
        }
        return
    }


    getWork(): boolean {
        const room = this.room
        if (!room.memory.creepTask) {
            return false
        }
        // console.log(this.memory.role)
        if (this.memory.role === 'emptyWorker' && room.memory.lastEnergyTaskTick !== Game.time) {
            const energyBuckets = room.normalizeTaskBuckets('energyTask')
            let hasEnergyTask = false
            for (const key in energyBuckets) {
                if (energyBuckets[key]?.length) {
                    hasEnergyTask = true
                    break
                }
            }
            if (!hasEnergyTask) {
                room.registTask(getEnergyTask(room))
            }
            room.memory.lastEnergyTaskTick = Game.time
        }
        const TaskList = roleToTask[this.memory.role]
        const now = Game.time
        // 提前换班孵化出来的 harvester 只认领孵化时指定的矿点
        const assignedSource = this.memory.role === 'harvester' ? this.memory.harvestSourceId : undefined
        for (const taskType of TaskList) {
            const buckets = room.normalizeTaskBuckets(taskType)
            if (!buckets) {
                continue
            }
            const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b)
            for (const key of keys) {
                let queue = buckets[String(key)]
                if (!queue || !queue.length) {
                    continue
                }
                if (taskType === 'harvestTask') {
                    if (assignedSource) {
                        // 指定的矿点优先；如果该矿点已满，再退回到其他矿点，避免替补原地发呆
                        queue = [...queue].sort((a, b) => {
                            const aMatched = a?.taskParam?.[0] === assignedSource ? 0 : 1
                            const bMatched = b?.taskParam?.[0] === assignedSource ? 0 : 1
                            return aMatched - bMatched
                        })
                    } else {
                        // 没指定矿点时优先选还没人预约的矿点，避免多个 harvester 挤在一个矿上
                        queue = [...queue].sort((a, b) =>
                            (a?.reservedBy?.length ?? 0) - (b?.reservedBy?.length ?? 0))
                    }
                } else if (taskType === 'energyTask') {
                    // 多个 container / 掉落物时优先去没人预约的，避免所有缺能量的 creep 挤在一个矿点
                    queue = [...queue].sort((a, b) =>
                        (a?.reservedBy?.length ?? 0) - (b?.reservedBy?.length ?? 0))
                }
                for (let i = 0; i < queue.length; i++) {
                    const task = queue[i]
                    if (!task) {
                        continue
                    }
                    if (task.capacity === undefined) {
                        task.capacity = 1
                    }
                    if (!task.reservedBy) {
                        task.reservedBy = []
                    }
                    // 清理已经死掉的 creep 留下的预约，否则 persistent 任务会被永久占满
                    task.reservedBy = task.reservedBy.filter(item => item && Game.creeps[item.name])
                    const existing = task.reservedBy.find(item => item.name === this.name)
                    if (existing) {
                        existing.lastTick = now
                    } else {
                        if (task.reservedBy.length >= task.capacity) {
                            continue
                        }
                        task.reservedBy.push({name: this.name, lastTick: now})
                    }
                    this.memory.currentWork = task 
                    this.memory.currentWorkType = taskType
                    this.memory.working = true
                    return true
                }
            }
        }
        // 身上有能量却找不到任务：emptyWorker 直接回原职业，避免带着能量发呆。
        // 正常回退发生在 getEnergyFromStructure / collectEnergy 成功分支里，
        // 但任务被清掉、只捡到部分能量时会漏掉，这里兜底。
        if (this.memory.role === 'emptyWorker'
            && this.memory.oldRole
            && this.memory.oldRole !== 'emptyWorker'
            && this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            const targetRole = this.memory.oldRole
            this.changeRole(targetRole)
            delete this.memory.oldRole
            return this.getWork()
        }
        // 没任务可做且身上没能量：转成 emptyWorker 去取能，避免原地空转。
        // 取满后由 getEnergyFromStructure 按 oldRole 回到原职业。
        // harvester / remoteHarvester 不参与（采集不耗能量），emptyWorker 本身不用再转。
        if (this.memory.role !== 'emptyWorker'
            && this.memory.role !== 'harvester'
            && this.memory.role !== 'remoteHarvester'
            && this.memory.role !== 'viewer'
            && this.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            this.changeRole('emptyWorker')
        }
        return false
    }

    changeRole(role: Role): boolean {
        if (!role) {
            return false
        }
        this.releaseCurrentWork()
        this.memory.oldRole = this.memory.role
        this.memory.role = role
        return true
    }

    releaseCurrentWork() {
        const task = this.memory.currentWork
        const taskType = this.memory.currentWorkType
        if (task && task.reservedBy) {
            task.reservedBy = task.reservedBy.filter(item => item.name !== this.name)
        }
        if (task && taskType) {
            const buckets = this.room.normalizeTaskBuckets(taskType)
            const taskId = task.id
            const taskTargetId = task.targetId ?? task.taskParam?.[0]
            for (const key in buckets) {
                const queue = buckets[key]
                if (!queue || !queue.length) {
                    continue
                }
                for (const item of queue) {
                    if (!item || !item.reservedBy) {
                        continue
                    }
                    if (item.id === taskId || (taskTargetId && item.targetId === taskTargetId)) {
                        item.reservedBy = item.reservedBy.filter(entry => entry.name !== this.name)
                    }
                }
            }
        }
        this.memory.working = false
        this.memory.currentWork = undefined
        this.memory.currentWorkType = undefined
    }

    removeCurrentWorkFromQueue() {
        const task = this.memory.currentWork
        const taskType = this.memory.currentWorkType
        if (!taskType || !task) {
            return
        }
        const buckets = this.room.normalizeTaskBuckets(taskType)
        if (!buckets) { 
            return
        }
        const taskId = task.id
        const taskTargetId = task.targetId ?? task.taskParam?.[0]
        for (const key in buckets) {
            const queue = buckets[key]
            if (!queue || !queue.length) {
                continue
            }
            for (let i = 0; i < queue.length; i++) {
                const item = queue[i]
                if (!item) {
                    continue
                }
                if (item.id === taskId || (taskTargetId && item.targetId === taskTargetId)) {
                    if (item.reservedBy && item.reservedBy.length) {
                        for (const reserver of item.reservedBy) {
                            if (!reserver || reserver.name === this.name) {
                                continue
                            }
                            Game.creeps[reserver.name]?.releaseCurrentWork()
                        }
                    }
                    queue.splice(i, 1)
                    if (!queue.length) {
                        delete buckets[key]
                    }
                    return
                }
            }
        }
    }

    harvestSource(sourceId: Id<any>, containerPosX?: number, ContainerPosY?: number): boolean {
        const source: Source = Game.getObjectById(sourceId)
        if (!source) {
            return true
        }
        this.say("⛏️007采矿")

        // 引擎的 harvest 溢出会先填进同一格的 container（_create-energy），
        // 所以站在 container 上持续 harvest 即可；transfer 会白占一个采集 tick。
        const standingOnContainer = this.pos.lookFor(LOOK_STRUCTURES)
            .some(item => item.structureType === STRUCTURE_CONTAINER)
        if (standingOnContainer && this.pos.inRangeTo(source, 1)) {
            this.harvest(source)
            return false
        }

        // taskParam 里的坐标可能是 container 建成前缓存的旧位置，优先找矿点旁真实的 container
        const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (object: any) => object.structureType === STRUCTURE_CONTAINER
        })[0] as StructureContainer | undefined
        if (container) {
            this.moveTo(container.pos, {visualizePathStyle: {stroke: '#ffffff'}})
            return false
        }

        // 没有 container / 工地位置时退化为直接贴着 source 采集
        if (containerPosX === undefined || ContainerPosY === undefined) {
            if (!this.pos.inRangeTo(source, 1)) {
                this.moveTo(source, {visualizePathStyle: {stroke: '#ffffff'}})
            } else {
                this.harvest(source)
            }
            return false
        }

        if (!this.pos.inRangeTo(containerPosX, ContainerPosY, 0)) {
            this.moveTo(containerPosX, ContainerPosY, {visualizePathStyle: {stroke: '#ffffff'}})
        } else {
            this.harvest(source)
        }
        return false
    }

    getEnergyFromStructure(id: Id<any>, energyType: ResourceConstant) {
        const structure = Game.getObjectById(id)
        if (!structure) {
            this.removeCurrentWorkFromQueue()
            this.releaseCurrentWork()
            const targetRole = this.memory.oldRole ?? this.memory.role
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
            return true
        }
        this.say("🫳偷拿资源")
        if (!this.store.getFreeCapacity()) {
            const targetRole = this.memory.oldRole ?? this.memory.role
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
            return true
        }
        const res = this.withdraw(structure, energyType)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(structure, {visualizePathStyle: {stroke: '#ffff00'}})
            return false
        } else if (res == OK) {
            const targetRole = this.memory.oldRole
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
            return true
        } else if (res == ERR_NOT_ENOUGH_RESOURCES) {
            // 目标已经空了：把任务移出队列，否则所有 emptyWorker 会一直围着它转
            this.removeCurrentWorkFromQueue()
            return true
        } else if (res == ERR_FULL) {
            const targetRole = this.memory.oldRole ?? this.memory.role
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
            return true
        }
        return false
    }

    collectEnergy(id: Id<any>) {
        const resource = <Resource>Game.getObjectById(id)
        if (!resource) {
            this.removeCurrentWorkFromQueue()
            return true
        }
        this.say("🫳捡资源去")
        const res = this.pickup(resource)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(resource, {visualizePathStyle: {stroke: '#ffff00'}})
            return false
        } else if (res == OK) {
            if (!this.store.getFreeCapacity()) {
                // console.log(this.store.getFreeCapacity())
                const targetRole = this.memory.oldRole
                if (targetRole) {
                    this.changeRole(targetRole)
                } else {
                    this.remember()
                }
                delete this.memory.oldRole
            }
            return true
        } else if (res == ERR_FULL){
            // console.log(this.store.getFreeCapacity())
            const targetRole = this.memory.oldRole
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
            return true
        }
        return false
    }

    upgrade(controllerId: Id<StructureController>): boolean {
        const controller = Game.getObjectById(controllerId)
        if (!controller) {
            return true
        }
        if (this.store['energy']) {
            this.say("⚡升本!")
            if (this.upgradeController(controller) == ERR_NOT_IN_RANGE) {
                this.moveTo(controller, {visualizePathStyle: {stroke: '#ffffff'}});
                return false
            }
        } else {
            this.changeRole('emptyWorker')
            return true
        }
        return false
    }

    remember() {
        let a = this.name.lastIndexOf("r")
        this.memory.role = <Role>this.name.slice(0, a + 1)
        this.memory.working = false
        this.memory.spawnRoom = this.room.name
        this.memory.reSpawn = false
        // console.log(name)
    }

    carryEnergy(targetId: Id<any>, resourceType: ResourceConstant): boolean {
        if (this.store['energy']) {
            const target = Game.getObjectById(targetId)
            if (!target) {
                this.say("⚡找不到目标")
                this.removeCurrentWorkFromQueue()
                // const targetRole = this.memory.oldRole ?? this.memory.role
                // if (targetRole) {
                //     this.changeRole(targetRole)
                // } else {
                //     this.remember()
                // }
                // delete this.memory.oldRole
                return true
            }
            if (!target.store.getFreeCapacity(resourceType)) {
                this.say("⚡目标已满")
                this.removeCurrentWorkFromQueue()
                // this.releaseCurrentWork()
                // const targetRole = this.memory.oldRole ?? this.memory.role
                // if (targetRole) {
                //     this.changeRole(targetRole)
                // } else {
                //     this.remember()
                // }
                // delete this.memory.oldRole
                return true
            }
            // 目标没满
            this.say("⚡运输中")
            const res = this.transfer(target, resourceType)
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                return false
            } else if (res == OK) {
                // 这个persistent不知道是用来干什么的，先不删了
                // if (this.memory.currentWork?.persistent && !target.store.getFreeCapacity(resourceType)) {
                if (!target.store.getFreeCapacity(resourceType)) {
                    this.removeCurrentWorkFromQueue()
                    return true
                }
                return false
            } else if (res == ERR_FULL) {
                this.say("⚡目标已满")
                this.removeCurrentWorkFromQueue()
                return true
            }
        } else {
            // 高优先级补能任务自带取能：carrier 直接去能量最多的 container 取，
            // 不再降级成 emptyWorker 去和普通 worker 抢 energyTask——
            // 那样会丢掉 carryTask 的 priority 1，spawn/extension 的补能会被拖慢。
            const source = this.room.bestEnergyContainer()
            if (source) {
                this.say("⚡补能取能")
                const res = this.withdraw(source, resourceType)
                if (res == ERR_NOT_IN_RANGE) {
                    this.moveTo(source, {visualizePathStyle: {stroke: '#ffff00'}})
                    return false
                }
                if (res == OK) {
                    // 取到了，下一 tick 继续这个 carryTask 去投递
                    return false
                }
            }
            // 没有可取的 container（或刚好被别人取空）：退回通用取能
            this.changeRole('emptyWorker')
            return true
        }
        return false
    }

    repairStructure(targetId: Id<Structure>, targetHits?: number) {
        const target = Game.getObjectById<Structure>(targetId)
        const goalHits = targetHits ?? target?.hitsMax ?? 0
        if (!target || target.hits >= goalHits) {
            // 目标已经修好/消失，把任务移出队列
            this.removeCurrentWorkFromQueue()
            this.releaseCurrentWork()
            return true
        }
        if (!this.store['energy']) {
            this.changeRole('emptyWorker')
            return true
        }
        this.say("🔧维修中")
        const res = this.repair(target)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}})
            return false
        }
        if (res == OK) {
            // 继续修，下一 tick 检查是否已经满了
            return false
        }
        // ERR_NOT_OWNER / ERR_INVALID_TARGET / ERR_RCL_NOT_ENOUGH 等，任务作废
        this.removeCurrentWorkFromQueue()
        this.releaseCurrentWork()
        return true
    }

    buildConstructionSite(constructionId: Id<any>) {
        if (this.store['energy']) {
            this.say("⚡建造中")
            const target = Game.getObjectById(constructionId)
            if (!target) {
                // 工地已经完成/被拆：必须把这条任务从队列里删掉，否则它会一直留在
                // 队首，每个 worker 每 tick 反复领到同一个死任务，永远轮不到后面的任务
                this.removeCurrentWorkFromQueue()
                return true
            }
            const res = this.build(target)
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                return false
            } else if (res == OK) {
                // 只有这一下会把工地打满时才在下一 tick 触发 onBuild；
                // 否则每个建造 tick 都会重复触发。
                const buildPower = this.getActiveBodyparts(WORK) * BUILD_POWER
                if (target.progress + buildPower >= target.progressTotal) {
                    this.room.registEvent({
                        triggerTime: Game.time + 1,
                        triggerFunc: "buildOver",
                        param: [target.pos.x, target.pos.y]
                    })
                }
                return false
            } else {
                this.removeCurrentWorkFromQueue()
                // this.releaseCurrentWork()   
                this.room.buildOver(target.pos.x, target.pos.y)
                return true
            }
        } else {
            this.changeRole('emptyWorker')
            // this.room.registTask(getEnergyWithStorage(this.room))
            return true
        }
    }

    /**
     * 按房间名走到相邻房间的出口。
     * 返回值表示"能不能到达"：已在目标房、已发出移动、站在出口格上都返回 true，
     * 只有真的无路（ERR_NO_PATH / 找不到出口格）才返回 false。
     * 出口方向按房间对缓存到 global（地形静态，推代码时随 global 一起丢弃）。
     */
    moveToRoom(roomName: string): boolean {
        if (this.room.name === roomName) {
            return true
        }
        const cache = global.roomExit ?? (global.roomExit = {})
        const key = `${this.room.name}>${roomName}`
        let exitDir = cache[key]
        if (exitDir === undefined) {
            exitDir = this.room.findExitTo(roomName) as number
            cache[key] = exitDir
        }
        if (exitDir === ERR_NO_PATH) {
            return false
        }
        const exits = this.room.find(exitDir as ExitConstant)
        const exitPos = this.pos.findClosestByRange(exits)
        if (!exitPos) {
            return false
        }
        if (this.pos.isEqualTo(exitPos)) {
            // 站在出口格上，回合结束引擎会自动把 creep 送到隔壁房间
            return true
        }
        this.moveTo(exitPos, { visualizePathStyle: { stroke: '#00ffff' } })
        return true
    }

    /**
     * 外矿常驻采集。永远返回 false：任务持有到 creep 死亡，
     * 死亡后由主房队列清理预约、由 refreshRemoteSpawn 按门槛补员。
     * taskParam: [sourceId | null, 外矿房名, 主房名]
     */
    remoteHarvest(sourceId: Id<Source> | null, targetRoom: string, homeRoom: string): boolean {
        if (this.room.name !== targetRoom) {
            this.moveToRoom(targetRoom)
            return false
        }
        let source = sourceId ? Game.getObjectById<Source>(sourceId) : undefined
        if (!source && this.memory.harvestSourceId) {
            source = Game.getObjectById<Source>(this.memory.harvestSourceId)
        }
        if (!source) {
            // 第一次进来（还没有矿点缓存）：自己挑最近的矿点并写回缓存
            source = this.pos.findClosestByRange(FIND_SOURCES) as Source | null
            if (!source) {
                return false
            }
            this.memory.harvestSourceId = source.id
        }
        const state = this.remoteSourceState(homeRoom, targetRoom, source)
        const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (object: any) => object.structureType === STRUCTURE_CONTAINER
        })[0] as StructureContainer | undefined
        if (container) {
            if (state && state.containerId !== container.id) {
                state.containerId = container.id
            }
            if (state && (!state.containerPos || state.containerPos[0] !== container.pos.x || state.containerPos[1] !== container.pos.y)) {
                state.containerPos = [container.pos.x, container.pos.y]
            }
            if (!this.pos.isEqualTo(container.pos)) {
                this.moveTo(container.pos, { visualizePathStyle: { stroke: '#ffffff' } })
                return false
            }
            // container 掉血时优先修：采集溢出的能量会先进自己背包，正好当维修费
            if (container.hits < container.hitsMax * remoteSetting.repairThreshold
                && this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.say('🔧修外矿')
                if (this.repair(container) === ERR_NOT_IN_RANGE) {
                    this.moveTo(container.pos, { visualizePathStyle: { stroke: '#ffffff' } })
                }
                return false
            }
            this.say('⛏️外矿采矿')
            if (this.harvest(source) === ERR_NOT_IN_RANGE) {
                this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } })
            }
            return false
        }
        // 还没有 container：自己放工地并建造（5000 进度，边采边建）
        let site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: (object: any) => object.structureType === STRUCTURE_CONTAINER
        })[0] as ConstructionSite | undefined
        if (!site) {
            const pos = this.remoteContainerPos(source, homeRoom)
            if (pos) {
                if (state && (!state.containerPos || state.containerPos[0] !== pos.x || state.containerPos[1] !== pos.y)) {
                    state.containerPos = [pos.x, pos.y]
                }
                if (pos.createConstructionSite(STRUCTURE_CONTAINER) === OK) {
                    site = pos.lookFor(LOOK_CONSTRUCTION_SITES)
                        .find(item => item.structureType === STRUCTURE_CONTAINER)
                }
            }
        }
        if (site) {
            if (this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.say('🔨造外矿container')
                if (this.build(site) === ERR_NOT_IN_RANGE) {
                    this.moveTo(site, { visualizePathStyle: { stroke: '#ffffff' } })
                }
                return false
            }
            this.say('⛏️攒能量')
            if (this.harvest(source) === ERR_NOT_IN_RANGE) {
                this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } })
            }
            return false
        }
        // 放不了工地（被占/没有可走格）：贴着矿点采，溢出能量落在地上
        this.say('⛏️外矿采矿')
        if (!this.pos.inRangeTo(source, 1)) {
            this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } })
        } else {
            this.harvest(source)
        }
        return false
    }

    /**
     * 外矿运输：去外矿 container 取能，回到主房投递后才结束任务。
     * 只有回到主房才能返回 true —— releaseCurrentWork 用的是 this.room 的队列，
     * 在外矿房结束任务会把主房队列里的预约漏掉。
     */
    remoteCarry(containerId: Id<StructureContainer>, targetRoom: string, homeRoom: string, sinkId?: Id<any>): boolean {
        const energy = this.store.getUsedCapacity(RESOURCE_ENERGY)
        if (this.room.name === targetRoom) {
            if (this.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                const container = Game.getObjectById<StructureContainer>(containerId)
                if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    this.memory.remoteReturn = true
                    this.say('🫳外矿取能')
                    if (this.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.moveTo(container, { visualizePathStyle: { stroke: '#ffff00' } })
                    }
                    return false
                }
            }
            // 拿满了 / 外矿没货：标记回程，回主房再结算
            this.memory.remoteReturn = true
            this.moveToRoom(homeRoom)
            return false
        }
        if (this.room.name !== homeRoom) {
            // 走廊房间：有货或已在回程就回家，否则去外矿
            this.moveToRoom(energy > 0 || this.memory.remoteReturn ? homeRoom : targetRoom)
            return false
        }
        // 已经回到主房
        if (!energy) {
            if (!this.memory.remoteReturn) {
                // 刚在主房认领任务，空背包是正常起点：先去外矿取能
                this.moveToRoom(targetRoom)
                return false
            }
            // 空手回来 = 外矿没货，任务作废（在家才能安全地按房间删任务）
            this.removeCurrentWorkFromQueue()
            delete this.memory.remoteReturn
            return true
        }
        const sink = sinkId ? Game.getObjectById(sinkId) as any : undefined
        const target: AnyStoreStructure | undefined = sink && sink.store && sink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            ? sink
            : this.homeEnergySink()
        if (target) {
            this.say('⚡外矿回运')
            if (this.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } })
                return false
            }
        }
        delete this.memory.remoteReturn
        return true
    }

    /**
     * 侦察兵常驻任务：从外矿计划里挑需要情报的房间，走过去写情报；
     * 没有目标时回主房随机走，等待 autoplan 以后新增的房间。
     * 一直返回 false，只有主房关掉外矿时才回主房释放任务。
     */
    scout(homeRoom: string): boolean {
        const plan = Memory.remotePlan?.[homeRoom]
        if (!plan || plan.enabled === false) {
            // 外矿总开关关了：回主房释放任务（releaseCurrentWork 用的是主房队列）
            if (this.room.name === homeRoom) {
                return true
            }
            this.moveToRoom(homeRoom)
            return false
        }
        const target = this.memory.scoutTarget
        if (target) {
            if (this.room.name === target) {
                this.say('👁️侦察完毕')
                recordRoomIntel(homeRoom, this.room)
                delete this.memory.scoutTarget
                return false
            }
            // 侦察兵只支持在相邻房之间导航：先回主房，再从主房去目标
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
                return false
            }
            if (!this.moveToRoom(target)) {
                // 从主房都走不到：当作不可用，避免反复派同一个房
                this.markScoutUnreachable(homeRoom, target)
                delete this.memory.scoutTarget
            }
            return false
        }
        // 没有目标时先回主房待命，避免留在外矿房没法接新任务
        if (this.room.name !== homeRoom) {
            this.moveToRoom(homeRoom)
            return false
        }
        const next = this.pickScoutTarget(homeRoom)
        if (next) {
            this.memory.scoutTarget = next
            this.say('👁️去侦察')
            this.moveToRoom(next)
            return false
        }
        // 没活：原地随便走走，等新任务
        this.randomWalk()
        return false
    }

    /**
     * 从计划里挑一个还没有情报的房：没 sources、没被标记 unsafe、也没探过。
     */
    private pickScoutTarget(homeRoom: string): string | undefined {
        const plan = Memory.remotePlan?.[homeRoom]
        if (!plan?.rooms) {
            return undefined
        }
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
            return roomName
        }
        return undefined
    }

    /**
     * 侦察兵从主房都走不到的房间：记成 unsafe，之后不再自动选它。
     */
    private markScoutUnreachable(homeRoom: string, roomName: string): void {
        if (!Memory.mapIntel) {
            Memory.mapIntel = {}
        }
        const intel = Memory.mapIntel[roomName] ?? (Memory.mapIntel[roomName] = {})
        intel.scoutedAt = Game.time
        intel.unsafe = true
        const state = Memory.remotePlan?.[homeRoom]?.rooms?.[roomName]
        if (state) {
            state.enabled = false
        }
    }

    /**
     * 侦察兵待命时的随机移动：只在本房间内走，不跨出口。
     */
    private randomWalk(): void {
        const directions = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT]
        const delta: { [dir: number]: [number, number] } = {
            [TOP]: [-1, 0],
            [TOP_RIGHT]: [-1, 1],
            [RIGHT]: [0, 1],
            [BOTTOM_RIGHT]: [1, 1],
            [BOTTOM]: [1, 0],
            [BOTTOM_LEFT]: [1, -1],
            [LEFT]: [0, -1],
            [TOP_LEFT]: [-1, -1],
        }
        const dir = directions[Math.floor(Math.random() * directions.length)]
        const [dx, dy] = delta[dir]
        const x = this.pos.x + dx
        const y = this.pos.y + dy
        if (x < 1 || x > 48 || y < 1 || y > 48) {
            return
        }
        if (this.room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) {
            return
        }
        this.move(dir)
    }

    /**
     * 把当前矿点登记进顶层 Memory.remotePlan，供主房扫描同步任务/补员。
     */
    private remoteSourceState(homeRoom: string, targetRoom: string, source: Source): RemoteSourceState | undefined {
        const plan = Memory.remotePlan?.[homeRoom]
        const state = plan?.rooms?.[targetRoom]
        if (!state) {
            return undefined
        }
        if (!state.sources) {
            state.sources = {}
        }
        if (!state.sources[source.id]) {
            state.sources[source.id] = {}
        }
        return state.sources[source.id]
    }

    /**
     * 给外矿矿点挑 container 位置：贴着矿点、能走、尽量靠近回主房的出口。
     */
    private remoteContainerPos(source: Source, homeRoom: string): RoomPosition | undefined {
        const terrain = this.room.getTerrain()
        let anchor: RoomPosition | undefined
        const exitRes = this.room.findExitTo(homeRoom) as number
        if (exitRes !== ERR_NO_PATH) {
            const exits = this.room.find(exitRes as ExitConstant)
            anchor = this.pos.findClosestByRange(exits) ?? undefined
        }
        if (!anchor) {
            anchor = this.pos
        }
        const offsets = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ]
        let best: RoomPosition | undefined
        let bestRange = Infinity
        for (const [dx, dy] of offsets) {
            const x = source.pos.x + dx
            const y = source.pos.y + dy
            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue
            }
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                continue
            }
            const pos = new RoomPosition(x, y, this.room.name)
            // 已经有别的建筑/工地就跳过，避免重复放工地
            if (pos.lookFor(LOOK_STRUCTURES).length || pos.lookFor(LOOK_CONSTRUCTION_SITES).length) {
                continue
            }
            const range = pos.getRangeTo(anchor)
            if (range < bestRange) {
                bestRange = range
                best = pos
            }
        }
        return best
    }

    /**
     * 主房接收外矿能量的备选目标：storage 优先，其次任意有空位的 container，
     * 最后直接补给 spawn/extension（主房还没建 container 时也能回运）。
     */
    private homeEnergySink(): AnyStoreStructure | undefined {
        if (this.room.storage && this.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            return this.room.storage
        }
        for (const id of this.room.getContainer()) {
            const container = Game.getObjectById<StructureContainer>(id)
            if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                return container
            }
        }
        for (const id of this.room.energyStructureOrder()) {
            const structure = Game.getObjectById<StructureExtension | StructureSpawn>(id)
            if (structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                return structure
            }
        }
        return undefined
    }

}
