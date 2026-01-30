import {rootNodes} from './alias'
import extension from './extension'

// 挂载全局拓展
export default function () {
    console.log("+ Mounting Global extension")
    // 挂载有别名的操作
    rootNodes.map(item => {
        Object.defineProperty(global, item.alias, {get: item.exec })
    })
    // 挂载没有别名的操作
    _.assign(global, extension)
}