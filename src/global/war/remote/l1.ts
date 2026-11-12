import { callRemoteL2 } from "./l2"
import type { RemoteL1Report, RemoteSignal } from "../types"

/** 离开外矿房后多少 tick 内死亡仍然归因到这次外矿任务 */
const RECENT_LEAVE_TICKS = 100

/**
 * 外矿 L1：只采集事实，不做任何决策。
 *
 * 两个入口分别给 carrier 和 harvester 的异常分支调用；正常 tick 不遍历、
 * 不检查 hits。carrier 的"CARRY 被打光"走现有通用异常分支自毁，死亡事实
 * 由 creepRecycle 通过 onRemoteDeath 送进来，所以 carrier 侧不需要每 tick 钩子。
 */

/** carrier 侧的 L1 入口（预留给以后可能出现的 carrier 主动信号） */
export function onRemoteCarrierSignal(creep: Creep, signal: RemoteSignal): void {
    emitFromCreep(creep, signal)
}

/** harvester 侧的 L1 入口：采集/建造/修理异常时立刻上报 */
export function onRemoteHarvestSignal(creep: Creep, signal: RemoteSignal): void {
    emitFromCreep(creep, signal)
}

/**
 * 死亡 L1 入口：由 creepRecycle 在删除 Memory.creeps 之前调用。
 * 只处理"提前死亡"（没活到自然 TTL），自然死亡不归因。
 */
export function onRemoteDeath(creepName: string, memory: CreepMemory): void {
    const homeRoom = memory.spawnRoom
    const targetRoom = remoteTargetOf(memory)
    if (!homeRoom || !targetRoom) {
        return
    }
    const creepRoom = memory.lastRoom
    if (!creepRoom) {
        return
    }
    // 已经离开外矿很久才死：无法归因到外矿，避免把主房/路上的意外死亡算进来
    if (creepRoom !== targetRoom) {
        const leftAt = memory.lastRoomAt
        if (leftAt === undefined || Game.time - leftAt > RECENT_LEAVE_TICKS) {
            return
        }
    }
    callRemoteL2(buildReport(creepName, homeRoom, targetRoom, creepRoom, { kind: 'death' }))
}

/**
 * 外矿 creep 每 tick 经过自己任务逻辑时调用（只在换房/首次时写内存）。
 * 记录最后任务房和最后所在房，死亡时 recycle 才有足够信息做归因。
 */
export function rememberRemoteTarget(creep: Creep, targetRoom: string): void {
    const memory = creep.memory
    if (memory.lastRemoteRoom !== targetRoom) {
        memory.lastRemoteRoom = targetRoom
    }
    if (memory.lastRoom !== creep.room.name) {
        memory.lastRoom = creep.room.name
        memory.lastRoomAt = Game.time
    }
    // 兼容推代码前已经存在的 creep：出生时没记 dieAt，这里补一次
    if (memory.dieAt === undefined && creep.ticksToLive !== undefined) {
        memory.dieAt = Game.time + creep.ticksToLive
    }
}

function emitFromCreep(creep: Creep, signal: RemoteSignal): void {
    const memory = creep.memory
    const homeRoom = memory.spawnRoom
    const targetRoom = remoteTargetOf(memory)
    if (!homeRoom || !targetRoom) {
        return
    }
    callRemoteL2(buildReport(creep.name, homeRoom, targetRoom, creep.room.name, signal))
}

function remoteTargetOf(memory: CreepMemory): string | undefined {
    if (memory.lastRemoteRoom) {
        return memory.lastRemoteRoom
    }
    if (memory.remoteCarryRoom) {
        return memory.remoteCarryRoom
    }
    const param = memory.currentWork?.taskParam
    const value = param?.[1]
    return typeof value === 'string' ? value : undefined
}

/**
 * 观察房：creep 在主房时（典型是 carrier 在边界被打掉 MOVE/CARRY 后退回主房），
 * 主房本身没有外矿情报意义，改为探 targetRoom；有视野就用，没视野也照样把
 * vision=false 交给 L2。
 */
function buildReport(
    creepName: string,
    homeRoom: string,
    targetRoom: string,
    creepRoom: string,
    signal: RemoteSignal,
): RemoteL1Report {
    const observedRoom = creepRoom === homeRoom ? targetRoom : creepRoom
    const room = Game.rooms[observedRoom]
    const report: RemoteL1Report = {
        homeRoom,
        targetRoom,
        observedRoom,
        creepRoom,
        signal,
        vision: !!room,
        creepName,
        tick: Game.time,
    }
    if (!room) {
        return report
    }
    const creeps = room.find(FIND_HOSTILE_CREEPS)
    const structures = room.find(FIND_HOSTILE_STRUCTURES)
    report.hasHostile = creeps.length > 0 || structures.length > 0
    if (creeps.length) {
        report.hostileCreepIds = creeps.map(creep => creep.id)
    }
    if (structures.length) {
        report.hostileStructureIds = structures.map(structure => structure.id)
    }
    return report
}
