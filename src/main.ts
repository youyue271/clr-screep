import {errorMapper} from './modules/errorMapper'
import mount from './mount/mount'
import log from "@/util/log";
import {stateScanner} from "@/statistic/statistic";
// import {totalCluster1} from "@/global/autoplan/autoplan";
import room from "@/mount/room";
import {testEvent} from "@/event/roomEvent";

export const loop = errorMapper(() => {
    mount()
    log.warning("+----------------------------" + Game.time + "------------------------------+")
    stateScanner()
    
    // if (!(Game.time % 30)) {
    //     creepRecycle()
    // }
    scanControl()
    structureControl()
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
        const currentRoom = Game.rooms[room]
        const isOwned = !!currentRoom.controller?.my
        if (!global.room[room] || (isOwned && !currentRoom.memory.creepTask)) {
            Game.rooms[room].init()
        }
        // Game.rooms[room].registEvent(testEvent(Game.rooms[room]))
        Game.rooms[room].runEvent()
        // Game.rooms[room].calSourceMap()
    }
}

/**
 * 先扫描房间环境，保证同 tick 内的塔读到的是最新缓存
 */
function scanControl() {
    for (const roomName in Game.rooms) {
        Game.rooms[roomName].scan()
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
    // if (!global.debug) {
    //     return
    // }
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
        const room = Game.rooms[roomName]
        if (!room) {
            continue
        }
        const energyList = room.memory.energyList
        if (energyList && energyList.length) {
            const sample = energyList.slice(0, 6).map(id => {
                const s = Game.getObjectById<StructureExtension | StructureSpawn>(id)
                if (!s) {
                    return "null"
                }
                const type = s.structureType
                const free = s.store?.getFreeCapacity(RESOURCE_ENERGY)
                return `${type}:${free}`
            }).join(",")
            lines.push(`energyList:${energyList.length}:${sample}`) 
        } 
        const timer = room.memory.timer
        if (timer) {
            const ticks = Object.keys(timer).map(Number).sort((a, b) => a - b)
            if (ticks.length) {
                const eventSamples: string[] = []
                let eventCount = 0
                for (const tick of ticks) {
                    const events = timer[tick]
                    if (!events || !events.length) {
                        continue
                    }
                    eventCount += events.length
                    if (eventSamples.length < 3) {
                        for (const item of events) {
                            if (!item) {
                                continue
                            }
                            const func = item[0] ?? "unknown"
                            eventSamples.push(`${func}@${tick}`)
                            if (eventSamples.length >= 3) {
                                break
                            }
                        }
                    }
                }
                if (eventCount) {
                    lines.push(`event:${eventCount}:${eventSamples.join(";")}`)
                }
            }
        }
        const spawnBuckets = room.normalizeTaskBuckets('spawnTask')
        if (spawnBuckets) {
            const roles: string[] = []
            const keys = Object.keys(spawnBuckets).map(Number).sort((a, b) => a - b)
            for (const key of keys) {
                const bucket = spawnBuckets[String(key)]
                if (!bucket || !bucket.length) {
                    continue
                }
                roles.push(...bucket.map(item => item?.taskParam?.[0]).filter(Boolean))
            }
            if (roles.length) {
                lines.push(`spawnTask:${roles.join(",")}`)
            }
        }
        const creepTask = room.memory.creepTask
        if (creepTask) {
            for (const taskType in creepTask) {
                const buckets = room.normalizeTaskBuckets(taskType as TaskType)
                let size = 0
                let detail = ""
                const sampleTasks: TaskEntity[] = []
                for (const key in buckets) {
                    const bucket = buckets[key]
                    if (!bucket || !bucket.length) {
                        continue
                    }
                    size += bucket.length
                    if (sampleTasks.length < 3) {
                        sampleTasks.push(...bucket.slice(0, 3 - sampleTasks.length))
                    }
                }
                if (size) {
                    const sample = sampleTasks.map(task => {
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
