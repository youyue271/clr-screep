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
    // 本地补能永远先认领；本地没活时才转换角色去外矿拉货
    'carrier': ['carryTask'],
    'remoteHarvester': ['remoteHarvestTask'],
    // 外矿专用运输只做外矿往返，保证外矿 container 不会因为本地任务不断出现而被饿死
    'remoteCarrier': ['remoteCarryTask'],
    // 侦察兵只有一个常驻任务，自己从外矿计划里挑要探的房间
    'viewer': ['scoutTask'],
    // claimer 同样只有一个常驻任务：自己挑要续保留/要占领的控制器
    'claimer': ['claimTask'],
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
        // 外矿房被停用（敌对/被别人占用/已移出计划）后任务会被主房清掉，
        // 但 creep 手里还留着 currentWork 副本。收到召回标记先回主房，
        // 到家后原地待命到死：外矿体型不适合本地活，也不能再占外矿名额。
        if (this.memory.role === 'remoteHarvester' && this.memory.recall) {
            if (this.room.name !== this.memory.spawnRoom) {
                this.moveToRoom(this.memory.spawnRoom)
            }
            return
        }
        // harvester 只在本房采集：一旦跑出主房，先回矿点。
        // 否则会领不到任务而随机走，或者被裸坐标的 harvestSource 钉在隔壁房同坐标格上。
        if (this.memory.role === 'harvester' && this.memory.spawnRoom
            && this.room.name !== this.memory.spawnRoom) {
            const source = this.memory.harvestSourceId
                ? Game.getObjectById<Source>(this.memory.harvestSourceId as Id<Source>)
                : undefined
            if (source) {
                this.moveTo(source.pos, {range: 1, visualizePathStyle: {stroke: '#ffffff'}})
            } else {
                this.moveToRoom(this.memory.spawnRoom)
            }
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
                    // 外矿 carrier / claimer 的空闲处理自己会发移动意图（回家/原地待命），
                    // 这里再随机走会覆盖 moveToRoom，导致永远回不了主房
                    if (this.memory.role !== 'remoteCarrier' && this.memory.role !== 'claimer') {
                        this.say('🤓 没活辣,随便走走')
                        const directions = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT]
                        const randIndex = Math.floor(Math.random() * directions.length)
                        this.move(directions[randIndex])
                    }
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


    getWork(noRemoteConvert?: boolean): boolean {
        const room = this.room
        if (!room.memory.creepTask) {
            // 外矿房/走廊房没有任务桶：remoteCarrier 不能原地发呆，
            // 先回家再把身上能量交接掉（被别的 carrier 踢出任务时会走到这里）
            if (this.memory.role === 'remoteCarrier') {
                return this.remoteCarrierIdle()
            }
            // claimer 的任务登记在主房队列，在外矿/目标房里领不到任务，先回主房
            if (this.memory.role === 'claimer' && this.room.name !== this.memory.spawnRoom) {
                this.moveToRoom(this.memory.spawnRoom)
                return false
            }
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
        // 提前换班孵化出来的 harvester / 外矿 harvester 只认领孵化时指定的矿点
        const assignedSource = (this.memory.role === 'harvester' || this.memory.role === 'remoteHarvester')
            ? this.memory.harvestSourceId
            : undefined
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
                } else if (taskType === 'remoteHarvestTask') {
                    // 和主矿 harvest 一致：先认孵化时绑定的矿点，再优先没人预约的矿点。
                    // 不排序的话空闲的外矿 harvester 会按计划房插入顺序抢第一条任务，
                    // 两个挤同一个矿，另一个矿长期没人。
                    queue = [...queue].sort((a, b) => {
                        const aMatched = assignedSource && a?.taskParam?.[0] === assignedSource ? 0 : 1
                        const bMatched = assignedSource && b?.taskParam?.[0] === assignedSource ? 0 : 1
                        return aMatched - bMatched
                            || (a?.reservedBy?.length ?? 0) - (b?.reservedBy?.length ?? 0)
                    })
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
                    // 清理已经死掉/被召回的 creep 留下的预约，否则 persistent 任务会被永久占满
                    task.reservedBy = task.reservedBy.filter(item =>
                        item && Game.creeps[item.name] && !Game.creeps[item.name].memory.recall)
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
        // 外矿 carrier 没任务时不能转 emptyWorker（会和本地取能抢任务），
        // 但必须保证不滞留在外矿房：先回主房，身上有能量就交给主房接收点。
        if (this.memory.role === 'remoteCarrier') {
            return this.remoteCarrierIdle()
        }
        // 本地 carrier 没活干且身上是空的：有外矿回运任务就转 remoteCarrier。
        // 带能量的不转：外矿回来没 link 会直接转回 carrier，带能量转过去只会在
        // carrier / remoteCarrier 之间每 tick 来回切，白占任务预约。
        // noRemoteConvert 防止转过去又领不到任务时在本 tick 内来回转换。
        if (!noRemoteConvert && this.memory.role === 'carrier' && room.hasRemoteCarryTask()
            && this.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            this.changeRole('remoteCarrier')
            return this.getWork(true)
        }
        // 没任务可做且身上没能量：转成 emptyWorker 去取能，避免原地空转。
        // 取满后由 getEnergyFromStructure 按 oldRole 回到原职业。
        // harvester / remoteHarvester 不参与（采集不耗能量），emptyWorker 本身不用再转。
        if (this.memory.role !== 'emptyWorker'
            && this.memory.role !== 'harvester'
            && this.memory.role !== 'remoteHarvester'
            && this.memory.role !== 'viewer'
            && this.memory.role !== 'claimer'
            && this.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            this.changeRole('emptyWorker')
        }
        return false
    }

    /**
     * 清掉本方 creep 在主房队列里的预约并交还任务。
     * 外矿 creep 在外矿房执行任务，releaseCurrentWork 用的是当前房间的队列，
     * 而外矿房没有任务桶，清不到主房的任务预约。
     */
    releaseRemoteWork(homeRoom: string): void {
        const task = this.memory.currentWork
        const taskType = this.memory.currentWorkType
        if (task && taskType) {
            const buckets = Memory.rooms?.[homeRoom]?.creepTask?.[taskType]
            if (buckets) {
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
                        if (item.id === taskId
                            || (taskTargetId && (item.targetId === taskTargetId
                                || item.taskParam?.[0] === taskTargetId))) {
                            item.reservedBy = item.reservedBy.filter(entry => entry.name !== this.name)
                        }
                    }
                }
            }
        }
        this.memory.working = false
        this.memory.currentWork = undefined
        this.memory.currentWorkType = undefined
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

    harvestSource(sourceId: Id<any>, containerPosX?: number, ContainerPosY?: number, containerRoom?: string): boolean {
        const source: Source = Game.getObjectById(sourceId)
        if (!source) {
            return true
        }
        this.say("⛏️007采矿")
        // taskParam 里的坐标只是数字，inRangeTo / moveTo 会按 creep 当前房间解释。
        // creep 一旦跑到别的房间，同坐标的格子会被误判成"已经到位"，于是只 harvest 不移动。
        // 所以先确认自己在矿点房间，不在就先走回来（container 坐标自带房间名）。
        const sourceRoom = source.pos.roomName
        if (this.room.name !== sourceRoom) {
            if (containerPosX != null && ContainerPosY != null) {
                this.moveTo(new RoomPosition(containerPosX, ContainerPosY, containerRoom || sourceRoom),
                    {visualizePathStyle: {stroke: '#ffffff'}})
            } else {
                this.moveTo(source.pos, {range: 1, visualizePathStyle: {stroke: '#ffffff'}})
            }
            return false
        }

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
        if (containerPosX == null || ContainerPosY == null) {
            if (!this.pos.inRangeTo(source, 1)) {
                this.moveTo(source, {visualizePathStyle: {stroke: '#ffffff'}})
            } else {
                this.harvest(source)
            }
            return false
        }

        const containerPos = new RoomPosition(containerPosX, ContainerPosY, containerRoom || sourceRoom)
        if (!this.pos.inRangeTo(containerPos, 0)) {
            this.moveTo(containerPos, {visualizePathStyle: {stroke: '#ffffff'}})
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
            // 注意要区分「真的装满了」和「CARRY 被打光、总容量为 0」：
            // 后者永远装不了货，回切 oldRole 只会和 emptyWorker 来回 ping-pong，
            // 直接自毁，由 death 事件补员。
            if (!this.store.getCapacity()) {
                this.suicideAndRespawn()
                return true
            }
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
        // CARRY 部件全灭：pickup 永远返回 ERR_FULL，守着掉落物只会无限空转并占住任务位。
        // 和 getEnergyFromStructure 的 withdraw 分支一样，直接自毁补员。
        if (!this.store.getCapacity()) {
            this.suicideAndRespawn()
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
        if (!this.store['energy']) {
            this.changeRole('emptyWorker')
            return true
        }
        this.say("⚡升本!")
        // 跨房间时先走回控制器所在房，避免用当前房间的坐标解释目标
        if (this.room.name !== controller.pos.roomName) {
            this.moveToRoom(controller.pos.roomName)
            return false
        }
        // upgradeController 的生效距离是 3：在范围里就干活，否则用 range 3 走到位。
        // 多人站位不再预分工位，由 trafficControl 的"范围内让位"动态展开。
        if (this.pos.inRangeTo(controller, 3)) {
            this.upgradeController(controller)
            return false
        }
        this.moveTo(controller, {range: 3, visualizePathStyle: {stroke: '#ffffff'}})
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

    /**
     * 自毁并立刻安排补员。
     * 正常死亡要等 spawn 时按自然 TTL 挂的 creepRecycle 事件，
     * 部件被打光提前死的话会空一个名额很久，所以这里手动给主房挂下一 tick 的事件。
     * 用 spawnRoom 而不是 this.room：残废 creep 可能死在外矿/走廊房。
     */
    suicideAndRespawn(): void {
        const spawnRoom = this.memory.spawnRoom ? Game.rooms[this.memory.spawnRoom] : undefined
        if (spawnRoom) {
            spawnRoom.registEvent({
                triggerTime: Game.time + 1,
                triggerFunc: 'creepRecycle',
                param: []
            })
        }
        this.say('💀报废')
        this.suicide()
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
            // 高优先级补能任务自带取能：carrier 按由近到远去 container 取，
            // 不再降级成 emptyWorker 去和普通 worker 抢 energyTask——
            // 那样会丢掉 carryTask 的 priority 1，spawn/extension 的补能会被拖慢。
            const source = this.room.bestEnergyContainer(this.store.getFreeCapacity(resourceType))
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
            // 本房取不到能量时，外矿有回运任务就直接转 remoteCarrier 去外矿取。
            // 不能先转 emptyWorker：那会去和本房 energyTask 排队，排满就原地空转，
            // 而且 emptyWorker 不会再看外矿回运任务，carrier 就再也转不过去了。
            if (this.room.hasRemoteCarryTask()) {
                this.changeRole('remoteCarrier')
                return true
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
            // repair 的生效距离是 3：用 range 3 让距离场停在第一个可修的格，
            // 不要像以前那样往目标格本身挤，多个 repairer 才能分散站位。
            this.moveTo(target, {range: 3, visualizePathStyle: {stroke: '#ffffff'}})
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
                // build 的生效距离是 3：用 range 3 让距离场停在第一个可建造的格。
                // 以前目标是 range 0，所有 builder 都往工地那一格挤，站进 range 3 的人
                // 还会被后面的人推开（对穿反复互换位置），工地只有一个工位在产出。
                this.moveTo(target, {range: 3, visualizePathStyle: {stroke: '#ffffff'}});
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
        // 外矿房被停用/移出计划：主房会把任务清掉，但 creep 手里还留着 currentWork 副本，
        // 不在这里校验就会一直挖到被敌人打死。交还任务并打召回标记，回主房待命到死。
        const planState = Memory.remotePlan?.[homeRoom]?.rooms?.[targetRoom]
        if (!planState || planState.enabled === false) {
            this.memory.recall = true
            delete this.memory.harvestSourceId
            // 任务预约登记在主房队列，而这个 creep 人在外矿房，
            // releaseCurrentWork 只清当前房间的队列，清不到主房。不手动清的话，
            // 停用/重开后这条任务会被召回的 creep 一直占满，接班的 creep 领不到。
            this.releaseRemoteWork(homeRoom)
            return true
        }
        // 任务里带矿点就是绑定：每 tick 都写回 memory，
        // 换班补员和预约恢复（seedRemoteHarvestReservations）都靠这个字段认人
        if (sourceId) {
            this.memory.harvestSourceId = sourceId
        }
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
                // container 首次出现 / 换了 id：主房登记一条循环回运任务（事件驱动，不周期扫描）
                Game.rooms[homeRoom]?.registerRemoteCarryTask(targetRoom, source.id, container.id)
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
        // 外矿 container 没了：清掉对应回运任务和缓存，重建后再按新 id 登记
        if (state?.containerId) {
            Game.rooms[homeRoom]?.removeRemoteCarryTask(state.containerId)
            delete state.containerId
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
     * 主房只认外矿 link：没有可用 link 就直接转回 carrier，能量交给本地 carryTask；
     * sinkId 参数保留（任务参数结构不变），不再用于兜底投递。
     */
    remoteCarry(containerId: Id<StructureContainer>, targetRoom: string, homeRoom: string, sinkId?: Id<any>, linkId?: Id<StructureLink>): boolean {
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
                // 有视野确认 container 已经没了：让主房删任务，别让循环任务跟着死目标跑
                if (!container) {
                    Game.rooms[homeRoom]?.removeRemoteCarryTask(containerId)
                }
            }
            // 拿满了 / 外矿没货 / container 没了：标记回程，回主房再结算
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
            // 空手回来 = 外矿没货。任务保留（循环任务），转回 carrier 让本地活优先
            delete this.memory.remoteReturn
            this.finishRemoteTrip()
            return true
        }
        // 外矿回来只认外矿 link：有可用 link 就投进去。
        // 没有 link（RCL2 还没建）或 link 满了，直接转回 carrier，
        // 身上的能量交给本地 carryTask 去补 spawn/extension。
        // 不再走 storage/container/spawn 兜底、也不原地等——主房满仓时外矿车会一直发愣。
        const link = linkId ? Game.getObjectById<StructureLink>(linkId) : undefined
        if (!link || link.energy >= link.energyCapacity) {
            delete this.memory.remoteReturn
            this.finishRemoteTrip()
            return true
        }
        this.say('🔗外矿入link')
        const res = this.transfer(link, RESOURCE_ENERGY)
        if (res === ERR_NOT_IN_RANGE) {
            this.moveTo(link, { visualizePathStyle: { stroke: '#66ccff' } })
            return false
        }
        if (res !== OK) {
            return false
        }
        // link 收下了：冷却好了就转发中央 link，不用额外扫描
        this.trySendLink(link)
        delete this.memory.remoteReturn
        // 卸完货：任务保留，转回 carrier；本地有活就干，没活下 tick 再转回来
        this.finishRemoteTrip()
        return true
    }

    /**
     * 外矿往返结束：循环任务保留，只把角色切回 carrier。
     * oldRole 必须删掉，否则死的时候会重孵 remoteCarrier（现在不再特招这个角色）。
     */
    private finishRemoteTrip(): void {
        this.changeRole('carrier')
        delete this.memory.oldRole
    }

    /**
     * 把 link 里的能量转发中央 link（link→link 瞬发，有冷却和损耗）。
     */
    private trySendLink(link: StructureLink): void {
        if (link.cooldown > 0 || !link.energy) {
            return
        }
        const core = this.room.getCoreLink?.()
        if (!core || core.id === link.id || core.energy >= core.energyCapacity) {
            return
        }
        link.transferEnergy(core)
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
     * 常驻侦察兵轮巡：挑情报最老（scoutedAt 最小）的计划房，停用房也一起复查。
     * 自动重开靠它兜底：到站后 scout() 会调 recordRoomIntel，安全就恢复 enabled。
     * 没有 scoutedAt 的房视为 0，优先探。
     */
    private pickScoutTarget(homeRoom: string): string | undefined {
        const plan = Memory.remotePlan?.[homeRoom]
        if (!plan?.rooms) {
            return undefined
        }
        // 只从真实相邻房（describeExits）里挑：findExitTo 对非相邻房的行为不可靠，
        // 盲选会让侦察兵在错误的出口之间来回撞。地形静态，走不通的房直接永久跳过。
        const exits = Game.map.describeExits(homeRoom) ?? {}
        let best: string | undefined
        let bestAt = Infinity
        for (const dir in exits) {
            const roomName = exits[dir]
            if (!roomName || !plan.rooms[roomName]) {
                continue
            }
            const intel = Memory.mapIntel?.[roomName]
            if (intel?.unreachable) {
                continue
            }
            const at = intel?.scoutedAt ?? 0
            if (at < bestAt) {
                bestAt = at
                best = roomName
            }
        }
        return best
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
        // 从主房走不到（地形/封闭边界），地形不变就不用再试
        intel.unreachable = true
        const state = Memory.remotePlan?.[homeRoom]?.rooms?.[roomName]
        if (state) {
            state.enabled = false
        }
    }

    /**
     * claimer 常驻任务：每只 claimer 孵化时绑定一个目标房（memory.claimerTarget）。
     * - 目标在 Memory.claimPlan 里：执行显式占领，成功后解绑
     * - 否则当作外矿保留房：一直站在控制器旁每 tick 续约
     * 保留是按 tick 累积的（每次意图 +CLAIM 部件数，上限 5000），
     * 单 CLAIM 只能维持现有剩余，所以必须常驻，不能收一次就换房。
     */
    claim(homeRoom: string): boolean {
        const target = this.memory.claimerTarget
        if (!target) {
            // 没有绑定目标（旧代码孵化/外部删掉了目标）：回主房等补员逻辑重新分配
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
            }
            return false
        }
        const claimEntry = Memory.claimPlan?.[target]
        if (claimEntry) {
            if (claimEntry.retryAt !== undefined && claimEntry.retryAt > Game.time) {
                // GCL 不足等暂时失败：保留绑定，回主房待命，到点再试
                if (this.room.name !== homeRoom) {
                    this.moveToRoom(homeRoom)
                }
                return false
            }
            return this.tryClaimRoom(homeRoom, target, claimEntry)
        }
        if (this.isReserveTargetValid(homeRoom, target)) {
            return this.tryReserveController(homeRoom, target)
        }
        // 房间已不可用（被占/被停用/有敌对）：解绑回主房
        delete this.memory.claimerTarget
        if (this.room.name !== homeRoom) {
            this.moveToRoom(homeRoom)
        }
        return false
    }

    /**
     * 目标房是否还值得驻守：外矿计划里启用、且情报没有标记不安全/走不到。
     * 注意推代码后的第一 tick 顶层 Memory 可能还读不到，缺失时按"继续驻守"处理，
     * 否则所有 claimer 会在一次推送里集体解绑回家。
     */
    private isReserveTargetValid(homeRoom: string, roomName: string): boolean {
        // 侦察已确认没有 source（多是 highway 通道房），或现场看到没有 controller：
        // 没有可保留的控制器。继续驻守只会让 claimer 在房间出口格上来回弹。
        const intel = Memory.mapIntel?.[roomName]
        const sources = intel?.sources
        if (Array.isArray(sources) && sources.length === 0) {
            return false
        }
        const liveRoom = Game.rooms[roomName]
        if (liveRoom && !liveRoom.controller) {
            return false
        }
        const plan = Memory.remotePlan?.[homeRoom]
        if (!plan) {
            return true
        }
        if (plan.enabled === false) {
            return false
        }
        const state = plan.rooms?.[roomName]
        if (state && state.enabled === false) {
            return false
        }
        if (!state) {
            // 已经不在计划里：通常是我们把它占了；没视野时先保持绑定
            return !Game.rooms[roomName]?.controller?.my
        }
        return !(intel?.unsafe || intel?.unreachable)
    }

    private tryClaimRoom(homeRoom: string, roomName: string, entry: ClaimTargetState): boolean {
        if (this.room.name !== roomName) {
            // claim 目标约定与主房相邻：先回主房，再从主房过去
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
                return false
            }
            if (!this.moveToRoom(roomName)) {
                // 走不到：外部脚本可能写错房名，删掉避免每 tick 重试
                delete Memory.claimPlan?.[roomName]
                delete this.memory.claimerTarget
                return false
            }
            return false
        }
        const controller = this.room.controller
        if (!controller) {
            delete Memory.claimPlan?.[roomName]
            delete this.memory.claimerTarget
            return false
        }
        const res = this.claimController(controller)
        if (res === OK) {
            this.say('🚩 占领')
            delete Memory.claimPlan?.[roomName]
            // 占领后它就不再是外矿房：立刻从计划里移除，
            // 避免补员逻辑又孵化一只 claimer 跑过来驻守
            delete Memory.remotePlan?.[homeRoom]?.rooms?.[roomName]
            delete this.memory.claimerTarget
            return false
        }
        if (res === ERR_NOT_IN_RANGE) {
            this.moveTo(controller)
            return false
        }
        if (res === ERR_GCL_NOT_ENOUGH) {
            // GCL 暂时不够：保留目标，过一阵再试，避免每 tick 冲一遍
            this.say('GCL 不够')
            entry.retryAt = Game.time + 1000
            return false
        }
        // 有主、被保留满等：刷新情报后放弃，外部脚本可以重新写入
        recordRoomIntel(homeRoom, this.room)
        delete Memory.claimPlan?.[roomName]
        delete this.memory.claimerTarget
        return false
    }

    /**
     * 常驻保留一个控制器：每 tick 都在控制器旁调用 reserveController，
     * 让 endTime 持续累积，不做"收一次就换房"（那样保留只能撑 1-2 tick）。
     */
    private tryReserveController(homeRoom: string, roomName: string): boolean {
        if (this.room.name !== roomName) {
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
                return false
            }
            this.moveToRoom(roomName)
            return false
        }
        const controller = this.room.controller
        if (!controller) {
            // highway / 无 controller 房：记下"没矿"让计划与补员逻辑自愈，解绑回家。
            // 不能只 return —— 停在出口格上会被引擎每 tick 弹回隔壁房（W34S50 实测）。
            recordRoomIntel(homeRoom, this.room)
            delete this.memory.claimerTarget
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
            }
            return false
        }
        if (controller.owner) {
            // 已经有主：刷新情报（会写 unsafe/停用），下一 tick 由 isReserveTargetValid 解绑
            recordRoomIntel(homeRoom, this.room)
            return false
        }
        const res = this.reserveController(controller)
        if (res === OK) {
            this.say('🛡️ 保留')
            const me = this.owner?.username
            const intel = Memory.mapIntel?.[roomName] ?? (Memory.mapIntel[roomName] = {})
            const parts = this.getActiveBodyparts(CLAIM)
            // 读到的 ticksToEnd 是本 tick 衰减后的值，意图在回合末才结算：
            // 结算后 endTime 再 +parts，即到期 tick = 当前 tick + 剩余 + 本次部件数
            const before = controller.reservation && controller.reservation.username === me
                ? controller.reservation.ticksToEnd
                : 0
            intel.reservedUntil = Game.time + Math.min(CONTROLLER_RESERVE_MAX, before + parts)
            return false
        }
        if (res === ERR_NOT_IN_RANGE) {
            this.moveTo(controller)
            return false
        }
        // 被别人保留满/无权限：用实时状态刷情报，避免反复尝试
        recordRoomIntel(homeRoom, this.room)
        return false
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
     * 外矿 carrier 没任务时的兜底：不在主房就先回去，在主房就把能量交给接收点。
     * 任务可能被别人 removeCurrentWorkFromQueue 踢掉，保证它不会带着货滞留在外矿房。
     */
    private remoteCarrierIdle(): boolean {
        if (this.room.name !== this.memory.spawnRoom) {
            this.moveToRoom(this.memory.spawnRoom)
            return false
        }
        if (this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            const sink = this.homeEnergySink()
            if (sink) {
                this.transfer(sink, RESOURCE_ENERGY)
            }
        }
        // 回到主房还领不到回运任务：转回普通 carrier，本地补能优先。
        // 如果本地也没活，下一 tick 会按"有没有回运任务"再转回来，不会滞留在外矿角色。
        this.changeRole('carrier')
        delete this.memory.oldRole
        return false
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
            const container = this.room.containerById(id)
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
