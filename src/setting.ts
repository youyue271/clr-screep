export const spawnPercent = 0.6

export const spawnTable: { [role in Role]: number[] } = {
    //               0, 1, 2, 3, 4, 5, 6, 7, 8
    'harvester':    [0, 0, 0, 0, 0, 0, 0, 0, 0], // harvester 根据房间source数量动态调整
    'carrier':      [0, 1, 2, 5, 5, 5, 5, 5, 5],
    'worker':       [0, 3, 6, 9, 9, 7, 7, 7, 3],
    'emptyWorker':  [0, 0, 0, 0, 0, 0, 0, 0, 0], // emptyWorker不主动孵化
}

export const upgradeTaskCapacity = [0, 2, 2, 5, 5, 4, 4, 4, 1]

// spawn/extension 顺序表的兜底扫描间隔。建成/拆除有事件，
// 这里只处理漏网的情况，频率不需要高。
export const energyStructureScanInterval = 100

// TODO(energy): container 低/高水位、取能任务并发数按 RCL 配置。
// 后期大型 carrier 一次能取很多，并发数应随 carrier 平均载重动态下降，
// 不要一直固定为 3。Phase 2 再实现。

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
