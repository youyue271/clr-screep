/**
 * 纯逻辑的距离场构建，不碰任何 game 全局，方便单独测试。
 *
 * 约定：
 * - 网格 50x50，索引 = y * 50 + x。
 * - cost[i] 是"进入 i 格"的代价（和引擎疲劳权重一致：路 1 / 平地 2 / 沼泽 10），
 *   255 表示不可通行。
 * - 返回 Uint8Array(2500)，dirs[i] 表示站在 i 格时朝哪走（方向 1-8），
 *   0 表示"没有方向"（到达目标 / 不可达 / 不在场里）。
 */

export const FT_SIZE = 2500
export const FT_WALL = 255
export const FT_INF = 0x7fffffff

// 方向 1-8 的坐标增量
export const DIR_DX = [0, 0, 1, 1, 1, 0, -1, -1, -1]
export const DIR_DY = [0, -1, -1, 0, 1, 1, 1, 0, -1]
// 反方向
export const OPPOSITE = [0, 5, 6, 7, 8, 1, 2, 3, 4]

export function idx(x: number, y: number): number {
    return y * 50 + x
}

export function xOf(i: number): number {
    return i % 50
}

export function yOf(i: number): number {
    return (i / 50) | 0
}

/**
 * 多源 Dijkstra：从 seeds 出发铺满整个房间，给每个可达格记录"朝种子走的下一步"。
 *
 * @param cost   每个格子的进入代价，255 = 不可走
 * @param seeds  种子格索引（距离 0），通常就是目标格或目标周围 range 内的格子
 * @param blocked 额外的封禁格（255 视作不可走），用于排除常驻站位；种子不受影响
 */
export function buildField(cost: Uint8Array, seeds: number[], blocked?: Uint8Array | null): Uint8Array {
    const dirs = new Uint8Array(FT_SIZE)
    const dist = new Int32Array(FT_SIZE)
    for (let i = 0; i < FT_SIZE; i++) {
        dist[i] = FT_INF
    }

    // 二叉堆（懒删除：同一格可能被多次入堆，弹出时比对 dist）
    const heapIdx: number[] = []
    const heapDist: number[] = []

    const push = (i: number, d: number) => {
        let k = heapIdx.length
        heapIdx.push(i)
        heapDist.push(d)
        while (k > 0) {
            const p = (k - 1) >> 1
            if (heapDist[p] <= d) {
                break
            }
            heapIdx[k] = heapIdx[p]
            heapDist[k] = heapDist[p]
            k = p
        }
        heapIdx[k] = i
        heapDist[k] = d
    }

    const pop = (): number => {
        const top = heapIdx[0]
        const lastI = heapIdx.pop() as number
        const lastD = heapDist.pop() as number
        if (heapIdx.length > 0) {
            let k = 0
            const n = heapIdx.length
            while (true) {
                let c = 2 * k + 1
                if (c >= n) {
                    break
                }
                if (c + 1 < n && heapDist[c + 1] < heapDist[c]) {
                    c++
                }
                if (heapDist[c] >= lastD) {
                    break
                }
                heapIdx[k] = heapIdx[c]
                heapDist[k] = heapDist[c]
                k = c
            }
            heapIdx[k] = lastI
            heapDist[k] = lastD
        }
        return top
    }

    for (const s of seeds) {
        if (s < 0 || s >= FT_SIZE) {
            continue
        }
        if (dist[s] !== 0) {
            dist[s] = 0
            push(s, 0)
        }
    }

    while (heapIdx.length > 0) {
        const i = pop()
        const d = dist[i]
        const x = xOf(i)
        const y = yOf(i)
        for (let dir = 1; dir <= 8; dir++) {
            const nx = x + DIR_DX[dir]
            const ny = y + DIR_DY[dir]
            if (nx < 0 || nx > 49 || ny < 0 || ny > 49) {
                continue
            }
            const ni = ny * 50 + nx
            const c = cost[ni]
            if (c >= FT_WALL) {
                continue
            }
            if (blocked && blocked[ni]) {
                continue
            }
            const nd = d + c
            if (nd < dist[ni]) {
                dist[ni] = nd
                // 从 ni 走到 i 的方向 = 当前方向的反方向
                dirs[ni] = OPPOSITE[dir]
                push(ni, nd)
            }
        }
    }

    return dirs
}

/**
 * 当前格不在场里（dirs 为 0，例如站在常驻位上）时，找一个相邻的"在场格"走进去。
 * 返回方向，找不到返回 0。
 */
export function escapeDir(dirs: Uint8Array, x: number, y: number): number {
    for (let dir = 1; dir <= 8; dir++) {
        const nx = x + DIR_DX[dir]
        const ny = y + DIR_DY[dir]
        if (nx < 0 || nx > 49 || ny < 0 || ny > 49) {
            continue
        }
        if (dirs[ny * 50 + nx]) {
            return dir
        }
    }
    return 0
}

/**
 * 目标周围 range 内所有可走格（切比雪夫距离），作为多源种子。
 * range = 0 时只有目标格本身（前提是它可走；调用方会先把不可走目标改成 range 1）。
 */
export function seedTiles(cx: number, cy: number, range: number, cost: Uint8Array): number[] {
    const out: number[] = []
    for (let dy = -range; dy <= range; dy++) {
        for (let dx = -range; dx <= range; dx++) {
            const x = cx + dx
            const y = cy + dy
            if (x < 0 || x > 49 || y < 0 || y > 49) {
                continue
            }
            const i = y * 50 + x
            if (cost[i] >= FT_WALL) {
                continue
            }
            out.push(i)
        }
    }
    return out
}

/** 该格是否属于目标 (cx,cy,range) 的种子圈（且可走） */
export function isSeedTile(x: number, y: number, cx: number, cy: number, range: number, cost: Uint8Array): boolean {
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > range) {
        return false
    }
    return cost[y * 50 + x] < FT_WALL
}

/**
 * 场的路径是否会"穿过" t 格：t 的某个邻居的下一步正好指向 t。
 * 用于判断新封禁一格后，已经缓存的场是否需要作废。
 */
export function fieldUsesTile(dirs: Uint8Array, t: number): boolean {
    const x = xOf(t)
    const y = yOf(t)
    for (let dir = 1; dir <= 8; dir++) {
        const px = x - DIR_DX[dir]
        const py = y - DIR_DY[dir]
        if (px < 0 || px > 49 || py < 0 || py > 49) {
            continue
        }
        if (dirs[py * 50 + px] === dir) {
            return true
        }
    }
    return false
}

/**
 * 新增封禁 t 后这张场是否需要重建：
 * - t 在 range>0 的种子圈里 → 需要（否则还会往 t 上走）
 * - t 是 range=0 的目标本身 → 不需要（getField 对目标格会解除封禁）
 * - 场里有路穿过 t → 需要
 */
export function fieldAffectedByBlock(dirs: Uint8Array, cost: Uint8Array, t: number, cx: number, cy: number, range: number): boolean {
    if (range === 0 && t === cy * 50 + cx) {
        return false
    }
    if (isSeedTile(xOf(t), yOf(t), cx, cy, range, cost)) {
        return true
    }
    return fieldUsesTile(dirs, t)
}

/**
 * 解除封禁 t 后这张场是否需要重建：
 * 只有当 t 的某个可走邻居在旧场里是"不可达"（dirs 为 0 且不是种子）时才需要，
 * 说明那块区域曾被 t 切断；否则旧场依然合法（最多绕远一点），保留。
 */
export function fieldCutByTile(dirs: Uint8Array, cost: Uint8Array, t: number, cx: number, cy: number, range: number): boolean {
    const x = xOf(t)
    const y = yOf(t)
    for (let dir = 1; dir <= 8; dir++) {
        const px = x + DIR_DX[dir]
        const py = y + DIR_DY[dir]
        if (px < 0 || px > 49 || py < 0 || py > 49) {
            continue
        }
        const p = py * 50 + px
        if (cost[p] >= FT_WALL || isSeedTile(px, py, cx, cy, range, cost)) {
            continue
        }
        if (dirs[p] === 0) {
            return true
        }
    }
    return false
}
