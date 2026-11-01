import { getEnergyTask } from "@/task/roomTask";
import log from "@/util/log";
// import {getCarryList, getEnergyWithStorage} from "@/task/roomTask";

const roleToTask: { [role in Role]: TaskType[] } = {
    'harvester': ['harvestTask'],
    'worker': ['upgradeTask', 'constructTask'],
    'emptyWorker': ['energyTask'],
    'carrier': ['carryTask'],
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
        for (const taskType of TaskList) {
            const buckets = room.normalizeTaskBuckets(taskType)
            if (!buckets) {
                continue
            }
            const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b)
            for (const key of keys) {
                const queue = buckets[String(key)]
                if (!queue || !queue.length) {
                    continue
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
            this.releaseCurrentWork()
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
            const addToEnergyList = () => {
                if (!this.room.memory.energyList) {
                    this.room.memory.energyList = []
                }
                const isEnergyStructure = target.structureType === STRUCTURE_EXTENSION
                if (isEnergyStructure && !this.room.memory.energyList.includes(target.id)) {
                    this.room.memory.energyList.push(target.id)
                }
            }
            if (!target.store.getFreeCapacity(resourceType)) {
                this.say("⚡目标已满")
                addToEnergyList()
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
                addToEnergyList()
                if (!target.store.getFreeCapacity(resourceType)) {
                    this.removeCurrentWorkFromQueue()
                    return true
                }
                return false
            } else if (res == ERR_FULL) {
                this.say("⚡目标已满")
                addToEnergyList()
                this.removeCurrentWorkFromQueue()
                return true
            }
        } else {
            this.changeRole('emptyWorker')
            // this.room.registTask(getEnergyWithStorage(this.room))
            return true
        }
        return false
    }

    buildConstructionSite(constructionId: Id<any>) {
        if (this.store['energy']) {
            this.say("⚡建造中")
            const target = Game.getObjectById(constructionId)
            if (!target) {
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
            const res = this.build(target)
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                return false
            } else if (res == OK) {
                // 建成以后下一tick执行onBuild
                             
                // this.room.registEvent({
                //     triggerTime: Game.time + 1,
                //     triggerFunc: "buildOver",
                //     param: [target.pos.x, target.pos.y]
                // })
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

}
