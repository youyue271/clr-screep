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
    //generatePixel()
    for (const room in Game.rooms) {
        // getBiggestSquare(11, room)
        // visualize(totalCluster1, room, 15, 12, Game.time % 9)
        // Game.rooms[room].calDistance(9, 17)
        // Game.rooms[room].getBiggestSquare(11)
        // const [x, y] = Game.rooms[room].calPerfectBasePos()
        // // console.log(x, y)
        // Game.rooms[room].visualize(totalCluster1, x, y)
    }
    debugDump()
})

function roomControl(){
    for(const room in Game.rooms){
        if (!global.room[room]) {
            Game.rooms[room].init()
        }
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

function debugDump() {
    if (!global.debug) {
        return
    }
    const lines: string[] = []
    lines.push(`DEBUG ${Game.time}`)
    if (!global.room) {
        log.debug(lines.join("\n"))
        return
    }
    for (const roomName in global.room) {
        const roomData = global.room[roomName]
        if (!roomData) {
            continue
        }
        lines.push(`room:${roomName}`)
        if (roomData.spawnList) {
            const roles = roomData.spawnList.map(item => item?.role).filter(Boolean).join(",")
            lines.push(`spawnList:${roles}`)
        }
        const creepTask = roomData.creepTask
        if (creepTask) {
            for (const taskType in creepTask) {
                const list = (creepTask[taskType as TaskType] || []) as TaskEntity[]
                const size = list.length || 0
                let detail = ""
                if (size) {
                    const sample = list.slice(0, 3).map(task => {
                        if (!task) {
                            return "null"
                        }
                        const reserved = task.reservedBy ? task.reservedBy.map(item => item.name).join(" | ") : ""
                        const capacity = task.capacity ?? 1
                        return `${task.taskFunc}@cap${capacity}@res[${reserved}]`
                    }).join(";")
                    detail = `:${sample}`
                }
                lines.push(`task:${taskType} = ${size}${detail}`)
            }
        }
    }
    log.debug(lines.join("\n"))
}
