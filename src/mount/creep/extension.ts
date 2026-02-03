import log from "@/util/log";
import {getCarryList, getEnergyWithStorage} from "@/task/roomTask";

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
        if (!this.memory.role) {
            log.error(this.name + " ERROR!")
            this.remember()
            return
        }
        if (!this.memory.working) {
            if (!this.getWork()) {
                // no work in workList, try change role
                if (this.memory.oldRole) {
                    this.changeRole(this.memory.oldRole)
                    delete this.memory.oldRole
                }
                return
            }
        }


        // already get work, now working
        const res = this[this.memory.currentWork.taskFunc](...this.memory.currentWork.taskParam);
        // console.log(res, this.memory.currentWork.taskFunc, ...this.memory.currentWork.taskParam)
        if (!res) {
            // still working
            return
        } else {
            // work over, get another work
            this.releaseCurrentWork()
            this.memory.working = false
            this.memory.currentWork = undefined
            this.memory.currentWorkType = undefined
            this.work()
            return
        }
    }


    getWork(): boolean {
        const room = this.room
        if (!room.memory.creepTask) {
            return false
        }
        const TaskList = roleToTask[this.memory.role]
        const now = Game.time
        for (const taskType of TaskList) {
            const buckets = room.memory.creepTask[taskType]
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
                    task.reservedBy = task.reservedBy.filter(item => Game.creeps[item.name])
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
        if (this.memory.currentWorkType && this.memory.currentWork) {
            // 被丢下的工作放在队列最前面, 优先被其他creep选取
            this.releaseCurrentWork()
            if (!this.memory.currentWork.persistent) {
                const buckets = this.room.memory.creepTask[this.memory.currentWorkType]
                const key = String(this.memory.currentWork.priority ?? 1)
                if (!buckets[key]) {
                    buckets[key] = []
                }
                buckets[key].unshift(this.memory.currentWork)
            }
            this.memory.currentWorkType = undefined
            this.memory.currentWork = undefined
        } else if (this.memory.currentWorkType) {
            this.memory.currentWorkType = undefined
        }
        this.memory.oldRole = this.memory.role
        this.memory.role = role
        this.memory.working = false
        return true
    }

    releaseCurrentWork() {
        const task = this.memory.currentWork
        if (task && task.reservedBy) {
            task.reservedBy = task.reservedBy.filter(item => item.name !== this.name)
        }
    }

    removeCurrentWorkFromQueue() {
        const task = this.memory.currentWork
        const taskType = this.memory.currentWorkType
        if (!taskType || !task) {
            return
        }
        const buckets = this.room.memory.creepTask?.[taskType]
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
                    queue.splice(i, 1)
                    if (!queue.length) {
                        delete buckets[key]
                    }
                    return
                }
            }
        }
    }

    harvestSource(sourceId: Id<any>, containerPosX: number, ContainerPosY: number): boolean {
        const source: Source = Game.getObjectById(sourceId)
        if (!source) {
            return true
        }
        this.say("⛏️007采矿")

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
            this.releaseCurrentWork()
            delete this.memory.currentWorkType
            delete this.memory.currentWork
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
        const res = this.withdraw(structure, energyType)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(structure, {visualizePathStyle: {stroke: '#ffff00'}})
        } else if (res == OK) {
            delete this.memory.currentWorkType
            delete this.memory.currentWork
            const targetRole = this.memory.oldRole ?? this.memory.role
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
        }
        return false
    }

    collectEnergy(id: Id<any>) {
        const resource = <Resource>Game.getObjectById(id)
        if (!resource) {
            this.releaseCurrentWork()
            delete this.memory.currentWorkType
            delete this.memory.currentWork
            const targetRole = this.memory.oldRole ?? this.memory.role
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
            return true
        }
        this.say("🫳捡资源去")
        const res = this.pickup(resource)
        // console.log(res)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(resource, {visualizePathStyle: {stroke: '#ffff00'}})
            return false
        } else if (res == OK) {
            if (resource.amount > 150) {
                if (!global.room[this.room.name].resources) {
                    global.room[this.room.name].resources = []
                }
                global.room[this.room.name].resources.unshift(resource)
            }
            delete this.memory.currentWorkType
            delete this.memory.currentWork
            const targetRole = this.memory.oldRole ?? this.memory.role
            if (targetRole) {
                this.changeRole(targetRole)
            } else {
                this.remember()
            }
            delete this.memory.oldRole
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
            }
        } else {
            this.changeRole('emptyWorker')
            this.room.registTask(getEnergyWithStorage(this.room))
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
                this.releaseCurrentWork()
                this.removeCurrentWorkFromQueue()
                delete this.memory.currentWorkType
                delete this.memory.currentWork
                const targetRole = this.memory.oldRole ?? this.memory.role
                if (targetRole) {
                    this.changeRole(targetRole)
                } else {
                    this.remember()
                }
                delete this.memory.oldRole
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
                this.releaseCurrentWork()
                this.removeCurrentWorkFromQueue()
                delete this.memory.currentWorkType
                delete this.memory.currentWork
                const targetRole = this.memory.oldRole ?? this.memory.role
                if (targetRole) {
                    this.changeRole(targetRole)
                } else {
                    this.remember()
                }
                delete this.memory.oldRole
                return true
            }
            this.say("⚡运输中")
            const res = this.transfer(target, resourceType)
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                return false
            } else if (res == OK) {
                if (this.memory.currentWork?.persistent && !target.store.getFreeCapacity(resourceType)) {
                    addToEnergyList()
                    this.releaseCurrentWork()
                    this.removeCurrentWorkFromQueue()
                    delete this.memory.currentWorkType
                    delete this.memory.currentWork
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
            } else if (res == ERR_FULL) {
                this.say("⚡目标已满")
                addToEnergyList()
                this.releaseCurrentWork()
                this.removeCurrentWorkFromQueue()
                delete this.memory.currentWorkType
                delete this.memory.currentWork
                const targetRole = this.memory.oldRole ?? this.memory.role
                if (targetRole) {
                    this.changeRole(targetRole)
                } else {
                    this.remember()
                }
                delete this.memory.oldRole
                return true
            }
        } else {
            this.changeRole('emptyWorker')
            this.room.registTask(getEnergyWithStorage(this.room))
            return true
        }
        return false
    }

    buildConstructionSite(constructionId: Id<any>) {
        if (this.store['energy']) {
            this.say("⚡建造中")
            const target = Game.getObjectById(constructionId)
            if (!target) {
                this.releaseCurrentWork()
                delete this.memory.currentWorkType
                delete this.memory.currentWork
                const targetRole = this.memory.oldRole ?? this.memory.role
                if (targetRole) {
                    this.changeRole(targetRole)
                } else {
                    this.remember()
                }
                delete this.memory.oldRole
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
                this.room.buildOver(target.pos.x, target.pos.y)
                return true
            }
        } else {
            this.changeRole('emptyWorker')
            this.room.registTask(getEnergyWithStorage(this.room))
            return true
        }
    }

}
