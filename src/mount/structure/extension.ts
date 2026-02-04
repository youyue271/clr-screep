import { getCarryList } from "@/task/roomTask";

export default class ControllerExtension extends StructureController {
    public onbuild(){
        this.room.registTask(getCarryList([this], RESOURCE_ENERGY))
    }
}