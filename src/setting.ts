// carrier / worker 的体型预算占房间能量容量（energyCapacityAvailable）的比例。
// 分两档：房间里还有同类角色（≥1 只）时用 spawnPercentFull 拉满，
// 一只都不剩（补员空窗）时才退回 spawnPercent 的救急体型——满体型一次就掏空
// 房间能量，空窗时容易卡孵；有小体型先顶上，稳住后再产满体型。
export const spawnPercent = 0.6
export const spawnPercentFull = 1

// spawn 队列等能量的兜底阈值：任务排队超过这么多 tick 还买不起满体型 body，
// 就按当前能量缩小体型 / 让救急 carrier 插队。
// 只有本地 carrier 允许缩体型，其它角色一直等满体型。
export const spawnSetting = {
    affordWaitTicks: 100,
}

export const spawnTable: { [role in Role]: number[] } = {
    //               0, 1, 2, 3, 4, 5, 6, 7, 8
    'harvester':    [0, 0, 0, 0, 0, 0, 0, 0, 0], // harvester 根据房间source数量动态调整
    // 本地 carrier 不再按这张表孵化：稳态数量由 localCarrierTarget()
    // 按"矿点产能 × 往返 / 单车运力"算（下限 carrierSetting.localFloor）。
    // 这里只保留历史值作参考，initSpawn 不会读它。
    'carrier':      [0, 1, 3, 2, 2, 2, 2, 2, 2],
    // 主矿 2 个矿点：RCL2 产能 16/tick，RCL3+ 约 24/tick。
    // 满体型 worker 的 WORK = (容量-150)/150（RCL3 4 WORK、RCL4 7 WORK）。
    // 每只只带 3 CARRY=150 能量，有效升级速度 ≈ 150 / (往返 tick + 150/WORK)：
    // RCL2 2 WORK → 10 人；RCL3 4 WORK → 6 人；RCL4 7 WORK → 4 人；
    // RCL5 11 WORK → 2 人；RCL6+ 1-2 人就吃满产能。
    // RCL2 的 10 低于 upgradeSetting.maxCapacity=12，不会压到建造/维修。
    'worker':       [0, 3, 10, 6, 4, 2, 2, 1, 1],
    'emptyWorker':  [0, 0, 0, 0, 0, 0, 0, 0, 0], // emptyWorker不主动孵化
    // 外矿 harvester 不按这张表自动孵化：配额由 Memory.remotePlan + 富余能量门槛决定
    'remoteHarvester': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 侦察兵同样不进正常配额：有房间需要情报时才由外矿逻辑补一个
    'viewer':       [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 外矿运输也不按这张表孵化：由 refreshRemoteCarrierSpawn 按"每个矿点一只"补员
    'remoteCarrier': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // claimer 不参与自动配额：refreshClaimSpawn 按 reserve 到期/显式 claim 需求补员
    'claimer':      [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 反击队不参与自动配额：refreshCounterSpawn 按弱敌情报按需补员，reSpawn=false
    'attacker':     [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 中央 carrier 不按这张表孵化：由 ensureCenterCarrier 在 link 解锁且
    // 中央 link + 至少一条转发 link + storage 都到位后补一只常驻
    'centerCarrier': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // miner 不按这张表孵化：由 ensureMiner 在 extractor 建成后按矿点补一只
    'miner':        [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // sleep 是矿采空后的临时状态，从不孵化
    'sleep':        [0, 0, 0, 0, 0, 0, 0, 0, 0],
}

// 矿物开采：extractor 需要 RCL6；冷却 5 tick 是引擎常量，
// 用户代码里拿不到 EXTRACTOR_COOLDOWN，只能在这里存一份。
export const mineralSetting = {
    minRcl: 6,
    extractorCooldown: 5,
}

// 本地 carrier 保底数量：运输车和本地 carrier 体型完全一样，
// 外矿缺车时优先把空闲的本地 carrier 转职过去，但本地至少留这么多，
// 否则 spawn/extension 补能会断档。
// 稳态数量由 localCarrierTarget() 按产能/运力算，这里只是下限（兜底 1 只）。
export const carrierSetting = {
    localFloor: 1,
}

// worker 人数按可用产能动态决定（不是按固定配额）：
// 主矿 + 外矿的 harvester 按平均产出 sourceRate 能量/tick 估算收入，
// 满体型 worker 的 WORK 数决定消耗速度 drainFactor（含走路/建造/维修的空耗）。
// 人数 = ceil(收入 / 消耗)，夹在 [spawnTable.worker[level], 基准 + maxExtra] 之间。
export const workerSetting = {
    // 每个 harvester（含外矿）的平均产出：3000 能量 / 300 tick
    sourceRate: 10,
    // 每个 WORK 部件的能量消耗速度（升级 1/tick，建造/维修/走路折算后约 1.5）
    drainFactor: 1.5,
    // 在 RCL 基准配额之上最多再追加几个 worker
    maxExtra: 4,
}

export const upgradeTaskCapacity = [0, 2, 2, 5, 5, 4, 4, 4, 1]

// 升级并发：有工地时仍用 upgradeTaskCapacity 的基准值，
// 工地清零后放开到实际 worker 数（不超过 maxCapacity）。
// worker 的任务顺序里 upgrade 排在 construct 前面，所以有工地时必须限流。
export const upgradeSetting = {
    maxCapacity: 12,
}

// spawn/extension 顺序表的兜底扫描间隔。建成/拆除有事件，
// 这里只处理漏网的情况，频率不需要高。
export const energyStructureScanInterval = 100

// container 低/高水位（按 controller level 取）。
// 低于 low：不派新的取能任务，留一点缓冲，避免空 container 吸人。
// 达到 high：并发拉满；介于两者之间时按可用能量 / carrier 平均载重算并发。
// 数值先按经验给，后续按官服实测调整。
export const containerWatermark = [
    {low: 0, high: 0},        // RCL0
    {low: 50, high: 600},     // RCL1
    {low: 50, high: 1000},    // RCL2
    {low: 50, high: 1400},    // RCL3
    {low: 50, high: 1600},    // RCL4
    {low: 100, high: 1800},   // RCL5
    {low: 100, high: 2000},   // RCL6
    {low: 100, high: 2000},   // RCL7
    {low: 100, high: 2000},   // RCL8
]

// 单个 container 同时允许几个 creep 取能的上限（按 RCL）
export const containerConcurrency = [0, 1, 2, 3, 4, 4, 5, 5, 5]

// 掉落物/墓碑的机会队列：按衰减速度 + 距离评分，只保留前几条
export const opportunitySetting = {
    maxTasks: 4,
    // 单条机会任务最多允许几个 creep。按"资源量 / 房间最大 carry 容量"动态算，
    // 这里只是上限：大堆掉落物可以一次派一队人去捡。
    maxCapacity: 6,
}

// storage 储备：低于 reserveEnergy 不再向外派取能任务
export const storageSetting = {
    reserveEnergy: 5000,
    maxCapacity: 5,
}

export const repairSetting = {
    // 同时存在的维修任务上限。每个任务容量 1，避免大量 worker 被维修吸走
    maxTasks: 3,
    // 单个维修任务允许几个 creep 同时修
    capacity: 1,
}

/**
 * 维修优先级：数值越小越先被 worker 领取
 * 1 关键结构 / 2 其他结构 / 3 道路
 */
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

export function repairPriority(type: StructureConstant): number {
    return repairPriorityMap[type] ?? 2
}

export const wallSetting = {
    // 墙体/防御墙扫描间隔，比普通维修低得多
    scanInterval: 50,
    // 同时存在的墙体维修任务上限
    maxTasks: 2,
    // 单个墙体维修任务允许几个 creep
    capacity: 1,
    // 每次扫描最多放进队列的目标数
    queueSize: 10,
    // 目标血量按 controller level 取，0 表示不维护
    targetHits: [0, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 300000],
    // storage 能量达到该值以上才开始维护，避免前期把能量全填进墙里
    minStorageEnergy: 50000,
}

// 布局外的道路：连接锚点用完整布局道路网（所有 r 格，不管当前等级），
// 一次规划到 RCL8 的最终走向，再按等级分段施工——
// RCL3 铺的本地段就是最终路网的一部分，后续等级只往外延伸。
export const roadSetting = {
    // 本地段：矿点 container + controller
    localMinLevel: 3,
    // 外矿段：主房里通往各外矿出口的 remoteLinkPos
    remoteMinLevel: 4,
    // 矿物段：矿物位置（FIND_MINERALS）
    mineralMinLevel: 5,
    // 每房工地上限（MAX_CONSTRUCTION_SITES）打满时的重试间隔。
    // 到上限就挂一个这么 tick 之后的回调事件，不用定时扫描。
    siteRetryTicks: 3000,
}

export const harvestSetting = {
    // 每个矿点允许的采集者数量：平时 1 个，换班时新旧 harvester 可以同时占用
    capacity: 2,
    // 提前量：spawn 排队、地形绕路等额外预留的 tick
    earlyMargin: 15,
    // 没有布局距离缓存时的默认路径长度（tile）
    defaultDistance: 20,
}

// 外矿（"富余能量才做"的添头）
export const remoteSetting = {
    // 同一个外矿 container 最多同时派几辆车：任务并发按
    // ceil(container 能量 / 房间最大 carry 容量) 动态算，这里只是上限。
    carryMax: 4,
    // 外矿 transport 车补员门槛：外矿 container 至少存了这么多能量才补车。
    // 不用本地 container 高水位做门槛——运输车本来就是去把外矿满仓的能量搬回来，
    // 等本地 container 涨起来，外矿早就满仓、harvester 倒不进去只能睡觉了。
    carrySpawnEnergy: 800,
    // harvester 修外矿 container 的血量阈值：低于 hitsMax * 该值就优先维修
    repairThreshold: 0.9,
    // 每个主房自动选定的外矿房上限（相邻房最多四个）
    maxRooms: 4,
    // 回主房投递时外矿 link 已满：先在 link 旁边等中央 carrier 腾中央 link，
    // 连续等这么多 tick 才退回 drop 暂存（正常链路下几 tick 就腾出来了）
    linkFullWaitTicks: 30,
}

// 战争模块（Phase 2：威胁分级 + 外矿撤离/复探）。
// 数值只用于"要不要躲、要不要停外矿"的判断，不追求精确战斗模拟。
export const warSetting = {
    // 每个部件的理论输出：ATTACK 30/tick、RANGED_ATTACK 10/tick（贴身）、HEAL 12/tick
    attackDps: 30,
    rangedDps: 10,
    healPerPart: 12,
    // 弱敌判定：没有 HEAL、数量不超过 N、总 DPS 不超过 D。
    // 这类敌人留给下一批的反击队；现在先保证外矿不送人头。
    weakMaxCount: 2,
    weakMaxDps: 300,
    // 视野里连续这么久没有武装敌对，才算这一轮骚扰结束、外矿恢复
    hostileCalmTicks: 100,
    // 武装敌对还在时，侦察兵隔这么久回去复查一次（没视野时靠它推进清场判定）
    hostileRecheckTicks: 150,
    // 强敌导致外矿停用后，这么久再派侦察兵复探
    rescoutTicks: 500,
    // siege 判定：总 DPS 达到、或 WORK 拆墙部件 + 数量同时达到
    siegeDps: 600,
    siegeWorkParts: 5,
    siegeMinCount: 3,
    // 弱敌反击队：每只 5 ATTACK + 5 MOVE = 150 DPS（RCL4 容量 1300 时的体型）
    counterDpsEach: 150,
    // 一个外矿房最多同时派几只、全部外矿加起来最多几只
    counterMaxPerRoom: 2,
    counterMaxTotal: 3,
    // 同一轮骚扰最多派几队；打光后等 reinforceTicks 再整队补派
    counterMaxAttempts: 3,
    counterReinforceTicks: 300,
    // 看不到目标房时的伤害证据（丢部件/提前死亡）：
    // 窗口内累计到这个次数才暂停外矿，单次只提前派侦察
    suspicionWindow: 300,
    suspicionLimit: 2,
    // L3 任务：集合阶段最多等多久。单 spawn 房间里 4 只 10 部件的小队
    // 需要 120 tick，留了 3 倍余量；到点最多允许 counter 部分出发。
    missionFormTimeout: 400,
    // 任务总时限：超出就撤回，避免小队在外面耗到 TTL 耗尽
    missionTimeout: 1200,
    // 新 episode 开始后最多派几队（counter 与 counterMaxAttempts 对齐）
    expeditionMaxAttempts: 2,
    // 出征连续失败几次后进入冷却
    expeditionMaxFails: 2,
    expeditionCooldownTicks: 5000,
    // 出征只打低等级 core：等级高的强心带塔/城墙，小队打不动
    expeditionMaxCoreLevel: 2,
    // 单只 attacker 在一次任务里能输出的有效 tick（扣掉赶路/撤退余量）
    expeditionCombatTicks: 300,
    // 出征队上限：再多人 spawn 时间就超过 TTL 预算了
    expeditionMaxAttackers: 4,
}

export const towerSetting = {
    // 和平时期每 5 tick 扫描一次敌对 creep，防御时期每 tick 扫描
    threatScanInterval: 5,
    // 每 15 tick 刷新一次维修队列
    repairScanInterval: 15,
    // 连续 N 次扫描没有敌对 creep 才切回和平
    calmTicksToPeace: 2,
    // 塔能量低于 60% 时请求 carrier 补能
    refillThreshold: 0.6,
    // 补能请求的节流间隔
    refillInterval: 10,
    // 维修时保留 50% 能量用于防守/治疗
    repairReserve: 0.5,
    // hits 低于最大值的 80% 才进入维修队列
    repairThreshold: 0.8,
}
