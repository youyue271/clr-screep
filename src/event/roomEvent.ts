/**
 * 试了好几遍还是不知道怎么在tick内传函数,干脆传函数名,统一挂载在room下得了
 * @constructor
 */
import {totalCluster1} from "@/global/autoplan/autoplan";

function RoomLevel1Init() {

}

export function spawnWorker(room: Room): myEvent {
    return {
        triggerTime: Game.time,
        triggerFunc: 'addToSpawnList',
        param: []
    }
}

export function testEvent(room: Room): myEvent {
    return {
        triggerTime: Game.time + 1,
        triggerFunc: "hello",
        param: [room]
    }
}

export function showRoomPlanEvent(time: number, level: number): myEvent {
    return {
        triggerTime: time,
        triggerFunc: 'visualize',
        param: [level]
    }
}

export function checkRoomLevelEvent(time: number): myEvent {
    return {
        triggerTime: time,
        triggerFunc: 'checkRoomLevel',
        param: []
    }
}

// /**
//  * autoPlan有关event
//  */
//
// export function Visual(room: Room, gameTime:number): myEvent {
//     room.visualize()
//     Game.rooms[room].visualize(totalCluster1, x, y)
//     return {
//         triggerTime: gameTime,
//         triggerFunc: 'visualize',
//         param: [room]
//     }
// }
