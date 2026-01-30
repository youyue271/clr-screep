class logger {
    currentLevel: number
    levels = {
        "DEBUG": 1,
        "INFO": 2,
        "WARNING": 3,
        "ERROR": 4,
        "CONSOLE": 5
    };

    constructor() {
        this.currentLevel = this.levels["DEBUG"]; // 设置默认日志级别为 DEBUG
    }

    setLevel(level: string) {
        if (level in this.levels) {
            this.currentLevel = this.levels[level];
        } else {
            console.error(`Invalid log level: ${level}`);
        }
    }

    log(level: number, content: string, prefixes: string[] = [], color: Colors = null, notify: boolean = false) {

        if (level >= this.currentLevel) {
            // 有前缀就组装在一起
            let prefix = prefixes.length > 0 ? `${prefixes.join(' ')}` : ''
            // 指定了颜色
            prefix = colorful(prefix, color, true)
            content = colorful(content, color)

            const logContent = `${prefix}${content}`
            console.log(logContent)
            // 转发到邮箱
            if (notify) Game.notify(logContent)
        }
    }

    debug(message: string): void {
        this.log(this.levels['DEBUG'], message, ["DEBUG "], 'white');
    }

    info(message: string): void {
        this.log(this.levels['INFO'], message, ["+ "], 'blue');
    }

    warning(message: string): void {
        this.log(this.levels['WARNING'], message, [""], 'yellow');
    }

    error(message: string): void {
        this.log(this.levels['ERROR'], message, ["- "], "red");
    }
    console(message: string): void {
        this.log(this.levels['CONSOLE'], message, [""], "white");
    }
}

function colorful(content: string, colorName: Colors = null, bolder: boolean = false): string {
    const colorStyle = colorName ? `color: ${colors[colorName]};` : ''
    const bolderStyle = bolder ? 'font-weight: bolder;' : ''

    return `<text style="${[colorStyle, bolderStyle].join(' ')}">${content}</text>`
}

const colors: { [name in Colors]: string } = {
    red: '#ef9a9a',
    green: '#6b9955',
    yellow: '#c5c599',
    blue: '#8dc5e3',
    white: '#f7f9f7'
}

/**
 * 生成控制台链接
 * @param content 要显示的内容
 * @param url 要跳转到的 url
 * @param newTab 是否在新标签页打开
 */

export function createLink(content: string, url: string, newTab: boolean = true): string {
    return `<a href="${url}" target="${newTab ? '_blank' : '_self'}">${content}</a>`
}

/**
 * 给房间内添加跳转链接
 *
 * @param roomName 添加调整链接的房间名
 * @returns 打印在控制台上后可以点击跳转的房间名
 */
export function createRoomLink(roomName: string): string {
    return createLink(roomName, `https://screeps.com/a/#!/room/${Game.shard.name}/${roomName}`, false)
}

const loggerInstance = new logger()
export default loggerInstance