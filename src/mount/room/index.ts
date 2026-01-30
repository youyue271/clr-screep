import RoomExtension from "./extension"
import {assignPrototype} from "@/util/utils"

export default () => {
    console.log("+ Mounting Room extension")
    assignPrototype(Room, RoomExtension)

}

