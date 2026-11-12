import { warSetting } from "@/setting"

/**
 * L3 编成规则：只根据 L2 写好的情报算"该派几只"，
 * 不碰 Memory、不管出生时间，纯函数，方便私服单测。
 */

/**
 * 反击队人数：按敌方总 DPS / 单只输出向上取整，夹在 1..counterMaxPerRoom。
 * 只有 raid 级（无 HEAL、小股）才出队；assault/siege 留给后续扩编。
 */
export function counterSquadSize(intel: MapIntel): number | undefined {
    if (intel.response !== 'counter' || intel.threatLevel !== 'raid') {
        return undefined
    }
    const dps = intel.hostileDps ?? 0
    if (dps <= 0) {
        return undefined
    }
    return Math.min(
        warSetting.counterMaxPerRoom,
        Math.max(1, Math.ceil(dps / warSetting.counterDpsEach)),
    )
}

/**
 * 出征队人数：core 的 hits / (单只 DPS × 有效战斗 tick) 向上取整。
 * 等级太高、还在部署（无敌）或所需人数超上限就不出征，只保留侦察。
 */
export function expeditionSquadSize(intel: MapIntel): number | undefined {
    if (intel.response !== 'expedition' || !intel.coreId) {
        return undefined
    }
    if ((intel.coreLevel ?? 0) > warSetting.expeditionMaxCoreLevel) {
        return undefined
    }
    if ((intel.coreDeploy ?? 0) > 0) {
        // 部署中的 core 打不掉，等它部署完再看
        return undefined
    }
    const hits = intel.coreHits ?? 0
    if (hits <= 0) {
        return undefined
    }
    const perAttacker = warSetting.counterDpsEach * warSetting.expeditionCombatTicks
    const need = Math.ceil(hits / perAttacker)
    if (need > warSetting.expeditionMaxAttackers) {
        return undefined
    }
    return Math.max(1, need)
}
