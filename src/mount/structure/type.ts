interface Structure {
    work():void
    onBuild?():void
}
interface SpawnData{
    role: Role
    rolePart: BodyPartConstant[]
}