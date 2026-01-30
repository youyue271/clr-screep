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
    "e5 r5 r5 e5 r5 e4 r4 e4 e3 r3 e3",
    "e5 e5 e5 r5 s7 n8 t5 r4 e2 r3 e2",
    "e6 e5 r5 e5 r5 e4 t7 t3 r2 e2 e2",
    "e6 r6 e6 e6 T6 r4 e4 r4 s1 r2 e2",
    "r6 e6 e6 p8 r6 S4 r4 e4 l6 l6 r2",
    "e6 r6 e6 r6 f7 r5 e4 l8 l6 r6 l7",
    "e7 e7 r6 e6 e6 L5 r6 l8 r6 l7 l7",
    "e7 r6 e7 r6 t8 t8 s8 r6 l8 l8 e8",
    "e7 r6 e7 e7 r6 t8 r6 e8 r6 r6 e8",
    "e7 e7 e7 e8 e8 r6 e8 e8 e8 e8 e8"
]

/**
 * 11*11 基地集群
 */

export const totalCluster1 = [
    "e5 e5 e5 e4 e4 r4 e4 e4 e3 e3 e3",
    "e5 r5 r5 t7 r4 e4 r4 e4 e3 r3 e2",
    "e5 e5 e5 r4 e4 e4 t5 r3 e3 r3 e2",
    "e6 e5 r5 e5 r4 n8 e4 e4 r3 t3 e2",
    "e6 r5 e6 e5 T6 r4 s7 r3 e2 r2 e2",
    "r5 e6 e6 L5 r5 S4 r4 s1 l8 l8 r2",
    "e6 r6 e6 r6 f7 r5 s8 l7 l7 r4 l8",
    "e6 t8 r6 e7 e7 p8 r5 l6 r4 l7 l8",
    "e6 r6 e7 r6 t8 e8 e8 r5 l6 l6 e8",
    "e6 r6 e7 e7 r6 e8 r6 t8 r6 r6 e8",
    "e7 e7 e7 e7 e7 r6 e8 e8 e8 e8 e8"
]

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

