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
            // 孵化可视化：显示真实名字（名字规则就是 role + 孵化时刻的 Game.time）
            this.room.visual.text(
                '🛠️' + this.spawning.name,
                this.pos.x + 1,
                this.pos.y,
                {align: 'left', opacity: 0.8, font: "20px"})
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
                // 下一个孵化的 creep 名字 = role + 孵化时刻的 Game.time。
                // 本 tick 能量就够时这就是最终名字；还在等能量时每 tick 显示的是
                // “如果此刻孵化会叫什么”，真正孵化时以那一刻的 Game.time 为准。
                const nextName = role + Game.time
                this.room.visual.text(
                    '🛠️' + nextName,
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
                    // 只有本地 carrier 允许缩体型；其它角色一直等满体型。
                    const waited = task.queuedAt === undefined ? 0 : Game.time - task.queuedAt
                    const aliveCarriers = this.room.aliveCarrierCount()
                    if (role === 'carrier') {
                        if (aliveCarriers > 0) {
                            // 有车：先等 timer；到点后运力够就继续等，不够才缩体型出车
                            if (waited < spawnSetting.affordWaitTicks) {
                                return
                            }
                            if (!this.room.checkCarrier()) {
                                task.queuedAt = Game.time
                                return
                            }
                        }
                        // 没车直接孵；有车且运力不够则在 timer 到点后孵：
                        // 按当前能量缩到最大可负担体型（“尽可能大”）
                        const fallbackBody = getBodyForEnergy('carrier', this.room, this.room.energyAvailable)
                        if (!fallbackBody) {
                            return
                        }
                        task.taskParam[1] = fallbackBody
                        rolePart = fallbackBody
                        energyNeeded = CalBodyCost(fallbackBody)
                        if (this.room.energyAvailable < energyNeeded) {
                            return
                        }
                    } else {
                        // 非 carrier 不缩体型，保持满体型等待。
                        // 没车：立刻插救急 carrier；有车：等 timer 到点后按运力决定要不要插。
                        // 救急车插到当前堵住的桶队首，补上能量后大体型任务自然能孵。
                        if (aliveCarriers === 0) {
                            this.room.addRescueCarrier(activeKey)
                            task.queuedAt = Game.time
                            return
                        }
                        if (waited < spawnSetting.affordWaitTicks) {
                            return
                        }
                        if (this.room.checkCarrier()) {
                            this.room.addRescueCarrier(activeKey)
                        }
                        task.queuedAt = Game.time
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
                            // 任务参数里显式带 false 的角色（remoteCarrier）死亡后
                            // 由 refreshRemoteCarrierSpawn 按门槛补员，不走 creepRecycle 无条件重孵
                            reSpawn: task?.taskParam?.[3] !== false,
                            // 提前换班的 harvester 会带上矿点 id
                            harvestSourceId: role === 'harvester' || role === 'remoteHarvester'
                                ? task?.taskParam?.[2] as Id<Source> | undefined
                                : undefined,
                            // miner 绑定矿物 id：换班/回收/重挂唤醒事件时认人
                            mineralId: role === 'miner'
                                ? task?.taskParam?.[2] as Id<Mineral> | undefined
                                : undefined,
                            // 外矿运输车绑定矿点/外矿房：只运这个矿点脚下的 container
                            remoteCarrySourceId: role === 'remoteCarrier'
                                ? task?.taskParam?.[2] as Id<Source> | undefined
                                : undefined,
                            remoteCarryRoom: role === 'remoteCarrier'
                                ? task?.taskParam?.[4] as string | undefined
                                : undefined,
                            // claimer 孵化时绑定目标房，之后只负责这一个房
                            claimerTarget: role === 'claimer'
                                ? task?.taskParam?.[4] as string | undefined
                                : undefined,
                            // viewer 孵化时绑定驻守房：每房一只，到房后不再跨房巡游
                            viewerRoom: role === 'viewer'
                                ? task?.taskParam?.[4] as string | undefined
                                : undefined,
                            // 作战单位孵化时绑定 L3 任务：集合/赶路/交战都按任务走
                            missionId: role === 'attacker'
                                ? task?.taskParam?.[5] as string | undefined
                                : undefined
                        },
                        energyStructures: picked.structures
                    })
                    if (res == OK) {
                        /* 孵化成功 */
                        // claimer 出生有 1 tick 延迟：本 tick 任务已出队、creep 还没进
                        // Game.creeps，记下目标房，让补员扫描别在这个窗口重复排队
                        const claimerTarget = role === 'claimer'
                            ? task?.taskParam?.[4] as string | undefined
                            : undefined
                        if (claimerTarget) {
                            const spawnTicks = this.room.memory.claimerSpawnTick
                                ?? (this.room.memory.claimerSpawnTick = {})
                            spawnTicks[claimerTarget] = Game.time
                        }
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
