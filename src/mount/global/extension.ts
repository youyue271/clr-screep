

export default {
    // /**
    //  * 全局刷新, 包括
    //  */
    // creepRecycle() {
    //     const currentTimestamp = Game.time;
    //     // 检查上次调用时间
    //     const lastRecycleTimestamp = global.lastRecycleTime
    //     if (currentTimestamp === lastRecycleTimestamp) {
    //         // 如果当前时间与上次调用时间相同，说明已经在本 tick 内调用过 recycle 函数，直接返回
    //         return;
    //     }
    //     for (let creepName in Memory.creeps) {
    //         if (!Game.creeps[creepName]) {
    //             const memory = Memory.creeps[creepName]
    //             const room = Game.rooms[memory.spawnRoom]
    //             room.memory.creepTask[memory.currentWorkType].push(memory.currentWork)
    //             room.addToSpawnList(memory.role)
    //             delete Memory.creeps[creepName]
    //         }
    //     }
    //     global.lastRecycleTime = currentTimestamp
    // }

}
