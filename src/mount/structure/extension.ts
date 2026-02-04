export default class ExtensionExtension extends StructureExtension {
    public onBuild() {
        this.room.addExtensionCarryTasks([this.id])
    }
}
