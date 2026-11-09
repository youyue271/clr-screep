export default class ExtensionExtension extends StructureExtension {
    public onBuild() {
        // 新 extension 的补能任务由 buildOver -> registerEnergyStructure 统一登记：
        // 布局内的走所属能量桶的 bucketCarryTask，布局外的才单目标补。
    }
}
