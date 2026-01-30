// /**
//  * spawn原型扩展
//  */
// import {calcBodyPart, remove} from "@/util/utils"
// import {spawnCreepErrorDescription} from "@/information"
// import room from "@/mount/room";
//
import {CalBodyCost} from "@/util/utils";
import log from "@/util/log";
import {spawnCreepErrorDescription} from "@/util/errorInformation";

export default class SpawnExtension extends Spawn {
    /**
     * spawn使用carrier的usingData来计算当前是否可以孵化
     * 将使用的extension和spawn暂存到一个列表中
     * 然后孵化,如果没有出错的话将对应的列表连接到dataPool后
     * 如果孵化出现问题,refresh carrierList,并将
     */
    public work(): void {
        // log.debug("spawn working")
        if (this.spawning) {
            // 孵化可视化
            const spawningCreep = Game.creeps[this.spawning.name]
            this.room.visual.text(
                '🛠️' + spawningCreep.memory.role,
                this.pos.x + 1,
                this.pos.y,
                {align: 'left', opacity: 0.8})
            return
        } else {
            // spawnList is empty
            if (!global.room[this.room.name].spawnList.length) {
                return
            } else {
                const data = global.room[this.room.name].spawnList[0]
                let energyNeeded = CalBodyCost(data.rolePart)
                this.room.visual.text(
                    '🛠️' + data.role,
                    this.pos.x + 1,
                    this.pos.y,
                    {align: 'left', opacity: 0.8, font: "20px"})
                this.room.visual.text(
                    "💸" + energyNeeded + "\n",
                    this.pos.x + 1,
                    this.pos.y + 1,
                    {align: 'left', opacity: 0.8, font: "20px"})
                this.room.visual.text(
                    "💰" + this.room.energyAvailable + "\n",
                    this.pos.x + 1,
                    this.pos.y + 2,
                    {align: 'left', opacity: 0.8, font: "20px"})
                if (this.room.energyAvailable < energyNeeded) {
                    return
                } else {
                    //TODO: 在自动规划以后，这里可以加上对应的精准控制消耗的逻辑
                    let creepName = data.role + Game.time
                    let res = this.spawnCreep(data.rolePart, creepName, {
                        memory: {
                            role: data.role,
                            spawnRoom: this.room.name,
                            working: false,
                            reSpawn: true
                        }
                    })
                    if (res == OK) {
                        /* 孵化成功 */
                        global.room[this.room.name].spawnList.shift()
                        this.room.initCarryList()
                        this.room.registEvent({
                            triggerTime: Game.time + 1,
                            triggerFunc: "calSpawningTime",
                            param: [this.id]
                        })
                    } else {
                        log.error("孵化失败,报错原因: " + spawnCreepErrorDescription[res])
                    }
                }
            }
            //TODO:孵化,注意计算spawnCreep,返回状态,如果状态不对需要refresh carrier, 同时要把所有的carry全部free掉
        }

    }

    /**
     * 在spawn修好的时候，如果是第一个spawn需要对spawn所在的room从新矿转化为主矿
     */
    public onBuild() {

    }
}