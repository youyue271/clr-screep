import {warSetting} from "@/setting"
import {filterHostileCreeps} from "@/util/whitelist"

/**
 * 数某个 creep 还活着的部件（hits > 0）。
 * 被打掉的部件不产生伤害/治疗，分级必须按实际剩余战力算。
 */
function activeParts(creep: Creep, type: BodyPartConstant): number {
    let count = 0
    for (const part of creep.body) {
        if (part.type === type && part.hits > 0) {
            count++
        }
    }
    return count
}

/**
 * 把一批敌对 creep 归成威胁档位：
 * - 没有任何攻击/CLAIM 能力 = harmless（纯 WORK 矿工、运输车、路过侦察兵）
 * - 无 HEAL 的小股武装 = raid（留给外矿反击队处理）
 * - 有 HEAL / 多只 / 高 DPS = assault
 * - 拆墙能力或极高 DPS = siege
 * 都按理论满输出估算，用于决定"躲不躲、停不停外矿"，不用于精确战斗结算。
 */
export function classifyThreat(creeps: Creep[]): ThreatSummary {
    const summary: ThreatSummary = {
        level: 'none',
        count: 0,
        attackParts: 0,
        rangedParts: 0,
        workParts: 0,
        healParts: 0,
        claimParts: 0,
        dps: 0,
        healPerTick: 0,
        ids: [],
    }
    for (const creep of creeps) {
        if (!creep) {
            continue
        }
        const attack = activeParts(creep, ATTACK)
        const ranged = activeParts(creep, RANGED_ATTACK)
        const work = activeParts(creep, WORK)
        const heal = activeParts(creep, HEAL)
        const claim = activeParts(creep, CLAIM)
        summary.count++
        summary.attackParts += attack
        summary.rangedParts += ranged
        summary.workParts += work
        summary.healParts += heal
        summary.claimParts += claim
        summary.ids.push(creep.id)
    }
    summary.dps = summary.attackParts * warSetting.attackDps
        + summary.rangedParts * warSetting.rangedDps
    summary.healPerTick = summary.healParts * warSetting.healPerPart
    if (summary.count === 0) {
        return summary
    }
    const armed = summary.attackParts + summary.rangedParts + summary.claimParts > 0
    if (!armed) {
        summary.level = 'harmless'
        return summary
    }
    if (summary.dps >= warSetting.siegeDps
        || (summary.workParts >= warSetting.siegeWorkParts && summary.count >= warSetting.siegeMinCount)) {
        summary.level = 'siege'
        return summary
    }
    if (summary.healParts === 0
        && summary.count <= warSetting.weakMaxCount
        && summary.dps <= warSetting.weakMaxDps) {
        summary.level = 'raid'
        return summary
    }
    summary.level = 'assault'
    return summary
}

/**
 * 有攻击能力（含 CLAIM 抢控制器）的敌人才算威胁。
 * 纯 WORK 矿工、运输车、没有攻击部件的侦察兵不算。
 */
export function isArmedThreat(summary: ThreatSummary): boolean {
    return summary.level !== 'none' && summary.level !== 'harmless'
}

/**
 * 弱敌：无 HEAL、数量/总 DPS 在阈值内。
 * 现在先不反击，但外矿同样要撤离；下一批交给反击队。
 */
export function isWeakThreat(summary: ThreatSummary): boolean {
    return summary.level === 'raid'
}

/**
 * 按当前视野直接判断房间里有没有需要避战的武装敌对。
 * 外矿 creep 在自己房里每 tick 都能用，不依赖 10 tick 的情报刷新。
 */
export function hasArmedHostile(room: Room): boolean {
    // 白名单玩家的兵不算威胁，外矿 creep 不必因为它们在房里就撤
    return isArmedThreat(classifyThreat(filterHostileCreeps(room.find(FIND_HOSTILE_CREEPS))))
}

/**
 * 情报里这一轮骚扰还没结束（外矿暂停补员/出货）。
 * hostileSince 是确认敌情，suspicionSince 是无视野时的伤害证据；
 * 两者都由 L2 写，清场/侦察确认干净后才会删除。
 */
export function isRemotePaused(intel: MapIntel | undefined): boolean {
    return !!intel && (intel.hostileSince !== undefined || intel.suspicionSince !== undefined)
}

/**
 * NPC 阵营的用户名。反击队只清 NPC/野生敌对，
 * 别的玩家 owner/reserve 的房一律不打。
 */
const npcUsers = ['Invader', 'Source Keeper']

export function isNpcUser(username: string | undefined): boolean {
    return !!username && npcUsers.indexOf(username) >= 0
}
