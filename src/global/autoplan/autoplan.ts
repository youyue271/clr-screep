import {initializeArray} from "@/util/utils";


export function visualizeSquare(anchors: any[], mapBuffer: any[], roomName: string) {
    // for(const anchor of anchors) {
    const anchor = anchors[0]
    const x = anchor[0];
    const y = anchor[1];
    const l = 11

    const point1 = new RoomPosition(x, y, roomName);
    const point2 = new RoomPosition(x - l, y, roomName);
    const point3 = new RoomPosition(x, y - l, roomName);
    const point4 = new RoomPosition(x - l, y - l, roomName);
    Game.rooms[roomName].visual.line(point1, point2, {width: 0.5, color: '#ff0000'})
    Game.rooms[roomName].visual.line(point2, point4, {width: 0.5, color: '#ff0000'})
    Game.rooms[roomName].visual.line(point3, point1, {width: 0.5, color: '#ff0000'})
    Game.rooms[roomName].visual.line(point4, point3, {width: 0.5, color: '#ff0000'})
    // }
    // }
}

export const plan1 = [
    "e5 e5 e5 e4 e4 r4 e4 e4 e3 e3 e3",
    "e5 r5 r5 e5 r5 e4 r4 e4 e3 r4 e3",
    "e5 e5 e5 r5 s7 n8 t5 r4 e2 r4 e2",
    "e6 e5 r5 e5 r5 e4 t7 t3 r4 e2 e2",
    "e6 r6 e6 e6 T6 r4 e4 r4 s1 r4 e2",
    "r6 e6 e6 p8 r6 S4 r4 e4 l6 l6 r4",
    "e6 r6 e6 r6 f7 r5 e4 l8 l6 r6 l7",
    "e7 e7 r6 e6 e6 L5 r6 l8 r6 l7 l7",
    "e7 r6 e7 r6 t8 t8 s8 r6 l8 l8 e8",
    "e7 r6 e7 e7 r6 t8 r6 e8 r6 r6 e8",
    "e7 e7 e7 e8 e8 r6 e8 e8 e8 e8 e8"
]

/**
 * 11*11 基地集群
 */

// export const totalCluster1 = [
//     "e5 e5 e5 e4 e4 r4 e4 e4 e3 e3 e3",
//     "e5 r5 r5 t7 r4 e4 r4 e4 e3 r3 e2",
//     "e5 e5 e5 r4 e4 e4 t5 r3 e3 r3 e2",
//     "e6 e5 r5 e5 r4 n8 e4 e4 r3 t3 e2",
//     "e6 r5 e6 e5 T6 r4 s7 r3 e2 r2 e2",
//     "r5 e6 e6 L5 r5 S4 r4 s1 l8 l8 r2",
//     "e6 r6 e6 r6 f7 r5 s8 l7 l7 r4 l8",
//     "e6 t8 r6 e7 e7 p8 r5 l6 r4 l7 l8",
//     "e6 r6 e7 r6 t8 e8 e8 r5 l6 l6 e8",
//     "e6 r6 e7 e7 r6 e8 r6 t8 r6 r6 e8",
//     "e7 e7 e7 e7 e7 r6 e8 e8 e8 e8 e8"
// ]

export const plan2_Core = [
    "r5 e2 r5 t5 r5 e2 r5",
    "e2 r5 e2 r5 e2 r5 p8",
    "r5 n8 r5 T6 r5 e4 r5",
    "s1 r5 S4 r5 f7 r5 t3",
    "r5 e4 r5 L5 r5 e3 r5",
    "e4 r5 e3 r5 e3 r5 e3",
    "r5 e4 r5 t7 r5 e3 r5"
]

export const plan2_Lab = [
    "N l7 l8 r7",
    "l7 l7 r7 l8",
    "l8 r7 l6 l6",
    "r7 l8 l6 N",
]


/**
 * 6*6 extension集群
 * 包含24个extension
 */
export const plan2_extensionCluster1 = [
    "e4 e4 r4 r5 e5 e5",
    "e4 r4 e4 e5 r5 e5",
    "r4 e4 e4 e5 e5 r5",
    "r5 e5 e5 e5 s7 r6",
    "e6 r5 e5 e6 r6 e6",
    "e6 e6 r6 r6 e6 e6"
]

export const plan2_extensionCluster2 = [
    "e6 e6 r7 r7 e7 e7",
    "e6 r7 e7 e7 r7 e7",
    "r7 e7 e7 e7 e7 r7",
    "r8 e7 e8 e8 s8 r7",
    "e8 r8 e8 e8 r8 e8",
    "e8 e8 r8 r8 e8 e8"
]

/**
 * 6*6 extension集群
 * 包含24个extension
 */
export const extensionCluster1 = [
    "e e r r e e",
    "e r e e r e",
    "r e e e e r",
    "r e e e e r",
    "e r e e r e",
    "e e r r e e"
]

/**
 * 7*7 extension集群
 * 包含了32个extension, 以及一个link
 */
export const extensionCluster2 = [
    "e e N e e r e",
    "r e e e r e e",
    "e r e r e e N",
    "e e r L r e e",
    "N e e r e r e",
    "e e r e e e r",
    "e r e e N e e"
]

export const mapping = {
    e: STRUCTURE_EXTENSION,
    r: STRUCTURE_ROAD,
    n: STRUCTURE_NUKER,
    s: STRUCTURE_SPAWN,
    t: STRUCTURE_TOWER,
    T: STRUCTURE_TERMINAL,
    S: STRUCTURE_STORAGE,
    L: STRUCTURE_LINK,
    l: STRUCTURE_LAB,
    p: STRUCTURE_POWER_SPAWN,
    f: STRUCTURE_FACTORY,
    o: STRUCTURE_OBSERVER,
    N: "Null"
}


/**
 * 能量桶：一个桶 = 一个道路节点 + 若干距离恰好为 1 的 extension。
 * 坐标都是对应 plan 地图里的局部坐标，运行时按锚点换算成绝对坐标：
 * plan1: abs = plan1Pos + local - plan1.length
 * plan2: abs = regionAnchor + local - (map.length - 1)
 *
 * carrier 只需要走到桶节点，桶内成员全部在 1 格范围内，
 * 不用为每个 extension 单独寻路；spawn 扣能量时按桶为前缀取，
 * 一个桶被抽掉多少，就只登记这一个桶的补能任务。
 */
export interface EnergyBucketPlan {
    node: [number, number]
    members: [number, number][]
}

/**
 * plan1 严格距离 1 的 16 桶划分：60 个 extension 全覆盖、无重复，
 * 每桶 3~5 个。节点本身必须是道路格。
 */
export const plan1Buckets: EnergyBucketPlan[] = [
    {node: [1, 1], members: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]]},
    {node: [4, 1], members: [[3, 0], [4, 0], [3, 1], [5, 1]]},
    {node: [6, 1], members: [[6, 0], [7, 0], [7, 1]]},
    {node: [9, 1], members: [[8, 0], [9, 0], [10, 0], [10, 2]]},
    {node: [9, 2], members: [[8, 1], [10, 1], [8, 2]]},
    {node: [2, 3], members: [[1, 2], [2, 2], [1, 3], [2, 4]]},
    {node: [4, 3], members: [[5, 3], [3, 3], [3, 4]]},
    {node: [1, 4], members: [[0, 3], [0, 4], [1, 5], [2, 5]]},
    {node: [9, 4], members: [[10, 4], [9, 3], [10, 3]]},
    {node: [6, 5], members: [[6, 4], [7, 5], [6, 6]]},
    {node: [1, 6], members: [[0, 6], [2, 6], [0, 7], [1, 7]]},
    {node: [3, 8], members: [[3, 7], [4, 7], [2, 8], [2, 9]]},
    {node: [1, 9], members: [[0, 8], [0, 9], [0, 10], [1, 10], [2, 10]]},
    {node: [4, 9], members: [[3, 10], [4, 10], [3, 9]]},
    {node: [6, 9], members: [[7, 9], [6, 10], [7, 10]]},
    {node: [9, 9], members: [[10, 8], [10, 9], [8, 10], [9, 10], [10, 10]]},
]

/** plan2 Core 四环：3/3/4/4，全部距离 1。 */
export const plan2CoreBuckets: EnergyBucketPlan[] = [
    {node: [1, 1], members: [[1, 0], [0, 1], [2, 1]]},
    {node: [5, 1], members: [[5, 0], [4, 1], [5, 2]]},
    {node: [1, 5], members: [[1, 4], [0, 5], [2, 5], [1, 6]]},
    {node: [5, 5], members: [[5, 4], [4, 5], [6, 5], [5, 6]]},
]

/** plan2 每个 extension cluster 的四环模板：6/6/6/5，全部距离 1。 */
export const plan2ClusterBuckets: EnergyBucketPlan[] = [
    {node: [1, 1], members: [[0, 0], [1, 0], [0, 1], [2, 1], [1, 2], [2, 2]]},
    {node: [4, 1], members: [[4, 0], [5, 0], [3, 1], [5, 1], [3, 2], [4, 2]]},
    {node: [1, 4], members: [[1, 3], [2, 3], [0, 4], [2, 4], [0, 5], [1, 5]]},
    {node: [4, 4], members: [[3, 3], [3, 4], [5, 4], [4, 5], [5, 5]]},
]
