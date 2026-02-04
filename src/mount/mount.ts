import mountCreep from './creep'
import mountRoom from './room'
import mountStructure from './structure'
import mountGlobal from './global'
import mountVisual from '@/global/autoplan/roomVisual'
export default function():void {
    // console.log(global.hasExtension)
    if(!global.hasExtension){
        console.log("[mount] 重新挂载")
        mountCreep()
        mountStructure()
        mountRoom()
        mountGlobal()
        mountVisual()
        globalInit()
        global.hasExtension = true
    }
}

export function globalInit(){
    global.room = {}
    delete Memory.rooms
    for(const roomName in Game.rooms){        
        Game.rooms[roomName].init()
    }
}
