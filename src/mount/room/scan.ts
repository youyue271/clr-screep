import {containerScanInterval, energyStructureScanInterval, repairPriority, towerSetting, wallSetting} from "@/setting";

/**
 * 房间环境扫描：低频执行 find，把结果以 id 的形式缓存在 global.room 中，
 * 塔每 tick 只做 O(1) 的缓存读取，避免所有塔重复 find。
 */
export default class RoomScanExtension extends Room {

    scan(): void {
        const cache = global.room[this.name]
        if (!cache) {
            return
        }
        const now = Game.time
        // 防御状态下每 tick 重新确认敌对目标；和平状态按间隔扫描
        if (cache.threatMode === 'defend'
            || cache.lastThreatScan === undefined
            || now - cache.lastThreatScan >= towerSetting.threatScanInterval) {
            cache.lastThreatScan = now
            this.refreshThreat(cache)
        }
        if (cache.lastRepairScan === undefined
            || now - cache.lastRepairScan >= towerSetting.repairScanInterval) {
            cache.lastRepairScan = now
            this.refreshRepairQueue(cache)
            // 维修队列刷新后同步 worker 的维修任务，次数与扫描同频（15 tick 一次）
            this.syncRepairTasks()
        }
        if (cache.lastMaintenanceScan === undefined
            || now - cache.lastMaintenanceScan >= wallSetting.scanInterval) {
            cache.lastMaintenanceScan = now
            this.refreshMaintenanceQueue(cache)
            this.syncWallRepairTasks()
        }
        // container / 掉落物会变化，定期把新出现的能量来源补进 energyTask 队列
        if (cache.lastEnergyTaskScan === undefined
            || now - cache.lastEnergyTaskScan >= 10) {
            cache.lastEnergyTaskScan = now
            this.refreshEnergyTasks()
            // spawn/extension 的补能需求同样按间隔兜底同步
            this.refreshEnergyCarryTasks()
            // 工地状态变化后升级并发要跟着调整
            this.refreshUpgradeTask()
            // 外矿任务和补员：任务登记在主房队列，孵化受"富余能量"门槛控制
            // 先按最新情报补全外矿计划（相邻房、unsafe 过滤），再同步任务/补员
            this.syncRemotePlan()
            this.refreshRemoteTasks()
            this.refreshRemoteSpawn()
        }
        // 兜底重建 spawn/extension 顺序表，处理漏掉的建成/拆除
        if (cache.lastEnergyStructureScan === undefined
            || now - cache.lastEnergyStructureScan >= energyStructureScanInterval) {
            cache.lastEnergyStructureScan = now
            this.refreshEnergyStructures()
        }
        // 兜底刷新 container 列表（建成有 buildOver 事件，这里处理漏网/被拆）
        if (cache.lastContainerScan === undefined
            || now - cache.lastContainerScan >= containerScanInterval) {
            this.refreshContainers()
        }
    }

    private refreshThreat(cache: RoomGlobalCache): void {
        const hostiles = this.find(FIND_HOSTILE_CREEPS)
        cache.hostileIds = hostiles.map(creep => creep.id)

        const hurt = this.find(FIND_MY_CREEPS)
            .filter(creep => creep.hits < creep.hitsMax)
            .sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax)
        cache.hurtCreepIds = hurt.map(creep => creep.id)

        if (hostiles.length) {
            cache.threatMode = 'defend'
            cache.calmTicks = 0
            return
        }
        if (cache.threatMode === 'defend') {
            cache.calmTicks = (cache.calmTicks ?? 0) + 1
            if (cache.calmTicks >= towerSetting.calmTicksToPeace) {
                cache.threatMode = 'peace'
                cache.calmTicks = 0
            }
            return
        }
        cache.threatMode = 'peace'
        cache.calmTicks = 0
    }

    private refreshRepairQueue(cache: RoomGlobalCache): void {
        const damaged = this.find(FIND_STRUCTURES, {
            filter: (object: any) => {
                if (object.structureType == STRUCTURE_CONTROLLER
                    || object.structureType == STRUCTURE_WALL
                    || object.structureType == STRUCTURE_RAMPART) {
                    return false
                }
                // 不维修其他玩家的建筑；中立建筑（道路/容器）没有 owner，正常纳入
                if (object.owner && !object.my) {
                    return false
                }
                return object.hits < object.hitsMax * towerSetting.repairThreshold
            }
        }) as Structure[]
        damaged.sort((a, b) => {
            const priorityDiff = repairPriority(a.structureType) - repairPriority(b.structureType)
            if (priorityDiff) {
                return priorityDiff
            }
            return a.hits / a.hitsMax - b.hits / b.hitsMax
        })
        cache.repairQueue = damaged.map(structure => structure.id)
    }

    /**
     * 墙体/防御墙维护队列。只有 storage 能量充足时才扫描，
     * 目标血量按 controller level 从 wallSetting.targetHits 取。
     */
    private refreshMaintenanceQueue(cache: RoomGlobalCache): void {
        const storage = this.storage
        const targetHits = this.controller
            ? wallSetting.targetHits[this.controller.level] ?? 0
            : 0
        if (!storage || storage.store[RESOURCE_ENERGY] < wallSetting.minStorageEnergy || !targetHits) {
            cache.maintenanceQueue = []
            return
        }
        const damaged = this.find(FIND_STRUCTURES, {
            filter: (object: any) => {
                if (object.structureType != STRUCTURE_WALL && object.structureType != STRUCTURE_RAMPART) {
                    return false
                }
                if (object.owner && !object.my) {
                    return false
                }
                return object.hits < targetHits
            }
        }) as (StructureWall | StructureRampart)[]
        damaged.sort((a, b) => {
            // 先修 rampart（保护站在上面的 creep），同类型优先修血量最低的
            const priorityA = a.structureType == STRUCTURE_RAMPART ? 0 : 1
            const priorityB = b.structureType == STRUCTURE_RAMPART ? 0 : 1
            if (priorityA != priorityB) {
                return priorityA - priorityB
            }
            return a.hits - b.hits
        })
        cache.maintenanceQueue = damaged
            .slice(0, wallSetting.queueSize)
            .map(structure => structure.id)
    }

    dropRepairTarget(id: Id<Structure>): void {
        const cache = global.room[this.name]
        if (!cache || !cache.repairQueue) {
            return
        }
        const index = cache.repairQueue.indexOf(id)
        if (index >= 0) {
            cache.repairQueue.splice(index, 1)
        }
    }
}
