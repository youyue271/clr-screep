/**
 * war 模块 L1 采集到的事实。L1 只负责"哪个房、有没有视野、有没有敌人"，
 * 不做分类、不写情报、不动任务；分类和决策全部交给 L2。
 */
export type RemoteSignal =
    // 外矿采集/建造动作失去 WORK 部件：只可能是在外矿被打掉了
    | { kind: 'noWork' }
    // 外矿动作返回 ERR_NOT_OWNER：房间被其他玩家占领/reserve
    | { kind: 'occupied'; code: ScreepsReturnCode }
    // creep 提前死亡（没活到自然 TTL）：被敌人打死的信号
    | { kind: 'death' }
    // 预留：CARRY 部件被打光 / 掉血等信号，L2 以后可能需要
    | { kind: 'noCarry' }
    | { kind: 'damaged'; hitsLost: number }

export interface RemoteL1Report {
    /** creep 的主房 */
    homeRoom: string
    /** 这次任务绑定的外矿房 */
    targetRoom: string
    /**
     * 实际探查/观察的房间。creep 在主房时（例如在边界被打断后已经退回主房），
     * 这里会被替换成 targetRoom；在走廊房时就是走廊房本身。
     */
    observedRoom: string
    /** 信号发生时 creep 实际所在的房间（死亡信号用最后已知房间） */
    creepRoom: string
    signal: RemoteSignal
    /** observedRoom 是否有视野 */
    vision: boolean
    /** 只表示"有敌对单位/建筑"，具体类型和威胁等级由 L2 判断；无视野时 undefined */
    hasHostile?: boolean
    hostileCreepIds?: Id<Creep>[]
    hostileStructureIds?: Id<Structure>[]
    creepName: string
    tick: number
}
