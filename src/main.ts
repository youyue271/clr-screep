import {errorMapper} from './modules/errorMapper'
import mount from './mount/mount'
import log from "@/util/log";
import {stateScanner} from "@/statistic/statistic";
import {totalCluster1} from "@/global/autoplan/autoplan";
import room from "@/mount/room";
import {testEvent} from "@/event/roomEvent";

export const loop = errorMapper(() => {
    mount()
    log.warning("+----------------------------" + Game.time + "------------------------------+")
    stateScanner()
    structureControl()
    // if (!(Game.time % 30)) {
    //     creepRecycle()
    // }
    creepControl()
    roomControl()
    generatePixel()
    for (const room in Game.rooms) {
        // getBiggestSquare(11, room)
        // visualize(totalCluster1, room, 15, 12, Game.time % 9)
        // Game.rooms[room].calDistance(9, 17)
        // Game.rooms[room].getBiggestSquare(11)
        // const [x, y] = Game.rooms[room].calPerfectBasePos()
        // // console.log(x, y)
        // Game.rooms[room].visualize(totalCluster1, x, y)
    }


})

function roomControl(){
    for(const room in Game.rooms){
        // Game.rooms[room].registEvent(testEvent(Game.rooms[room]))
        Game.rooms[room].runEvent()
        // Game.rooms[room].calSourceMap()
    }
}

function structureControl() {
    for (let structureId in Game.structures) {
        const structure: Structure = Game.getObjectById(structureId)
        if (typeof structure.work == "function") {
            structure.work()
        }
    }
}

function creepControl() {
    for (let creepName in Game.creeps) {
        const creep = Game.creeps[creepName]
        creep.work()
    }
}


/**
 * 生成 pixel
 */
function generatePixel(): void {
    if (Game.cpu.bucket == 10000) {
        Game.cpu.generatePixel();
    }
}