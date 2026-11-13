import { getEnergyTask } from "@/task/roomTask";
import { containerWatermark, mineralSetting, remoteSetting } from "@/setting";
import log from "@/util/log";
import { assessRemoteVision } from "@/global/war/remote/l2";
import { classifyThreat, isRemotePaused } from "@/util/threat";
import { onRemoteHarvestSignal, rememberRemoteTarget } from "@/global/war/remote/l1";
import {
    ensureMissionMember,
    onMissionAborted,
    onMissionArrived,
    onMissionCleared,
    onMissionHome,
    onMissionTravel,
} from "@/global/war/remote/l3";
import { getMission } from "@/global/war/mission/store";
import { ACTION_BLOCKED } from "./actionGuard";
// import {getCarryList, getEnergyWithStorage} from "@/task/roomTask";

const roleToTask: { [role in Role]: TaskType[] } = {
    'harvester': ['harvestTask'],
    // 维修排在升级前，但维修任务总量受 repairSetting.maxTasks 限制，
    // 只有少数 worker 会短暂转去维修，修完后自动回来升级
    'worker': ['repairTask', 'wallRepairTask', 'upgradeTask', 'constructTask'],
    'emptyWorker': ['energyTask'],
    // 本地补能永远先认领；桶任务优先（一次覆盖整桶），塔/spawn/布局外结构再走单目标
    // 本地没活时才转换角色去外矿拉货
    // 补能（extension/spawn/塔）优先，全部没活时才去拉矿物
    'carrier': ['bucketCarryTask', 'carryTask', 'mineralCarryTask'],
    'remoteHarvester': ['remoteHarvestTask'],
    // 外矿专用运输只做外矿往返，保证外矿 container 不会因为本地任务不断出现而被饿死
    'remoteCarrier': ['remoteCarryTask'],
    // 侦察兵只有一个常驻任务，自己从外矿计划里挑要探的房间
    'viewer': ['scoutTask'],
    // claimer 同样只有一个常驻任务：自己挑要续保留/要占领的控制器
    'claimer': ['claimTask'],
    // 作战单位不领任务：work() 里直接走 soldierBehavior，只认孵化时绑定的任务
    'attacker': [],
    // 睡眠态不领任务：currentWork 是自造的 sleep 伪任务，醒来由事件恢复原任务
    'sleep': [],
    // 中央 carrier 只领建筑间搬运任务，不参与本地补能/外矿
    'centerCarrier': ['transferTask'],
    // 矿物开采：常驻采集任务，冷却/采空期间进 sleep 等唤醒事件
    'miner': ['mineralHarvestTask'],
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
        // 作战单位：不领任务，按孵化时绑定的 L3 任务集合/赶路/交战
        if (this.memory.role === 'attacker') {
            this.soldierBehavior()
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
                    // 中央 carrier 没有任务时回阵型固定格待命，不随机走；
                    // 顺便让房间自愈：link/storage 变化后重新挂上常驻搬运任务。
                    if (this.memory.role === 'centerCarrier') {
                        this.room.ensureCenterCarrier?.()
                        this.moveToCenterPost()
                        return
                    }
                    // 本地没活：房间有 storage 就把富余能量搬进去（见 storeSurplusEnergy）。
                    // 必须放在随机走前面：随机走会覆盖这里发出的 moveTo 意图。
                    if (this.storeSurplusEnergy()) {
                        return
                    }
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


    getWork(): boolean {
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
                } else if (taskType === 'remoteCarryTask') {
                    // 专用运输车只领自己绑定矿点那个 container 的任务，避免几只车挤一个矿
                    queue = this.boundRemoteCarryQueue(queue)
                    if (!queue.length) {
                        continue
                    }
                    queue = [...queue].sort((a, b) =>
                        (a?.reservedBy?.length ?? 0) - (b?.reservedBy?.length ?? 0))
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
        // 本地运输体型有空闲外矿运输位、且本地运输体型超过保底数量时，转职去跑外矿：
        // 运输车和本地 carrier 体型完全一样，不用重新孵化。转职后死亡不进 initSpawn
        // 配额（reSpawn=false），由主房扫描按矿点动态补员；本地保底由 refreshCarrierQuota 兜底。
        // emptyWorker 也要参与：本地没活时 carrier 会被转成 emptyWorker 去取能，
        // 不在这里重新指派的话，本地 carrier 数量一低于保底，外矿满了也永远没人去搬。
        if ((this.memory.role === 'carrier'
                || (this.memory.role === 'emptyWorker' && this.memory.oldRole === 'carrier'))
            && this.tryJoinRemoteCarry()) {
            return true
        }
        // 外矿运输由主房扫描（refreshRemoteCarrierSpawn）按矿点动态补员；
        // 没任务可做且身上没能量：转成 emptyWorker 去取能，避免原地空转。
        // 取满后由 getEnergyFromStructure 按 oldRole 回到原职业。
        // harvester / remoteHarvester 不参与（采集不耗能量），emptyWorker 本身不用再转。
        if (this.memory.role !== 'emptyWorker'
            && this.memory.role !== 'harvester'
            && this.memory.role !== 'remoteHarvester'
            && this.memory.role !== 'viewer'
            && this.memory.role !== 'claimer'
            && this.memory.role !== 'sleep'
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
        // 矿采空：先走到矿边再睡，矿重生时人已经在位；没到就继续走下面的 container 逻辑。
        // 之前放在函数最前面，刚孵化的 harvester 会在半路直接 sleep，醒来还要再跑一趟。
        if (source.energy === 0 && this.pos.inRangeTo(source, 1)) {
            this.sleepUntilSourceReady(source)
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

    /**
     * 矿采空后进入睡眠态：
     * - currentWork 换成 sleep 伪任务（原任务和任务类型存进 taskParam，醒来原样恢复）；
     * - 不调 releaseCurrentWork：保留矿点任务预约，换班/覆盖判定不会误补人，醒来直接接着挖；
     * - 在出生房挂 wakeCreep 事件，等矿重生后唤醒，不做每 tick 的条件判断。
     * 睡眠期间唯一动作是 sleep() 里的 say('zzz')。
     */
    sleepUntilSourceReady(source: Source): void {
        const work = this.memory.currentWork
        // 已经在睡（正常不会走到这里）：不要重复登记唤醒事件
        if (!work || work.taskFunc === 'sleep') {
            return
        }
        // 醒来后认矿点靠这个字段：换班、覆盖、回收逻辑都读它
        this.memory.harvestSourceId = source.id
        this.memory.oldRole = this.memory.role
        this.memory.role = 'sleep'
        this.memory.currentWork = {
            id: `sleep-${this.name}`,
            taskFunc: 'sleep',
            taskParam: [work, this.memory.currentWorkType],
            priority: 0,
            capacity: 1,
            persistent: true,
            reservedBy: [],
        }
        this.memory.working = true
        // 事件挂在出生房：外矿 harvester 也能被主房唤醒（外矿房没视野时不要指望它的房间事件）
        const eventRoom = Game.rooms[this.memory.spawnRoom] ?? this.room
        eventRoom.registEvent({
            // 矿重生的那一 tick 之后再醒，醒来若发现还是空的会再睡一轮
            triggerTime: Game.time + Math.max(1, source.ticksToRegeneration ?? 1) + 1,
            triggerFunc: 'wakeCreep',
            param: [this.name],
        })
    }

    sleep(): boolean {
        this.say('zzz')
        return false
    }

    /**
     * 矿物开采：站矿点旁的固定采矿格（range 1）。
     * - extractor 冷却期间睡到冷却结束；
     * - 采空睡到再生；
     * - 采集成功睡固定 5 tick + 1（冷却回合末才结算，本 tick 读不到新值），
     *   醒来正好是冷却归零的第一 tick，不每 tick 空转 harvest。
     * 采矿格上是 container，harvest 溢出由引擎自动填进脚下 container。
     */
    harvestMineral(mineralId: Id<Mineral>, mineX: number, mineY: number): boolean {
        const mineral = Game.getObjectById<Mineral>(mineralId)
        if (!mineral) {
            return true
        }
        // 任务里可能是非法采矿格（memory 被推代码清空后重算失败会写 [0,0]）：
        // 别往房间角跑，直接结束任务，等房间重新发一个合法的
        const dx = Math.abs(mineX - mineral.pos.x)
        const dy = Math.abs(mineY - mineral.pos.y)
        if (dx > 1 || dy > 1 || (!dx && !dy)) {
            return true
        }
        this.memory.mineralId = mineral.id
        if (this.room.name !== mineral.pos.roomName) {
            this.moveTo(new RoomPosition(mineX, mineY, mineral.pos.roomName),
                {visualizePathStyle: {stroke: '#ffaa00'}})
            return false
        }
        const minePos = new RoomPosition(mineX, mineY, this.room.name)
        if (!this.pos.isEqualTo(minePos)) {
            this.moveTo(minePos, {visualizePathStyle: {stroke: '#ffaa00'}})
            return false
        }
        this.say('⛏️矿物')
        if (mineral.mineralAmount <= 0) {
            this.sleepUntilMineralReady(mineral)
            return false
        }
        const extractor = mineral.pos.lookFor(LOOK_STRUCTURES)
            .find(item => item.structureType === STRUCTURE_EXTRACTOR) as StructureExtractor | undefined
        if (!extractor) {
            // extractor 工地还没建好：ensureExtractor 已经排了建造任务，原地等
            return false
        }
        if (extractor.cooldown > 0) {
            this.sleepUntilMineralReady(mineral, extractor.cooldown)
            return false
        }
        const res = this.harvest(mineral)
        if (res === ERR_NOT_IN_RANGE) {
            this.moveTo(mineral, {range: 1, visualizePathStyle: {stroke: '#ffaa00'}})
            return false
        }
        if (res === OK) {
            // 采完立刻睡：冷却归零的第一 tick 再回来
            this.sleepUntilMineralReady(mineral, mineralSetting.extractorCooldown + 1)
            // 采矿格出了新矿物：同步回运任务（约每 6 tick 一次，不是每 tick 轮询）
            this.room.syncMineralCarryTask()
            return false
        }
        // ERR_TIRED 等异常：下一 tick 重新判断
        this.sleepUntilMineralReady(mineral, 1)
        return false
    }

    /**
     * 矿物冷却/采空睡眠：和矿点采空睡眠同一套机制
     * （换 sleep 伪任务、存原任务、挂 wakeCreep 事件），醒来直接接着采。
     */
    sleepUntilMineralReady(mineral: Mineral, waitTicks?: number): void {
        const work = this.memory.currentWork
        if (!work || work.taskFunc === 'sleep') {
            return
        }
        this.memory.mineralId = mineral.id
        this.memory.oldRole = this.memory.role
        this.memory.role = 'sleep'
        this.memory.currentWork = {
            id: `sleep-${this.name}`,
            taskFunc: 'sleep',
            taskParam: [work, this.memory.currentWorkType],
            priority: 0,
            capacity: 1,
            persistent: true,
            reservedBy: [],
        }
        this.memory.working = true
        // 采空等再生；冷却睡眠由调用方给确定 tick
        const wait = waitTicks ?? (Math.max(1, mineral.ticksToRegeneration ?? 1) + 1)
        // 事件挂在出生房：miner 只在本房工作，但保持和 harvester 一致
        const eventRoom = Game.rooms[this.memory.spawnRoom] ?? this.room
        eventRoom.registEvent({
            triggerTime: Game.time + Math.max(1, wait),
            triggerFunc: 'wakeCreep',
            param: [this.name],
        })
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

    /**
     * 把身上的能量投给目标。
     * true = 目标在本 tick 结算后已经满了/不可用，调用方可以换目标或交还任务；
     * false = 还在移动或还没投满，本 tick 继续。
     * moveTarget 给能量桶用：站到桶节点比追着每个 extension 跑更省移动。
     */
    private transferEnergyTo(target: any, resourceType: ResourceConstant, moveTarget?: RoomPosition): boolean {
        if (!target.store.getFreeCapacity(resourceType)) {
            return true
        }
        this.say("⚡运输中")
        const res = this.transfer(target, resourceType)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(moveTarget ?? target, {visualizePathStyle: {stroke: '#ffffff'}})
            return false
        }
        if (res == OK) {
            // transfer 是回合末结算的，本 tick 读到的 store 还是投递前的旧值。
            // 记下本 tick 已发出的投递量，据此推算结算后目标会不会被填满：
            // 满了就当场交还任务，work() 同一 tick 接着领下一条，
            // 不用多等一 tick 去发现「目标已满」白站一回合。
            if (this.memory.transferTick !== Game.time) {
                this.memory.transferTick = Game.time
                this.memory.transferIssued = 0
            }
            const remainEnergy = (this.store.getUsedCapacity(resourceType) || 0)
                - (this.memory.transferIssued || 0)
            const amount = Math.max(0, Math.min(remainEnergy, target.store.getFreeCapacity(resourceType)))
            this.memory.transferIssued = (this.memory.transferIssued || 0) + amount
            return target.store.getFreeCapacity(resourceType) - amount <= 0
        }
        if (res == ERR_FULL) {
            this.say("⚡目标已满")
            return true
        }
        return false
    }

    /**
     * 身上没能量时去中央 link / container 取能。
     * true = 正在去取或已经取到，继续保留补能任务；
     * false = 本房取不到，已经转成 emptyWorker。
     */
    private refillCarryFromSource(resourceType: ResourceConstant): boolean {
        // 高优先级补能任务自带取能：carrier 按由近到远去 container 取，
        // 不再降级成 emptyWorker 去和普通 worker 抢 energyTask——
        // 那样会丢掉 carryTask 的 priority 1，spawn/extension 的补能会被拖慢。
        const source = this.room.bestEnergyContainer(this.store.getFreeCapacity(resourceType))
        if (source) {
            this.say("⚡补能取能")
            const res = this.withdraw(source, resourceType)
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(source, {visualizePathStyle: {stroke: '#ffff00'}})
                return true
            }
            if (res === ACTION_BLOCKED) {
                // 本 tick 已经发过取能/投递动作：补能任务保留，下一 tick 继续，
                // 绝不能因为一次被守卫跳过就降级成 emptyWorker。
                return true
            }
            if (res == OK) {
                // 取到了，下一 tick 继续这个补能任务去投递
                return true
            }
        }
        // 本房取不到能量：外矿回运由专用 remoteCarrier 负责，本地 carrier 退回通用取能
        // （emptyWorker 会去 energyTask 队列排队，等掉落物/其他 container 补上）。
        this.changeRole('emptyWorker')
        return false
    }

    carryEnergy(targetId: Id<any>, resourceType: ResourceConstant, sourceId?: Id<any>): boolean {
        if (this.store.getUsedCapacity(resourceType) > 0) {
            const target = Game.getObjectById(targetId)
            if (!target) {
                this.say("⚡找不到目标")
                this.removeCurrentWorkFromQueue()
                return true
            }
            if (this.transferEnergyTo(target, resourceType)) {
                this.removeCurrentWorkFromQueue()
                return true
            }
            return false
        }
        // 显式来源（矿物回运）：直接从指定 container/矿堆取，取空就结束任务；
        // 不转 emptyWorker，也不去找别的能量源
        if (sourceId) {
            return !this.refillCarryFromId(sourceId, resourceType)
        }
        return !this.refillCarryFromSource(resourceType)
    }

    /**
     * 从指定来源取货：建筑走 withdraw，地上掉落物走 pickup。
     * 两者都是 range 1 动作，站相邻格即可，不用挤上采矿格（那里常驻 miner）。
     * true = 继续任务；false = 来源没了/取空，结束任务等房间重新发布。
     */
    private refillCarryFromId(sourceId: Id<any>, resourceType: ResourceConstant): boolean {
        const source: any = Game.getObjectById(sourceId)
        if (!source) {
            this.removeCurrentWorkFromQueue()
            return false
        }
        // 地上掉落物：amount 是资源堆的字段，建筑没有
        if (source.amount !== undefined) {
            const res = this.pickup(source)
            if (res === ERR_NOT_IN_RANGE) {
                this.moveTo(source, {visualizePathStyle: {stroke: '#ffff00'}})
                return true
            }
            if (res === OK || res === ACTION_BLOCKED) {
                return true
            }
            // 资源堆被抢光 / 目标无效：结束本任务
            this.removeCurrentWorkFromQueue()
            return false
        }
        if ((source.store?.getUsedCapacity(resourceType) ?? 0) <= 0) {
            this.removeCurrentWorkFromQueue()
            return false
        }
        const res = this.withdraw(source, resourceType)
        if (res === ERR_NOT_IN_RANGE) {
            this.moveTo(source, {visualizePathStyle: {stroke: '#ffff00'}})
            return true
        }
        if (res === OK || res === ACTION_BLOCKED) {
            return true
        }
        // 取空 / 塞不下（身上有别的东西）：结束任务，由房间按存量重新发布
        this.removeCurrentWorkFromQueue()
        return false
    }

    /**
     * 通用建筑间搬运：fromId -> toId，resourceType 完全来自 transferTask 参数。
     * 一次调用只发一个动作，下一 tick 按结算后的 store 继续：
     * - 身上有货：目标有空位就投递；目标满了原地等（persistent 任务不释放）
     * - 身上没货：来源有货就取；来源空了回固定站位等
     * - from/to 消失（建筑被拆/规划变了）才算任务结束，把任务移出队列
     */
    transferResource(fromId: Id<any>, toId: Id<any>, resourceType: ResourceConstant): boolean {
        const from: any = Game.getObjectById(fromId)
        const to: any = Game.getObjectById(toId)
        if (!from || !to) {
            this.say('❓搬运目标没了')
            this.removeCurrentWorkFromQueue()
            this.releaseCurrentWork()
            return true
        }
        // CARRY 部件被打光：不可能再搬货，自毁补员（和 emptyWorker 的处理一致）
        if (!this.store.getCapacity(resourceType)) {
            this.suicideAndRespawn()
            return true
        }
        if (this.store.getUsedCapacity(resourceType) > 0) {
            if (to.store.getFreeCapacity(resourceType) <= 0) {
                // 目标满了：原地等（中央 link -> storage 时说明 storage 也满了），
                // 不丢货、不释放任务，腾出空位后同一任务继续
                this.say('⏳等目标空位')
                this.moveToCenterPost()
                return false
            }
            this.say('🚚中转搬运')
            const res = this.transfer(to, resourceType)
            if (res === ERR_NOT_IN_RANGE) {
                this.moveTo(to, {visualizePathStyle: {stroke: '#66ccff'}})
                return false
            }
            if (res === ACTION_BLOCKED) {
                // 本 tick 已经发过动作：任务保留，下一 tick 再投
                return false
            }
            if (res === OK || res === ERR_FULL || res === ERR_NOT_ENOUGH_RESOURCES) {
                // OK：下一 tick 结算后继续投；FULL/不足是当 tick 读到的旧 store，下一 tick 再看
                return false
            }
            this.removeCurrentWorkFromQueue()
            this.releaseCurrentWork()
            return true
        }
        if (from.store.getUsedCapacity(resourceType) <= 0) {
            this.say('😴等货')
            this.moveToCenterPost()
            return false
        }
        this.say('🫳中转取货')
        const res = this.withdraw(from, resourceType)
        if (res === ERR_NOT_IN_RANGE) {
            this.moveTo(from, {visualizePathStyle: {stroke: '#ffff00'}})
            return false
        }
        if (res === ACTION_BLOCKED) {
            return false
        }
        if (res === OK || res === ERR_NOT_ENOUGH_RESOURCES || res === ERR_FULL) {
            return false
        }
        this.removeCurrentWorkFromQueue()
        this.releaseCurrentWork()
        return true
    }

    /**
     * 回中央 carrier 的固定站位（布局里 link/storage/terminal 中间的路格）。
     * 没有站位（非主房/布局缺失）时原地不动。
     */
    private moveToCenterPost(): void {
        const post = this.room.centerCarrierPos?.()
        if (!post) {
            return
        }
        if (this.pos.x === post[0] && this.pos.y === post[1]) {
            return
        }
        this.moveTo(new RoomPosition(post[0], post[1], this.room.name),
            {visualizePathStyle: {stroke: '#00ffff'}})
    }

    /**
     * 能量桶补能：走到桶节点，找桶内第一个没满的 extension 投递，
     * 桶内全部补满后自己把任务从队列里删掉。
     * 一个桶只占一个 carrier（capacity 1），桶内成员距离节点都是 1，
     * 所以补能过程中基本不用为每个 extension 单独寻路。
     */
    carryBucket(bucketKey: string, resourceType: ResourceConstant): boolean {
        const bucket = this.room.energyBucket(bucketKey)
        if (!bucket) {
            // 桶只在主房布局里有；跑到别的房间时先回去，别把任务删了
            if (this.memory.spawnRoom && this.room.name !== this.memory.spawnRoom) {
                this.moveToRoom(this.memory.spawnRoom)
                return false
            }
            this.removeCurrentWorkFromQueue()
            return true
        }
        if (!bucket.memberIds.length) {
            this.removeCurrentWorkFromQueue()
            return true
        }
        if (this.store.getUsedCapacity(resourceType) === 0) {
            return !this.refillCarryFromSource(resourceType)
        }
        // 桶内找第一个没满的成员；通常 1~2 次 getObjectById 就命中
        let target: any
        for (const id of bucket.memberIds) {
            const structure = Game.getObjectById<StructureExtension>(id)
            if (structure && structure.store.getFreeCapacity(resourceType) > 0) {
                target = structure
                break
            }
        }
        if (!target) {
            this.say("⚡桶已满")
            this.removeCurrentWorkFromQueue()
            return true
        }
        const nodePos = this.room.getPositionAt(bucket.node.x, bucket.node.y) ?? undefined
        if (!this.transferEnergyTo(target, resourceType, nodePos)) {
            return false
        }
        // 刚投递的成员本 tick 读到的 store 还是旧值，跳过它看桶里其它空位。
        // 还有空位就保留任务（下一 tick 继续补），全满了才把任务删掉。
        for (const id of bucket.memberIds) {
            if (id === target.id) {
                continue
            }
            const structure = Game.getObjectById<StructureExtension>(id)
            if (structure && structure.store.getFreeCapacity(resourceType) > 0) {
                return false
            }
        }
        this.removeCurrentWorkFromQueue()
        return true
    }

    /**
     * 本地没活时，把房间里的富余能量搬进 storage。
     * 只有 getWork 找不到任何任务（spawn/extension/塔都不缺能量）才会走到这里：
     * 这时 core link（中转缓冲）和高于高水位的 container 才算是真正的富余。
     * 不登记任务、不占预约，纯粹是空闲时的搬运行为；返回 true 表示已经发出意图。
     */
    storeSurplusEnergy(): boolean {
        // 只处理本地运输体型：carrier 本身，以及空闲下来的 carrier 体型 emptyWorker
        if (this.memory.role !== 'carrier'
            && !(this.memory.role === 'emptyWorker' && this.memory.oldRole === 'carrier')) {
            return false
        }
        const storage = this.room.storage
        if (!storage || storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
            return false
        }
        // 身上有货先送去 storage
        if (this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            this.say('📥存储备')
            const res = this.transfer(storage, RESOURCE_ENERGY)
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(storage, {visualizePathStyle: {stroke: '#ffff00'}})
                return true
            }
            if (res === ACTION_BLOCKED) {
                // 本 tick 已经发过动作：保持原地，别让下面的随机走覆盖掉
                return true
            }
            return res == OK
        }
        // 没货：找富余来源。core link 是中转缓冲，有能量就搬走；
        // container 只搬高水位以上的部分，别把本地补能要用的底仓搬空。
        const source = this.surplusEnergySource()
        if (!source) {
            return false
        }
        this.say('📤搬富余')
        const res = this.withdraw(source, RESOURCE_ENERGY)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(source, {visualizePathStyle: {stroke: '#ffff00'}})
            return true
        }
        if (res === ACTION_BLOCKED) {
            // 本 tick 已经发过动作：保持原地，别让下面的随机走覆盖掉
            return true
        }
        return res == OK
    }

    /**
     * 房间里的富余能量来源：core link 优先，其次高水位以上的 container。
     */
    private surplusEnergySource(): StructureLink | StructureContainer | undefined {
        const core = this.room.getCoreLink()
        if (core && core.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            return core
        }
        const level = this.room.controller ? this.room.controller.level : 0
        const high = (containerWatermark[level] ?? containerWatermark[0]).high
        for (const id of this.room.getContainer()) {
            const container = this.room.containerById(id)
            if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) >= high) {
                return container
            }
        }
        return undefined
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
        if (res === ACTION_BLOCKED) {
            // 本 tick 已发过冲突动作：保留维修任务，下一 tick 再修
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
            } else if (res === ACTION_BLOCKED) {
                // 本 tick 已发过冲突动作：保留建造任务，下一 tick 再建
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
        // 记录最后任务房/最后所在房，死亡回收时才能归因到这次外矿
        rememberRemoteTarget(this, targetRoom)
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
        // 敌人检测全部走 war L1：被攻击/被占时由异常分支立刻上报；
        // 平时由主房 10 tick 扫描（refreshRemoteTasks 里有视野时写情报）兜底，
        // 不再每个 tick 对整房做 hasArmedHostile find。
        if (isRemotePaused(Memory.mapIntel?.[targetRoom])) {
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
            }
            return false
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
        // 外矿采空：走到矿边再睡，没到位就先走去 container，
        // 否则进外矿房就直接 sleep，醒来还得从房门口再跑一趟。
        if (source.energy === 0 && this.pos.inRangeTo(source, 1)) {
            this.sleepUntilSourceReady(source)
            return false
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
                const repairRes = this.repair(container)
                if (this.handleRemoteHarvestResult(repairRes, homeRoom)) {
                    return true
                }
                if (repairRes === ERR_NOT_IN_RANGE) {
                    this.moveTo(container.pos, { visualizePathStyle: { stroke: '#ffffff' } })
                }
                return false
            }
            this.say('⛏️外矿采矿')
            const harvestRes = this.harvest(source)
            if (this.handleRemoteHarvestResult(harvestRes, homeRoom)) {
                return true
            }
            if (harvestRes === ERR_NOT_IN_RANGE) {
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
                const siteRes = pos.createConstructionSite(STRUCTURE_CONTAINER)
                if (siteRes === OK) {
                    site = pos.lookFor(LOOK_CONSTRUCTION_SITES)
                        .find(item => item.structureType === STRUCTURE_CONTAINER)
                } else if (siteRes === ERR_NOT_OWNER) {
                    // 房间有主/被别人 reserve：外矿已经不能再用，立刻召回
                    this.reportRemoteOccupied(siteRes, homeRoom)
                    return true
                }
            }
        }
        if (site) {
            if (this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.say('🔨造外矿container')
                const buildRes = this.build(site)
                if (this.handleRemoteHarvestResult(buildRes, homeRoom)) {
                    return true
                }
                if (buildRes === ERR_NOT_IN_RANGE) {
                    this.moveTo(site, { visualizePathStyle: { stroke: '#ffffff' } })
                }
                return false
            }
            this.say('⛏️攒能量')
            const gatherRes = this.harvest(source)
            if (this.handleRemoteHarvestResult(gatherRes, homeRoom)) {
                return true
            }
            if (gatherRes === ERR_NOT_IN_RANGE) {
                this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } })
            }
            return false
        }
        // 放不了工地（被占/没有可走格）：贴着矿点采，溢出能量落在地上
        this.say('⛏️外矿采矿')
        if (!this.pos.inRangeTo(source, 1)) {
            this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } })
        } else {
            const fallbackRes = this.harvest(source)
            if (this.handleRemoteHarvestResult(fallbackRes, homeRoom)) {
                return true
            }
        }
        return false
    }

    /**
     * 外矿采集/建造/修理动作的结果里能拿到的敌人信号：
     * ERR_NO_BODYPART = WORK 被打光（只可能是在外矿被打的）；
     * ERR_NOT_OWNER = 房间被别的玩家占领/reserve。
     * 返回 true 表示本次任务已经结束，调用方直接退出。
     */
    private handleRemoteHarvestResult(res: ScreepsReturnCode, homeRoom: string): boolean {
        if (res === ERR_NO_BODYPART) {
            if (!this.memory.warReported) {
                onRemoteHarvestSignal(this, { kind: 'noWork' })
                this.memory.warReported = true
            }
            this.suicideAndRespawn()
            return true
        }
        if (res === ERR_NOT_OWNER) {
            this.reportRemoteOccupied(res, homeRoom)
            return true
        }
        return false
    }

    private reportRemoteOccupied(code: ScreepsReturnCode, homeRoom: string): void {
        if (!this.memory.warReported) {
            onRemoteHarvestSignal(this, { kind: 'occupied', code })
            this.memory.warReported = true
        }
        this.releaseRemoteWork(homeRoom)
        this.memory.recall = true
    }

    /**
     * 外矿运输：去外矿 container 取能，回到主房投递，循环到外矿 container 拿空。
     * 只有回到主房才能返回 true —— releaseCurrentWork 用的是 this.room 的队列，
     * 在外矿房结束任务会把主房队列里的预约漏掉。
     * 主房有外矿 link 就投 link；没有 link（还没到 RCL5）就把能量丢在该外矿
     * 对应的 link 规划格上，link 建成后同一格直接改投。sinkId 参数保留
     * （任务参数结构不变），不再用于兜底投递。
     */
    remoteCarry(containerId: Id<StructureContainer>, targetRoom: string, homeRoom: string, sinkId?: Id<any>, linkId?: Id<StructureLink>): boolean {
        // 记录最后任务房/最后所在房，carrier 被打死后由 creepRecycle 归因
        rememberRemoteTarget(this, targetRoom)
        const energy = this.store.getUsedCapacity(RESOURCE_ENERGY)
        // 敌人检测走 war L1：carrier 没有可用的主动异常钩子，被打死/打残由
        // creepRecycle 的提前死亡上报；平时靠主房 10 tick 扫描写情报。
        if (isRemotePaused(Memory.mapIntel?.[targetRoom])) {
            if (this.room.name !== homeRoom) {
                // 在外面（含刚发现敌人的外矿房）：带能量的先回家投递
                this.memory.remoteReturn = energy > 0
                this.moveToRoom(homeRoom)
                return false
            }
            if (energy > 0) {
                // 已经在主房：走下面正常投递分支，把这一趟货卸掉
                this.memory.remoteReturn = true
            } else {
                // 空车在主房：原地待命，别出去送死
                return this.remoteCarrierIdle()
            }
        }
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
                // 有视野确认 container 已经没了：让主房删任务，别让循环任务跟着死目标跑。
                // 同时标记 abort：循环运输只该在外矿还有货时持续，目标没了就回主房收尾转回 carrier。
                if (!container) {
                    Game.rooms[homeRoom]?.removeRemoteCarryTask(containerId)
                    this.memory.remoteAbort = true
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
            // 空手回来 = 外矿 container 已经拿空。只有这时候才结束外运循环、转回 carrier
            delete this.memory.remoteReturn
            this.finishRemoteTrip()
            return true
        }
        // 主房有外矿 link 就投进去；link 满了先在旁边等中央 carrier 腾出中央 link
        const link = linkId ? Game.getObjectById<StructureLink>(linkId) : undefined
        if (link) {
            if (link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                delete this.memory.linkWaitTicks
                this.say('🔗外矿入link')
                const res = this.transfer(link, RESOURCE_ENERGY)
                if (res === ACTION_BLOCKED) {
                    // 本 tick 已经投递过能量：保留任务，下一 tick 再入 link。
                    // 绝不能落到下面的 drop 分支同 tick 再丢一次。
                    return false
                }
                if (res === ERR_NOT_IN_RANGE) {
                    this.moveTo(link, { visualizePathStyle: { stroke: '#66ccff' } })
                    return false
                }
                if (res === OK) {
                    // transfer 是 intent，回合末才结算，本 tick 读 link.energy 还是旧值。
                    // 挂 +1 tick 的转发事件，投递成功后事件驱动地发往中央 link。
                    this.room.registEvent({
                        triggerTime: Game.time + 1,
                        triggerFunc: 'forwardLink',
                        param: [link.id]
                    })
                    return this.afterRemoteDelivery()
                }
            } else {
                // link 满了：说明中央 link 还没被中央 carrier 搬空，转发进不去。
                // 先在 link 旁边等，不把货丢地上（下一趟还要捡回来）。
                // 等太久说明中转链真的堵了，才退回 drop 暂存，避免外矿车无限干等。
                const waited = (this.memory.linkWaitTicks ?? 0) + 1
                this.memory.linkWaitTicks = waited
                if (waited <= remoteSetting.linkFullWaitTicks) {
                    this.say('⏳等link空位')
                    if (!this.pos.inRangeTo(link, 1)) {
                        this.moveTo(link, { range: 1, visualizePathStyle: { stroke: '#66ccff' } })
                    }
                    return false
                }
                delete this.memory.linkWaitTicks
            }
        }
        // 没有可用 link：丢在外矿对应的 link 规划位旁边，等本地 carrier/emptyWorker 来收。
        // 规划位上可能已经有 link 工地/建成的 link（都是障碍），人站不上去，所以相邻即放。
        // 不转回 carrier —— 外矿还有货就继续往返，把"外面运不回来"这一段先打通。
        const dropPos = this.remoteLinkPosOf(homeRoom, targetRoom)
        if (dropPos) {
            if (!this.pos.isNearTo(dropPos)) {
                this.say('📦去放货')
                this.moveTo(dropPos, { range: 1, visualizePathStyle: { stroke: '#66ccff' } })
                return false
            }
            this.say('📦放link位')
            const dropRes = this.drop(RESOURCE_ENERGY)
            if (dropRes === ACTION_BLOCKED) {
                // 本 tick 已经有动作了，货还没丢下，别结束这趟外运
                return false
            }
            if (dropRes === OK) {
                return this.afterRemoteDelivery()
            }
        }
        // 没有规划位 / 丢不下（极少见）：退回旧行为，转回 carrier 交给本地 carryTask
        delete this.memory.remoteReturn
        this.finishRemoteTrip()
        return true
    }

    /**
     * 卸完货后的结算：正常情况下继续循环（保持 remoteCarrier），
     * 只有外矿目标已经消失（remoteAbort）才收尾转回 carrier。
     */
    private afterRemoteDelivery(): boolean {
        const aborted = this.memory.remoteAbort
        delete this.memory.remoteReturn
        if (aborted) {
            this.finishRemoteTrip()
            return true
        }
        return false
    }

    /**
     * 外矿对应的主房 link 规划位。优先用顶层 remotePlan 里持久化的位置，
     * 没有就退回房间 linkPlan（每次规划时算出的位置）。
     */
    private remoteLinkPosOf(homeRoom: string, targetRoom: string): RoomPosition | undefined {
        const pos = Memory.remotePlan?.[homeRoom]?.rooms?.[targetRoom]?.remoteLinkPos
            ?? this.room.memory.linkPlan?.remotes?.[targetRoom]?.pos
        if (!pos || pos.length < 2) {
            return undefined
        }
        return new RoomPosition(pos[0], pos[1], homeRoom)
    }

    /**
     * 空闲运输体型转职去跑外矿：找到空闲回运名额并领到任务返回 true。
     * 没有名额（含本地运输体型不超过保底）返回 false，调用方继续走本地兜底。
     * 名额被别人抢了会收回外矿身份，避免挂着 remoteCarrier 发呆。
     */
    private tryJoinRemoteCarry(): boolean {
        if (this.store.getUsedCapacity(RESOURCE_ENERGY) !== 0) {
            return false
        }
        const opening = this.room.findRemoteCarryOpening()
        if (!opening) {
            return false
        }
        this.changeRole('remoteCarrier')
        this.memory.remoteCarrySourceId = opening.sourceId
        this.memory.remoteCarryRoom = opening.remoteRoom
        delete this.memory.oldRole
        this.memory.reSpawn = false
        if (this.getWork()) {
            return true
        }
        // 名额被别人抢了：退回本地 carrier，别挂着外矿身份发呆
        this.finishRemoteTrip()
        return false
    }

    /**
     * 外矿往返结束：循环任务保留，只把角色切回 carrier。
     * oldRole 必须删掉，否则死的时候会重孵 remoteCarrier（现在不再特招这个角色）。
     */
    private finishRemoteTrip(): void {
        this.changeRole('carrier')
        delete this.memory.oldRole
        delete this.memory.remoteAbort
        // 转回本地 carrier 后不再绑定任何外矿矿点
        delete this.memory.remoteCarrySourceId
        delete this.memory.remoteCarryRoom
        delete this.memory.linkWaitTicks
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
                assessRemoteVision(homeRoom, this.room, 'creep')
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
     * 自动重开靠它兜底：到站后 scout() 会调 L2 评估，安全就恢复 enabled。
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
        const now = Game.time
        let best: string | undefined
        let bestAt = Infinity
        let due: string | undefined
        let dueAt = Infinity
        for (const dir in exits) {
            const roomName = exits[dir]
            if (!roomName || !plan.rooms[roomName]) {
                continue
            }
            const intel = Memory.mapIntel?.[roomName]
            if (intel?.unreachable) {
                continue
            }
            // 还没到复探时间：先不去（强敌停用房、武装敌对没结束的房）
            if (intel?.retryAt !== undefined && intel.retryAt > now) {
                continue
            }
            // 到点的复探优先：尽快确认外矿能不能恢复生产
            if (intel?.retryAt !== undefined) {
                if (intel.retryAt < dueAt) {
                    dueAt = intel.retryAt
                    due = roomName
                }
                continue
            }
            const at = intel?.scoutedAt ?? 0
            if (at < bestAt) {
                bestAt = at
                best = roomName
            }
        }
        return due ?? best
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
        // 目标房这一轮武装敌对还没结束：先撤回主房，保留绑定，清场后自动回去
        if (isRemotePaused(Memory.mapIntel?.[target])) {
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
        if (res === ACTION_BLOCKED) {
            // 本 tick 已发过动作：保留占领计划，下一 tick 再试，别删计划
            return false
        }
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
        assessRemoteVision(homeRoom, this.room, 'creep')
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
            assessRemoteVision(homeRoom, this.room, 'creep')
            delete this.memory.claimerTarget
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
            }
            return false
        }
        if (controller.owner) {
            // 已经有主：刷新情报（会写 unsafe/停用），下一 tick 由 isReserveTargetValid 解绑
            assessRemoteVision(homeRoom, this.room, 'creep')
            return false
        }
        const res = this.reserveController(controller)
        if (res === ACTION_BLOCKED) {
            // 本 tick 已发过动作：下一 tick 继续保留，别写错情报
            return false
        }
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
        assessRemoteVision(homeRoom, this.room, 'creep')
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
     * 作战单位行为：只认孵化时绑定的 L3 任务（missionId）。
     * - forming：在 home 集合点等，先出来的不单独出发
     * - travel：回 home 再出相邻房，到站上报
     * - engage：counter 打最近武装 Invader；expedition 打 Invader core
     * - 任务被关闭（清场/玩家介入/失败）：回家等 TTL 回收
     */
    private soldierBehavior(): void {
        const homeRoom = this.memory.spawnRoom
        const mission = getMission(this.memory.missionId)
        const home = Game.rooms[homeRoom]
        // 主房遭强敌：先回防，任务里的人也不例外
        if (home) {
            const homeLevel = classifyThreat(home.find(FIND_HOSTILE_CREEPS)).level
            if (homeLevel === 'assault' || homeLevel === 'siege') {
                if (this.room.name !== homeRoom) {
                    this.moveToRoom(homeRoom)
                }
                return
            }
        }
        if (!mission) {
            // 任务已结束（清场/撤回/失败），或推代码前出生的旧小队。
            // 任务 id 是 `${home}|${target}|${kind}`：目标还需要打（L2 还是
            // counter/expedition，只是因冷却/次数暂时没建任务）时留在主房，
            // 任务一重建就能凭同一个 missionId 重新入列；目标已经不需要打，
            // 就回主房自毁——作战单位没有常驻价值，留着会白占 counterMaxTotal
            // 的名额，让下一场任务最多等一个 TTL 才凑得齐人。
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
                return
            }
            const [, target, kind] = (this.memory.missionId ?? '').split('|')
            const intel = target ? Memory.mapIntel?.[target] : undefined
            // 和 L3 建任务的条件保持一致：expedition 没有 coreId 时（只剩
            // Invader reserve）不会重建任务，等着只是白占名额
            const stillWanted = !!intel && intel.response === kind
                && (kind !== 'expedition' || intel.coreId !== undefined)
            if (stillWanted) {
                this.waitAtHome(homeRoom, home)
            } else {
                this.say('🏳️任务结束')
                this.suicideAndRespawn()
            }
            return
        }
        ensureMissionMember(mission, this.name)
        if (Memory.remotePlan?.[homeRoom]?.enabled === false) {
            // 外矿总开关关了：任务作废，回家
            onMissionAborted(mission.id, 'plan-disabled')
            this.moveToRoom(homeRoom)
            return
        }
        if (mission.state === 'forming') {
            this.waitAtHome(homeRoom, home)
            return
        }
        if (this.room.name !== mission.targetRoom) {
            onMissionTravel(mission.id, this.name)
            // moveToRoom 只支持相邻房：先回主房，再从主房出门
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom)
            } else {
                this.moveToRoom(mission.targetRoom)
            }
            return
        }
        onMissionArrived(mission.id, this.name)
        // 到站刷新情报：维持 hostileLastSeen，敌人增援/玩家介入时立刻能看出来
        assessRemoteVision(homeRoom, this.room, 'soldier')
        // L2 到站后可能已经改判并关掉任务，重新确认一次
        const live = getMission(mission.id)
        if (!live) {
            return
        }
        if (live.kind === 'counter') {
            this.counterEngage(live, homeRoom)
        } else {
            this.expeditionEngage(live, homeRoom)
        }
    }

    /** 集合阶段：在 home 里等，停在 controller 附近不挡 spawn */
    private waitAtHome(homeRoom: string, home: Room | undefined): void {
        if (this.room.name !== homeRoom) {
            this.moveToRoom(homeRoom)
            return
        }
        this.say('⏳集合')
        const anchor = home?.controller
        if (anchor && !this.pos.inRangeTo(anchor, 4)) {
            this.moveTo(anchor, {range: 3, reusePath: 10})
        }
    }

    /** 反击：只打无 HEAL 的小股武装；情报升级就撤 */
    private counterEngage(mission: WarMission, homeRoom: string): void {
        const intel = Memory.mapIntel?.[mission.targetRoom]
        if (!intel || intel.response !== 'counter') {
            if (intel?.response === 'none') {
                onMissionCleared(mission.id)
            } else {
                onMissionAborted(mission.id, `response:${intel?.response}`)
            }
            this.moveToRoom(homeRoom)
            return
        }
        const hostiles = this.room.find(FIND_HOSTILE_CREEPS)
        const threat = classifyThreat(hostiles)
        if (threat.level === 'assault' || threat.level === 'siege') {
            // 敌人增援已经不是弱敌：撤退，把房留给后续扩编
            onMissionAborted(mission.id, 'threat-up')
            this.moveToRoom(homeRoom)
            return
        }
        const armed = hostiles.filter(creep =>
            creep.getActiveBodyparts(ATTACK) > 0
            || creep.getActiveBodyparts(RANGED_ATTACK) > 0
            || creep.getActiveBodyparts(CLAIM) > 0)
        if (!armed.length) {
            // 清场完毕：任务完成，回家
            onMissionCleared(mission.id)
            this.moveToRoom(homeRoom)
            return
        }
        armed.sort((a, b) => this.pos.getRangeTo(a) - this.pos.getRangeTo(b))
        const goal = armed[0]
        if (this.pos.isNearTo(goal)) {
            this.attack(goal)
        } else {
            this.moveTo(goal, {reusePath: 5})
        }
    }

    /** 出征：优先拆 Invader core；core 旁边有防守兵先清兵 */
    private expeditionEngage(mission: WarMission, homeRoom: string): void {
        const intel = Memory.mapIntel?.[mission.targetRoom]
        if (!intel || intel.response !== 'expedition') {
            if (intel?.response === 'none') {
                onMissionCleared(mission.id)
            } else {
                onMissionAborted(mission.id, `response:${intel?.response}`)
            }
            this.moveToRoom(homeRoom)
            return
        }
        if ((intel.coreDeploy ?? 0) > 0) {
            // 部署中的 core 无敌，等下一轮
            onMissionAborted(mission.id, 'core-deploying')
            this.moveToRoom(homeRoom)
            return
        }
        const core = (intel.coreId ? Game.getObjectById(intel.coreId) : undefined)
            ?? this.room.find(FIND_STRUCTURES, {
                filter: (object: Structure) => object.structureType === STRUCTURE_INVADER_CORE,
            })[0] as StructureInvaderCore | undefined
        if (!core) {
            onMissionCleared(mission.id)
            this.moveToRoom(homeRoom)
            return
        }
        // core 刷出来的防守兵挡路就先打近的
        const defenders = this.room.find(FIND_HOSTILE_CREEPS).filter(creep =>
            creep.getActiveBodyparts(ATTACK) > 0
            || creep.getActiveBodyparts(RANGED_ATTACK) > 0)
        const guard = defenders.sort((a, b) => this.pos.getRangeTo(a) - this.pos.getRangeTo(b))[0]
        const goal = guard && this.pos.getRangeTo(guard) <= 3 ? guard : core
        if (this.pos.isNearTo(goal)) {
            this.attack(goal)
        } else {
            this.moveTo(goal, {reusePath: 5})
        }
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
        // 专用运输车：绑定目标还有效（外矿房没停用、container 还在），留在外矿角色等任务
        if (this.remoteCarryTargetValid()) {
            return false
        }
        // 绑定目标没了 / 老版本没绑定的车：转回普通 carrier，本地补能优先。
        this.finishRemoteTrip()
        return false
    }

    /**
     * 专用运输车只领自己绑定矿点那个 container 的任务；未绑定（老版本转换出来的车）不限制。
     */
    private boundRemoteCarryQueue(queue: TaskEntity[]): TaskEntity[] {
        if (this.memory.role !== 'remoteCarrier') {
            return queue
        }
        const boundContainerId = this.remoteCarryContainerId()
        if (!boundContainerId) {
            return queue
        }
        return queue.filter(task => task?.taskParam?.[0] === boundContainerId)
    }

    /**
     * 专用运输车的绑定目标是否还有效：外矿房没停用、矿点 container 还在。
     * 停用房/被拆容器要转回普通 carrier，不能一直挂着外矿角色干等。
     */
    private remoteCarryTargetValid(): boolean {
        const sourceId = this.memory.remoteCarrySourceId
        const remoteRoom = this.memory.remoteCarryRoom
        if (!sourceId || !remoteRoom) {
            return false
        }
        const state = Memory.remotePlan?.[this.memory.spawnRoom]?.rooms?.[remoteRoom]
        return !!state && state.enabled !== false && !!state.sources?.[sourceId]?.containerId
    }

    /**
     * 专用运输车绑定的矿点对应的 container。
     * 按顶层 remotePlan 实时解析，container 被拆重建后能自动跟上。
     */
    private remoteCarryContainerId(): Id<StructureContainer> | undefined {
        const sourceId = this.memory.remoteCarrySourceId
        const remoteRoom = this.memory.remoteCarryRoom
        if (!sourceId || !remoteRoom) {
            return undefined
        }
        return Memory.remotePlan?.[this.memory.spawnRoom]?.rooms?.[remoteRoom]
            ?.sources?.[sourceId]?.containerId
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
