import CreepExtension from "./extension"
import {assignPrototype} from "@/util/utils"

export default () => {
    console.log("+ Mounting Creep extension")
    assignPrototype(Creep, CreepExtension)
}