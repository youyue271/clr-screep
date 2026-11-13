import {towerSetting} from "@/setting";
import {isWhitelistedCreep} from "@/util/whitelist";

/**
 * 塔的逻辑：只读 global.room 中的扫描缓存，不在每 tick 做 find。
 * 优先级：攻击敌对 creep > 治疗己方 creep > 维修建筑 > 请求补能。
 */
export default class TowerExtension extends StructureTower {

    work(): void {
        const room = this.room
        const cache = room ? global.room[room.name] : undefined
        if (!room || !cache) {
            return
        }

        if (this.attackHostile(cache.hostileIds)) {
            this.ensureEnergySupply(cache)
            return
        }
        if (this.healCreep(cache.hurtCreepIds)) {
            this.ensureEnergySupply(cache)
            return
        }
        if (this.canRepair() && cache.repairQueue && cache.repairQueue.length) {
            this.repairNext(cache.repairQueue, room)
        }
        this.ensureEnergySupply(cache)
    }

    /**
     * 攻击敌对 creep。优先打射程内的，没有则退而求其次打射程内的最远目标。
     * @return 是否执行了攻击（无论游戏 API 返回什么，都不再做后续动作）
     */
    private attackHostile(ids?: Id<Creep>[]): boolean {
        if (!ids || !ids.length) {
            return false
        }
        let fallback: Creep | undefined
        for (const id of ids) {
            const target = Game.getObjectById<Creep>(id)
            // 扫描缓存有间隔，期间可能被加进白名单；这里再兜底校验一次
            if (!target || isWhitelistedCreep(target)) {
                continue
            }
            if (this.pos.inRangeTo(target, TOWER_OPTIMAL_RANGE)) {
                this.attack(target)
                return true
            }
            if (!fallback && this.pos.inRangeTo(target, TOWER_FALLOFF_RANGE)) {
                fallback = target
            }
        }
        if (fallback) {
            this.attack(fallback)
            return true
        }
        return false
    }

    /**
     * 治疗己方受伤 creep，缓存里已经按血量比例升序排好。
     */
    private healCreep(ids?: Id<Creep>[]): boolean {
        if (!ids || !ids.length) {
            return false
        }
        let fallback: Creep | undefined
        for (const id of ids) {
            const target = Game.getObjectById<Creep>(id)
            // 扫描缓存有间隔，期间可能已经治满，避免继续浪费能量
            if (!target || target.hits >= target.hitsMax) {
                continue
            }
            if (this.pos.inRangeTo(target, TOWER_OPTIMAL_RANGE)) {
                this.heal(target)
                return true
            }
            if (!fallback && this.pos.inRangeTo(target, TOWER_FALLOFF_RANGE)) {
                fallback = target
            }
        }
        if (fallback) {
            this.heal(fallback)
            return true
        }
        return false
    }

    private repairNext(queue: Id<Structure>[], room: Room): void {
        while (queue.length) {
            const id = queue[0]
            const target = Game.getObjectById<Structure>(id)
            if (!target || target.hits >= target.hitsMax) {
                room.dropRepairTarget(id)
                continue
            }
            const result = this.repair(target)
            if (result == ERR_NOT_ENOUGH_ENERGY || result == OK) {
                return
            }
            // 目标已经不可维修（被摧毁/换手等），移出队列，避免下 tick 死循环
            room.dropRepairTarget(id)
            return
        }
    }

    private canRepair(): boolean {
        const energy = this.store.getUsedCapacity(RESOURCE_ENERGY)
        return energy >= this.store.getCapacity(RESOURCE_ENERGY) * towerSetting.repairReserve
    }

    /**
     * 能量不足时通过 room 的 carryTask 申请补给；同一座塔按 refillInterval 节流，
     * ensureEnergyCarryTask 内部还会按目标 id 去重，因此不会重复登记任务。
     */
    private ensureEnergySupply(cache: RoomGlobalCache): void {
        const energy = this.store.getUsedCapacity(RESOURCE_ENERGY)
        if (energy >= this.store.getCapacity(RESOURCE_ENERGY) * towerSetting.refillThreshold) {
            return
        }
        if (!cache.refillTicks) {
            cache.refillTicks = {}
        }
        const lastTick = cache.refillTicks[this.id]
        const now = Game.time
        if (lastTick !== undefined && now - lastTick < towerSetting.refillInterval) {
            return
        }
        cache.refillTicks[this.id] = now
        this.room.ensureEnergyCarryTask(this.id as unknown as Id<AnyStoreStructure>)
    }
}
