import log from "@/util/log"

export const rootNodes: myNode[] = [
    /**
     *  Console: 启动控制台模式
     *  控制台模式下:
     *      Global: 全局选项
     *      Rooms: 房间选项
     *      Quit: 退出Console模式
     */
    {
        alias: "Console",
        exec: function (): string {
            log.setLevel("CONSOLE")
            global.nodeList = [rootNodes]
            global.cmdList = ["Console"]
            LoadFunction(ConsoleNodes)
            const menu = "控制台模式\n" +
                "> Global\t\t\t全局选项\n" +
                "> Rooms\t\t\t\t房间选项\n" +
                "> help\t\t\t\t查看函数帮助\n" +
                "> quit\t\t\t\t退出控制台\n"
            global.currentMenu = menu
            return menu
        },
        help: "Console: 启动控制台模式\n" +
            "控制台模式下:\n" +
            "\tGlobal: 全局选项\n" +
            "\tRooms: 房间选项\n" +
            "\tQuit: 退出Console模式\n"
    },
    {
        alias: "help",
        exec: function (): string {
            return global.helpText
        },
        help: ""
    }
]

const quit: myNode = {
    alias: "quit",
    exec: function (): string {
        log.setLevel("DEBUG")
        delete global.currentRoom
        delete global.nodeList
        UnloadFunction()
        return "退出控制台模式"
    },
    help: "quit\n" +
        "\t退出控制台\n" +
        "\t这里做了一些处理, 将全局log等级重置为DEBUG模式\n"
}

const back: myNode = {
    alias: "back",
    exec: function (): string {
        global.nodeList.pop()
        global.nodeList.pop()
        global.cmdList.pop()
        const nodes = global.nodeList[global.nodeList.length - 1]
        const alias = global.cmdList.pop()
        return nodes.find(node => {
            if (node.alias == alias)
                return node
        }).exec()
    },
    help: "back\n" +
        "\t返回上一级菜单\n"
}

const ConsoleNodes: myNode[] = [
    /**
     *  Global子选项
     *  Restart: 全局重启
     */
    {
        alias: "Global",
        exec: function (): string {
            const menu = "全局选项:\n" +
                "> init\t\t\t\t全局初始化\n" +
                "> log\t\t\t\t全局日志记录\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n"
            NextMenu("Global", menu, GlobalNodes)
            return menu
        },
        help: "Global\n" +
            "\t用于加载全局选项,包括全局初始化等操作\n"
    },
    {
        alias: "Rooms",
        exec: function (): string {
            const menu = "全局选项:\n" +
                "> chooseRoom\t\t\t选择房间\n" +
                "> autoPlan\t\t\t自动规划\n" +
                "> memoryInfo\t\t\t打印内存信息\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n"
            NextMenu("Rooms", menu, RoomNodes)
            return menu
        },
        help: "Global\n" +
            "\t用于加载全局选项,包括全局初始化等操作\n"
    },
    /**
     *  退出控制台
     *  退出控制台模式并进行必要的清理和设置:
     *  设置ConsoleMod为log模式
     *  清理ChosenRoom变量
     */
    quit
]

const GlobalNodes: myNode[] = [
    {
        alias: "init",
        exec: function () {
            console.log("清理全局room缓存")
            global.room = {}
            for (const room in Game.rooms) {
                Game.rooms[room].init()
            }
            return "全局初始化执行完毕\n" + global.currentMenu
        },
        help: "init\n" +
            "\t这个函数还没有写\n"
    },
    {
        alias: "log",
        exec: function () {
            const menu = "日志模式\n" +
                "> debug\t\t\t\tdebug模式\n" +
                "> info\t\t\t\tinfo模式\n" +
                "> warning\t\t\twarning模式\n" +
                "> error\t\t\t\terror模式\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n"
            NextMenu("log", menu, logNodes)
            return menu
        },
        help: "log\n" +
            "\t修改全局日志等级\n"
    },
    back,
    quit
]

const logNodes: myNode[] = [
    {
        alias: "debug",
        exec: function () {
            global.logLevel = "DEBUG"
            return "全局log等级调整至DEBUG等级\n" + global.currentMenu
        },
        help: "debug\n" +
            "\t将全局log等级调整至DEBUG等级, 在退出控制台时生效\n"
    },
    {
        alias: "info",
        exec: function () {
            global.logLevel = "INFO"
            return "全局log等级调整至INFO等级\n" + global.currentMenu
        },
        help: "info\n" +
            "\t将全局log等级调整至INFO等级, 在退出控制台时生效\n"
    },
    {
        alias: "warning",
        exec: function () {
            global.logLevel = "WARNING"
            return "全局log等级调整至WARNING等级\n" + global.currentMenu
        },
        help: "warning\n" +
            "\t将全局log等级调整至WARNING等级, 在退出控制台时生效\n"
    },
    {
        alias: "error",
        exec: function () {
            global.logLevel = "ERROR"
            return "全局log等级调整至ERROR等级\n" + global.currentMenu
        },
        help: "error\n" +
            "\t将全局log等级调整至ERROR等级, 在退出控制台时生效\n"
    },
    back,
    quit
]

const RoomNodes: myNode[] = [
    {
        alias: "chooseRoom",
        exec: function () {
            let menu = "选择房间:\n"
            let i = 0;
            let ChooseRoomNodes: myNode[] = []
            for (const roomName in Game.rooms) {
                const room = Game.rooms[roomName];
                menu += `> r${i} ${room} Level${room.find<StructureController>(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_CONTROLLER}})[0].level}\n`
                ChooseRoomNodes.push({
                    alias: `r${i}`,
                    exec: function () {
                        global.currentRoom = room
                        return `${roomName} is chosen\n` + back.exec()
                    },
                    help: getRoomInfo(room)
                })
            }
            menu += "> back\t\t\t\t返回上一级菜单\n"
            ChooseRoomNodes.push(back)
            NextMenu("chooseRoom", menu, ChooseRoomNodes)
            return menu
        },
        help: "chooseRoom\n" +
            "\t选择目前已经拥有的房间\n"
    },
    {
        alias: "autoPlan",
        exec: function (): string {
            if (!global.currentRoom) {
                return "> 请先指定房间\n"
            }
            const menu = "自动规划选项:\n" +
                "> RoomPlan\t\t\t\t简单测试\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n"
            NextMenu("autoPlan", menu, autoPlanNodes)
            return menu
        },
        help: "autoPlan\n" +
            "\t写的一个简单的自动规划\n"
    },
    {
        alias: "memoryInfo",
        exec: function (): string {
            if (!global.currentRoom) {
                return "> 请先指定房间\n"
            }
            let txt = ""
            txt += "> spawnTask:\n\t"
            const spawnBuckets = global.currentRoom.normalizeTaskBuckets('spawnTask')
            if (spawnBuckets) {
                const keys = Object.keys(spawnBuckets).map(Number).sort((a, b) => a - b)
                for (const key of keys) {
                    const bucket = spawnBuckets[String(key)]
                    if (!bucket || !bucket.length) {
                        continue
                    }
                    bucket.forEach((item) => {
                        txt += item?.taskParam?.[0] + " "
                    })
                }
            }
            txt += "\n\n"
            txt += "> creepTask:\n"
            const TaskType = ['workTask'
                , 'harvestTask'
                , 'carryTask'
                , 'bucketCarryTask'
                , 'upgradeTask'
                , "constructTask"
                , 'energyTask'
                , 'spawnTask']
            for (const type of TaskType) {
                const buckets = global.currentRoom.normalizeTaskBuckets(type as TaskType)
                let size = 0
                if (buckets) {
                    for (const key in buckets) {
                        size += buckets[key]?.length || 0
                    }
                }
                txt += "\t"+ type + ": " + size + "\n"
                // global.room[global.currentRoom.name].creepTask[type].forEach((item: TaskEntity) => {
                //     txt += item.taskParam
                // })
            }
            return txt + "\n" + global.currentMenu
        },
        help: "memoryInfo\n" +
            "\t房间中挂载在memory上的信息\n"
    },
    back,
    quit
]


const autoPlanNodes: myNode[] = [
    {
        alias: "RoomPlan",
        exec: function () {
            const room = global.currentRoom
            if (!room.memory.plan1Pos) {
                room.calPerfectBasePos()
            }
            room.showRoomPlan()
            return "OK"
        },
        help: "init\n" +
            "\t这个函数还没有写\n"
    },
    back,
    quit
]


function getRoomInfo(room = global.currentRoom): string {
    return ``
}


function NextMenu(alias: string, menu: string, node: myNode[]) {
    UnloadFunction()
    global.cmdList.push(alias)
    LoadFunction(node)
    global.currentMenu = "\n" + menu
}

function LoadFunction(NodeList: myNode[]) {
    global.nodeList.push(NodeList)
    global.aliasList = []
    global.helpText = ""
    NodeList.forEach(node => {
        global.aliasList.push(node.alias)
        global.helpText += node.help
        Object.defineProperty(global, node.alias, {configurable: true, get: node.exec})
    })
}

function UnloadFunction() {
    global.aliasList.forEach(alias => {
        delete global[alias];
    })
    delete global.helpText
    delete global.aliasList
}
