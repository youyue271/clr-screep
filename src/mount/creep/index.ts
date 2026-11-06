import CreepExtension from "./extension"
import {assignPrototype} from "@/util/utils"

// 引擎 moveTo 默认允许跨最多 16 个房间寻路。当前房间是大片沼泽、隔壁房是平原时，
// 最便宜的路径会绕出房间再绕回来；而 Room.findPath 收尾时会在第一个房外格子处截断
// （_findPath2 里 pos.roomName != id 就 break），于是 moveTo 拿到空路径返回 ERR_NO_PATH，
// creep 原地不动。官服 W34S49 的 viewer 就是这样卡在 (49,3) 和隔壁房之间来回传的。
// 本 bot 的 moveTo 目标永远在当前房间内（跨房统一走 moveToRoom 的 exit 格），
// 所以同房间目标统一强制 maxRooms=1，只在当前房间内寻路。
const nativeMoveTo = Creep.prototype.moveTo as (this: Creep, ...args: any[]) => CreepMoveReturnCode

function moveToInRoom(this: Creep, firstArg: any, secondArg?: any, thirdArg?: any): CreepMoveReturnCode {
    let destRoom: string | undefined
    let opts: any
    // 三种调用形式：moveTo(x, y, opts) / moveTo(pos, opts) / moveTo(obj, opts)
    const isXY = typeof firstArg === 'number'
    if (isXY) {
        destRoom = this.room?.name
        opts = thirdArg
    } else if (firstArg instanceof RoomPosition) {
        destRoom = firstArg.roomName
        opts = secondArg
    } else if (firstArg && firstArg.pos) {
        destRoom = firstArg.pos.roomName
        opts = secondArg
    }
    if (destRoom && this.room && destRoom === this.room.name) {
        const merged = {...(opts ?? {}), maxRooms: 1}
        return isXY
            ? nativeMoveTo.call(this, firstArg, secondArg, merged)
            : nativeMoveTo.call(this, firstArg, merged)
    }
    // 跨房间目标原样透传（例如 harvestSource 回外矿房）
    return isXY
        ? nativeMoveTo.call(this, firstArg, secondArg, thirdArg)
        : nativeMoveTo.call(this, firstArg, secondArg)
}

export default () => {
    console.log("+ Mounting Creep extension")
    assignPrototype(Creep, CreepExtension)
    // assignPrototype 之后再覆盖，避免被 CreepExtension 上的同名方法盖掉
    Creep.prototype.moveTo = moveToInRoom as any
}
