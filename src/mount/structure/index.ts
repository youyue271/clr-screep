import { assignPrototype } from "@/util/utils"
import ControllerExtension from './controller'
import SpawnExtension from './spawn'
import ExtensionExtension from './extension'
// import TowerExtension from './tower'
// import { LinkExtension, LinkConsole } from './link'
// import ExtractorExtension from './extractor'
// import RampartExtension from './rampart'
// import StorageExtension from './storage'
// import NukerExtension from './nuker'
// import { PowerSpawnExtension, PowerSpawnConsole } from './powerSpawn'
// import { ObserverExtension, ObserverConsole } from './observer'
// import { FactoryExtension, FactoryConsole } from './factory'
// import { TerminalExtension, TerminalConsole } from "./terminal"
// import LabExtension from "./lab"
// import StructureExtension from './structure'
const assignMap = [
    // [ Structure, StructureExtension ],
    [ StructureController, ControllerExtension ],
    [ StructureSpawn, SpawnExtension ],
    [StructureExtension, ExtensionExtension],
    // [ StructureTower, TowerExtension ],
    // [StructureExtractor, RampartExtension],
    // [ StructureLink, LinkExtension ],
    // [ StructureLink, LinkConsole ],
    // [ StructureFactory, FactoryExtension ],
    // [ StructureFactory, FactoryConsole ],
    // [ StructureTerminal, TerminalExtension ],
    // [ StructureTerminal, TerminalConsole ],
    // [ StructureExtractor, ExtractorExtension ],
    // [ StructureStorage, StorageExtension ],
    // [ StructureLab, LabExtension ],
    // [ StructureNuker, NukerExtension ],
    // [ StructurePowerSpawn, PowerSpawnExtension ],
    // [ StructurePowerSpawn, PowerSpawnConsole ],
    // [ StructureObserver, ObserverExtension ],
    // [ StructureObserver, ObserverConsole ]
]

export default () => {
    // 挂载所有拓展
    console.log("+ Mounting Structure extension")
    assignMap.forEach(protos => assignPrototype(protos[0], protos[1]))
}