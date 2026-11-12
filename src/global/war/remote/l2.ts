import { recordRoomIntel } from "@/global/autoplan/remotePlan"
import type { RemoteL1Report } from "../types"

/**
 * L2：拿到 L1 的事实后做分类和决策。
 *
 * 目前只做一个兼容适配器，保持旧行为：有视野、且确实看见敌人/确认被占时，
 * 写回现有情报系统（暂停/停用/清任务都由 recordRoomIntel 完成）。
 * 真正的分类（invader 兵/基地、别的玩家 claimer 等）以后在这里补。
 */
export function callRemoteL2(report: RemoteL1Report): void {
    if (!report.vision) {
        return
    }
    // 走廊/主房里看到的敌人不能直接算到外矿房头上；L1 在主房时会自动改探外矿房
    if (report.observedRoom !== report.targetRoom) {
        return
    }
    // 纯死亡/部件损失但视野干净：先不动计划和情报。
    // 这类"可疑但有视野"的判定留给 L2 正式实现，避免误重开/误停用。
    if (report.signal.kind !== 'occupied' && !report.hasHostile) {
        return
    }
    const room = Game.rooms[report.observedRoom]
    if (!room) {
        return
    }
    recordRoomIntel(report.homeRoom, room)
}
