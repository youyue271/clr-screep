// /**
//  * spawn原型扩展
//  */
// import {calcBodyPart, remove} from "@/util/utils"
// import {spawnCreepErrorDescription} from "@/information"
// import room from "@/mount/room";
//
import {CalBodyCost, getBodyForEnergy} from "@/util/utils";
import log from "@/util/log";
import {spawnCreepErrorDescription} from "@/util/errorInformation";
import {spawnSetting} from "@/setting";

export default class SpawnExtension extends Spawn {
    /**
     * spawn使用carrier的usingData来计算当前是否可以孵化
     * 将使用的extension和spawn暂存到一个列表中
     * 然后孵化,如果没有出错的话将对应的列表连接到dataPool后
     * 如果孵化出现问题,refresh carrierList,并将
     */
    public work(): void {
        // log.debug("spawn working")
        if (this.spawning) {
            // 孵化可视化
            const spawningCreep = Game.creeps[this.spawning.name]
            this.room.visual.text(
                '🛠️' + spawningCreep.memory.role,
                this.pos.x + 1,
                this.pos.y,
                {align: 'left', opacity: 0.8})
            return
        } else {
            const spawnBuckets = this.room.normalizeTaskBuckets('spawnTask')
            const bucketKeys = Object.keys(spawnBuckets).map(Number).sort((a, b) => a - b)
            let spawnQueue: TaskEntity[] | undefined
            let activeKey: string | undefined
            for (const key of bucketKeys) {
                const bucket = spawnBuckets[String(key)]
                if (bucket && bucket.length) {
                    spawnQueue = bucket
                    activeKey = String(key)
                    break
                }
            }
            if (!spawnQueue || !spawnQueue.length) {
                return
            } else {
                const task = spawnQueue[0]
                const role = task?.taskParam?.[0] as Role
                let rolePart = task?.taskParam?.[1] as BodyPartConstant[]
                if (!role || !rolePart) {
                    spawnQueue.shift()
                    if (activeKey && spawnQueue.length === 0) {
                        delete spawnBuckets[activeKey]
                    }
                    return
                }
                let energyNeeded = CalBodyCost(rolePart)
                this.room.visual.text(
                    '🛠️' + role,
                    this.pos.x + 1,
                    this.pos.y,
                    {align: 'left', opacity: 0.8, font: "20px"})
                this.room.visual.text(
                    "💸" + energyNeeded + "\n",
                    this.pos.x + 1,
                    this.pos.y + 1,
                    {align: 'left', opacity: 0.8, font: "20px"})
                this.room.visual.text(
                    "💰" + this.room.energyAvailable + "\n",
                    this.pos.x + 1,
                    this.pos.y + 2,
                    {align: 'left', opacity: 0.8, font: "20px"})
                if (this.room.energyAvailable < energyNeeded) {
                    // 正常情况等 carryTask 补能即可；等太久说明房间已经补不上能量
                    // （典型是 carrier 全灭），按当前能量换一个买得起的最小体型先孵出来，
                    // 否则 priority 0 的大体型任务会把后面的 carrier/worker 全部堵死。
                    const waited = task.queuedAt === undefined ? 0 : Game.time - task.queuedAt
                    if (waited < spawnSetting.affordWaitTicks) {
                        return
                    }
                    // 能量还在增长：说明房间正在回血（carrier 在往 spawn/extension 搬），
                    // 继续等，不要急着把大体型任务砍成小体型。只有连续一个窗口都不增长
                    // 才兜底；同时用总时长硬上限保证一定会有结果。
                    if (task.queuedEnergy !== undefined && this.room.energyAvailable > task.queuedEnergy) {
                        task.queuedEnergy = this.room.energyAvailable
                        task.queuedAt = Game.time
                        const age = task.createdAt === undefined ? 0 : Game.time - task.createdAt
                        if (age < spawnSetting.affordMaxWaitTicks) {
                            return
                        }
                    }
                    const fallbackBody = getBodyForEnergy(role, this.room, this.room.energyAvailable)
                    if (!fallbackBody) {
                        return
                    }
                    task.taskParam[1] = fallbackBody
                    rolePart = fallbackBody
                    energyNeeded = CalBodyCost(fallbackBody)
                    if (this.room.energyAvailable < energyNeeded) {
                        return
                    }
                }
                if (this.room.energyAvailable >= energyNeeded) {
                    // 按布局集群顺序挑"刚好够"的结构，不做存量排序。
                    // spawnCreep 会严格按这个顺序扣能量。
                    const picked = this.room.pickEnergyStructures(energyNeeded)
                    if (!picked) {
                        // 能量结构顺序表可能还没同步好，下一 tick 再试
                        return
                    }
                    let creepName = role + Game.time
                    let res = this.spawnCreep(rolePart, creepName, {
                        memory: {
                            role: role,
                            spawnRoom: this.room.name,
                            working: false,
                            reSpawn: true,
                            // 提前换班的 harvester 会带上矿点 id
                            harvestSourceId: task?.taskParam?.[2] as Id<Source> | undefined
                        },
                        energyStructures: picked.structures
                    })
                    if (res == OK) {
                        /* 孵化成功 */
                        spawnQueue.shift()
                        if (activeKey && spawnQueue.length === 0) {
                            delete spawnBuckets[activeKey]
                        }
                        // spawnCreep 是 intent，回合末才扣能量；下一 tick 给实际
                        // 被扣空的结构登记补能需求，再由 calSpawningTime 安排 recycle
                        this.room.registEvent({
                            triggerTime: Game.time + 1,
                            triggerFunc: "refillAfterSpawn",
                            param: [picked.usedIds]
                        })
                        this.room.registEvent({
                            triggerTime: Game.time + 1,
                            triggerFunc: "calSpawningTime",
                            param: [this.id]
                        })
                    } else {
                        log.error("孵化失败,报错原因: " + spawnCreepErrorDescription[res])
                    }
                }
            }
            //TODO:孵化,注意计算spawnCreep,返回状态,如果状态不对需要refresh carrier, 同时要把所有的carry全部free掉
        }

    }

    /**
     * 在spawn修好的时候，如果是第一个spawn需要对spawn所在的room从新矿转化为主矿
     */
    public onBuild() {

    }
}
