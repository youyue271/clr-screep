export const spawnPercent = 0.6

export const spawnTable: { [role in Role]: number[] } = {
    //               0, 1, 2, 3, 4, 5, 6, 7, 8
    'harvester':    [0, 0, 0, 0, 0, 0, 0, 0, 0], // harvester 根据房间source数量动态调整
    'carrier':      [0, 1, 3, 5, 5, 5, 5, 5, 5],
    'worker':       [0, 11, 4, 9, 9, 7, 7, 7, 3],
    'emptyWorker':  [0, 0, 0, 0, 0, 0, 0, 0, 0], // emptyWorker不主动孵化
}

export const upgradeTaskCapacity = [0, 5, 5, 5, 5, 4, 4, 4, 1]
