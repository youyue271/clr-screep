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
            this.memory.working = false
            this.memory.currentWork = undefined
            this.memory.currentWorkType = undefined
            this.work()
            return
        }
    }


    getWork(): boolean {
        const room = this.room
        const TaskList = roleToTask[this.memory.role]
        for (const task of TaskList) {
            // console.log(task, global.room[this.room.name].creepTask[task])
            if (global.room[this.room.name].creepTask[task].length > 0) {
                this.memory.currentWork = global.room[this.room.name].creepTask[task].shift();
                this.memory.currentWorkType = task
                this.memory.working = true
                return true
            }
        }
        return false
    }

    changeRole(role: Role): boolean {
        if (this.memory.currentWorkType) {
            // 被丢下的工作放在队列最前面, 优先被其他creep选取
            global.room[this.room.name].creepTask[this.memory.currentWorkType].unshift(this.memory.currentWork)
            this.memory.currentWorkType = undefined
            this.memory.currentWork = undefined
        }
        this.memory.oldRole = this.memory.role
        this.memory.role = role
        this.memory.working = false
        return true
    }


    harvestSource(sourceId: Id<any>, containerPosX: number, ContainerPosY: number): boolean {
        const source: Source = Game.getObjectById(sourceId)
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
        this.say("🫳偷拿资源")
        const res = this.withdraw(structure, energyType)
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(structure, {visualizePathStyle: {stroke: '#ffff00'}})
        } else if (res == OK) {
            delete this.memory.currentWorkType
            delete this.memory.currentWork
            this.changeRole(this.memory.oldRole)
            delete this.memory.oldRole
        }
        return false
    }

    collectEnergy(id: Id<any>) {
        const resource = <Resource>Game.getObjectById(id)
        if (!resource) {
            delete this.memory.currentWorkType
            delete this.memory.currentWork
            this.changeRole(this.memory.oldRole)
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
            this.changeRole(this.memory.oldRole)
            delete this.memory.oldRole
        }
        return false
    }

    upgrade(controllerId: Id<StructureController>): boolean {
        const controller = Game.getObjectById(controllerId)
        if (this.store['energy']) {
            this.say("⚡升本!")
            if (this.upgradeController(this.room.controller) == ERR_NOT_IN_RANGE) {
                this.moveTo(this.room.controller, {visualizePathStyle: {stroke: '#ffffff'}});
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
            this.say("⚡运输中")
            const target = Game.getObjectById(targetId)
            const res = this.transfer(target, resourceType)
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                return false
            } else if (res == OK) {
                // TODO: 这里后面还有修改成集群采集判断
                if (target.store.getFreeCapacity(resourceType)) {
                    this.room.registTask(getCarryList([target], resourceType))
                }
                return false
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