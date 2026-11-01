import RoomExtension from "./extension"
import RoomScanExtension from "./scan"
import {assignPrototype} from "@/util/utils"

export default () => {
    console.log("+ Mounting Room extension")
    assignPrototype(Room, RoomExtension)
    assignPrototype(Room, RoomScanExtension)
}

