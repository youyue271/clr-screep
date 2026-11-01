import {towerSetting} from "@/setting";

const repairPriorityMap: { [type: string]: number } = {
    [STRUCTURE_SPAWN]: 1,
    [STRUCTURE_EXTENSION]: 1,
    [STRUCTURE_TOWER]: 1,
    [STRUCTURE_CONTAINER]: 1,
    [STRUCTURE_STORAGE]: 1,
    [STRUCTURE_LINK]: 1,
    [STRUCTURE_TERMINAL]: 1,
    [STRUCTURE_LAB]: 1,
    [STRUCTURE_ROAD]: 3,
}

function repairPriority(type: StructureConstant): number {
    return repairPriorityMap[type] ?? 2
}

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
