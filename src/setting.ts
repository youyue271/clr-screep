export const spawnPercent = 0.6

// spawn 队列等能量的兜底阈值：任务排队超过这么多 tick 还买不起 body，
// 就按当前能量换一个买得起的最小体型先孵化。
// 正常补能 100 tick 内早就够了，只在 carrier 全灭之类的饿死场景生效。
export const spawnSetting = {
    affordWaitTicks: 100,
    // 总等待硬上限：能量一直在缓慢增长时也会在这么多 tick 后强制缩体型，
    // 保证兜底一定生效（正常 100 tick 内涨够就不会走到这里）
    affordMaxWaitTicks: 400,
}

export const spawnTable: { [role in Role]: number[] } = {
    //               0, 1, 2, 3, 4, 5, 6, 7, 8
    'harvester':    [0, 0, 0, 0, 0, 0, 0, 0, 0], // harvester 根据房间source数量动态调整
    'carrier':      [0, 1, 2, 5, 5, 5, 5, 5, 5],
    'worker':       [0, 3, 6, 9, 9, 7, 7, 7, 3],
    'emptyWorker':  [0, 0, 0, 0, 0, 0, 0, 0, 0], // emptyWorker不主动孵化
    // 外矿 harvester 不按这张表自动孵化：配额由 Memory.remotePlan + 富余能量门槛决定
    'remoteHarvester': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 侦察兵同样不进正常配额：有房间需要情报时才由外矿逻辑补一个
    'viewer':       [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 外矿运输也不按这张表孵化：由 refreshRemoteSpawn 按"每房配额"补员
    'remoteCarrier': [0, 0, 0, 0, 0, 0, 0, 0, 0],
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

// container 列表的兜底刷新间隔。建成有 buildOver 事件，这里只处理漏网/被拆。
export const containerScanInterval = 100

// 掉落物/墓碑的机会队列：按衰减速度 + 距离评分，只保留前几条
export const opportunitySetting = {
    maxTasks: 4,
    // 单条机会任务最多允许几个 creep
    maxCapacity: 2,
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
    // 同一个外矿 container 同时允许几个 carrier 去拉
    carryCapacity: 2,
    // harvester 修外矿 container 的血量阈值：低于 hitsMax * 该值就优先维修
    repairThreshold: 0.9,
    // 每个主房自动选定的外矿房上限（相邻房最多四个）
    maxRooms: 4,
    // 每个"已建好 container"的外矿房配几个专用 remoteCarrier
    carriersPerRoom: 1,
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
