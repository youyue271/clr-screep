import CreepExtension from "./extension"
import {assignPrototype} from "@/util/utils"
import {detectStructureBlock, getField} from "./field"
import {DIR_DX, DIR_DY, escapeDir, idx} from "./fieldCore"

// 引擎 moveTo 默认允许跨最多 16 个房间寻路。当前房间是大片沼泽、隔壁房是平原时，
// 最便宜的路径会绕出房间再绕回来；而 Room.findPath 收尾时会在第一个房外格子处截断
// （_findPath2 里 pos.roomName != id 就 break），于是 moveTo 拿到空路径返回 ERR_NO_PATH，
// creep 原地不动。官服 W34S49 的 viewer 就是这样卡在 (49,3) 和隔壁房之间来回传的。
// 本 bot 的 moveTo 目标永远在当前房间内（跨房统一走 moveToRoom 的 exit 格），
// 所以同房间目标统一强制 maxRooms=1，只在当前房间内寻路。
const nativeMoveTo = Creep.prototype.moveTo as (this: Creep, ...args: any[]) => CreepMoveReturnCode
const nativeMove = Creep.prototype.move as (this: Creep, ...args: any[]) => CreepMoveReturnCode

function nativeInRoom(this: Creep, isXY: boolean, firstArg: any, secondArg: any, thirdArg: any): CreepMoveReturnCode {
    if (isXY) {
        return nativeMoveTo.call(this, firstArg, secondArg, {...(thirdArg ?? {}), maxRooms: 1})
    }
    // moveTo(pos, opts) / moveTo(obj, opts)
    return nativeMoveTo.call(this, firstArg, {...(secondArg ?? {}), maxRooms: 1})
}

function isDynamicTarget(target: any): boolean {
    if (!target || typeof target !== 'object') {
        return false
    }
    if (target instanceof Creep) {
        return true
    }
    // @ts-ignore PowerCreep 在部分私服版本里可能不存在
    if (typeof PowerCreep !== 'undefined' && target instanceof PowerCreep) {
        return true
    }
    return false
}

/**
 * 沿距离场把 creep 到目标的整条路径追出来画成折线。
 * 改走距离场之后原生 moveTo 不再执行，visualizePathStyle 本来是空转的。
 * 纯装饰：global.visPath === false 时直接返回（默认开）。
 * 每房间每 tick 复用一个 RoomVisual，避免每只 creep 建一个。
 */
function drawFieldPath(creep: Creep, dirs: Uint8Array, style: any): void {
    const g = global as any
    if (g.visPath === false) {
        return
    }
    let x = creep.pos.x
    let y = creep.pos.y
    const points: { x: number, y: number }[] = [{x, y}]
    // 与场大小同阶的上限，防止 dirs 里出现自环时死循环
    for (let i = 0; i < 50; i++) {
        const d = dirs[idx(x, y)]
        if (!d) {
            break
        }
        x += DIR_DX[d]
        y += DIR_DY[d]
        points.push({x, y})
    }
    if (points.length < 2) {
        return
    }
    if (!g.__vis || g.__vis.tick !== Game.time) {
        g.__vis = {tick: Game.time, rooms: {}}
    }
    let vis = g.__vis.rooms[creep.room.name]
    if (!vis) {
        vis = g.__vis.rooms[creep.room.name] = new RoomVisual(creep.room.name)
    }
    // 官服是 polyline；私服引擎 4.2.20 只有 poly/line。装饰代码绝不能让主循环炸掉。
    try {
        const anyVis = vis as any
        if (typeof anyVis.polyline === 'function') {
            anyVis.polyline(points, style)
        } else if (typeof anyVis.poly === 'function') {
            anyVis.poly(points, style)
        } else {
            for (let i = 1; i < points.length; i++) {
                anyVis.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, style)
            }
        }
    } catch (e) {
        // 可视化失败不影响移动
    }
}

function moveToInRoom(this: Creep, firstArg: any, secondArg?: any, thirdArg?: any): CreepMoveReturnCode {
    const isXY = typeof firstArg === 'number'
    let destRoom: string | undefined
    let pos: RoomPosition | undefined
    let opts: any
    // 三种调用形式：moveTo(x, y, opts) / moveTo(pos, opts) / moveTo(obj, opts)
    if (isXY) {
        destRoom = this.pos.roomName
        pos = new RoomPosition(firstArg, secondArg, destRoom)
        opts = thirdArg
    } else if (firstArg instanceof RoomPosition) {
        destRoom = firstArg.roomName
        pos = firstArg
        opts = secondArg
    } else if (firstArg && firstArg.pos) {
        destRoom = firstArg.pos.roomName
        pos = firstArg.pos
        opts = secondArg
    }

    // 跨房间目标原样透传（例如 harvestSource 回外矿房）
    if (!pos || !destRoom || !this.room || destRoom !== this.room.name) {
        return isXY
            ? nativeMoveTo.call(this, firstArg, secondArg, thirdArg)
            : nativeMoveTo.call(this, firstArg, secondArg)
    }

    // 目标本身每 tick 都在动（creep）：点对点距离场没有意义，交回原生寻路
    if (isDynamicTarget(firstArg)) {
        return nativeInRoom.call(this, isXY, firstArg, secondArg, opts)
    }

    if (!this.my) {
        return ERR_NOT_OWNER
    }
    if (this.spawning) {
        return ERR_BUSY
    }
    if (opts && opts.noPathFinding) {
        return nativeInRoom.call(this, isXY, firstArg, secondArg, opts)
    }
    // 全局开关：出问题时可以一键退回原生寻路
    if ((global as any).ftDisable) {
        return nativeInRoom.call(this, isXY, firstArg, secondArg, opts)
    }

    const range = opts && typeof opts.range === 'number' ? opts.range : 0
    if (this.pos.x === pos.x && this.pos.y === pos.y) {
        return OK
    }
    if (range > 0 && this.pos.inRangeTo(pos, range)) {
        return OK
    }

    let field = getField(this.room, pos, range)
    if (!field) {
        return nativeInRoom.call(this, isXY, firstArg, secondArg, opts)
    }
    // 卡住 + 下一步被新建筑挡住：立即作废重建，不等签名刷新
    if (detectStructureBlock(this, field)) {
        field = getField(this.room, pos, range)
        if (!field) {
            return nativeInRoom.call(this, isXY, firstArg, secondArg, opts)
        }
    }

    const dir = field.dirs[idx(this.pos.x, this.pos.y)]
    if (dir && opts && opts.visualizePathStyle) {
        // 渲染用：沿场把整条路追出来，颜色沿用调用处的 visualizePathStyle
        drawFieldPath(this, field.dirs, opts.visualizePathStyle)
    }
    if (!dir) {
        if (this.pos.inRangeTo(pos, field.range)) {
            return OK
        }
        // 当前格不在场里（比如站在常驻位上）：先随便走到相邻的"在场格"
        const escape = escapeDir(field.dirs, this.pos.x, this.pos.y)
        if (escape) {
            return this.move(escape as DirectionConstant)
        }
        return nativeInRoom.call(this, isXY, firstArg, secondArg, opts)
    }

    return this.move(dir as DirectionConstant)
}

/**
 * MOVE 部件全部被打掉后，引擎对方向移动返回 ERR_NO_BODYPART(-12)：
 * 这种 creep 再也动不了，留着只会占任务名额，直接自毁并立刻补员。
 * moveTo / moveToRoom 的最终一步都是 this.move(dir)，随机漫步也是，所以只覆盖这里。
 * 注意：目标已经在范围内时 moveTo 会直接返回 OK，不会触发误杀。
 */
function moveWithBodyCheck(this: Creep, ...args: any[]): CreepMoveReturnCode {
    const res = nativeMove.apply(this, args)
    if (res === ERR_NO_BODYPART) {
        this.suicideAndRespawn()
    }
    return res
}

export default () => {
    console.log("+ Mounting Creep extension")
    assignPrototype(Creep, CreepExtension)
    // assignPrototype 之后再覆盖，避免被 CreepExtension 上的同名方法盖掉
    Creep.prototype.moveTo = moveToInRoom as any
    Creep.prototype.move = moveWithBodyCheck as any
}
