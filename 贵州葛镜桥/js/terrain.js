/**
 * terrain.js — 地面高度查询
 *
 * ⚠️⚠️ 本文件当前是**死模块**：全项目已无任何文件 import 它。
 *   2026-10-06 网页改为「天空 + 无人机航拍」形态时，人物漫游整体删除，
 *   连带本文件与 character.js 一起失去调用方（config.js 也已没有 roaming / spawn 节，
 *   所以下面注释里提到的 options.deckCorridor / metersPerUnit 现在都无人传入）。
 *   保留它只为「将来若恢复漫游」留个参考；改代码时请勿以为它还在生效。
 *   依据：贵州葛镜桥/.workbuddy/memory/MEMORY.md 的「网页形态变更（2026-10-06）」。
 *
 * 原始说明如下 ——
 *
 * 高斯泼溅没有网格表面，人物脚下无从附着。这里用 build_heightmap.py 预计算好的
 * 高度图（把点云投影到 XZ 平面做栅格化统计）来回答一个问题：
 *
 *     「站在 (x, z) 这个位置，脚底应该在多高？」
 *
 * 查询用双线性插值，保证人物走动时高度平滑过渡，不会一格一格地跳。
 */

export class Terrain {

    constructor() {
        this.ready = false;
        this.gridSize = 0;
        this.heights = null;      // Float32Array，NaN 表示该处没有可用地面
        this.bounds = null;
        this.stats = null;

        // 可行走性判据（由 load 的可选参数设置，单位为场景单位）
        this.maxStep = Infinity;  // 相邻格高差上限
        this.maxDrop = Infinity;  // 前方一步落差上限
        this.corridor = null;     // 桥面横向走廊 {ax0, ax1, u, n, halfWidth}
    }

    /**
     * @param {string} url 高度图地址
     * @param {object} [options] 可行走判据
     * @param {number} [options.maxStepMeters] 相邻格高差上限（米）
     * @param {number} [options.maxDropMeters] 前方落差上限（米）
     * @param {number} [options.metersPerUnit] 米/单位，用于把上面的米换成场景单位
     * @param {object} [options.deckCorridor] 桥面走廊配置
     */
    async load(url, options = {}) {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`高度图加载失败 HTTP ${res.status}：${url}`);
        }

        const data = await res.json();

        this.gridSize = data.gridSize;
        this.bounds = data.bounds;
        // JSON 里的 null 转成 NaN，方便后续用 isNaN 判断「无数据」
        this.heights = Float32Array.from(data.heights, (v) => (v === null ? NaN : v));

        this.cellWidth = (data.bounds.maxX - data.bounds.minX) / (this.gridSize - 1);
        this.cellDepth = (data.bounds.maxZ - data.bounds.minZ) / (this.gridSize - 1);

        this.stats = {
            source: data.source,
            minPointsPerCell: data.minPointsPerCell,
            percentile: data.percentile,
            yRange: data.yRange,
        };

        // 可行走判据：把米换算成场景单位
        const mpu = options.metersPerUnit || 1;
        if (options.maxStepMeters != null) this.maxStep = options.maxStepMeters / mpu;
        if (options.maxDropMeters != null) this.maxDrop = options.maxDropMeters / mpu;

        const dc = options.deckCorridor;
        if (dc && dc.enabled) {
            this._setupCorridor(dc);
        }

        this.ready = true;
        return this;
    }

    /**
     * 建立桥面横向走廊。
     *
     * 走廊用「桥轴 + 半宽」表示：角色一旦落在桥段范围内，
     * 横向偏移会被夹在 ±halfWidth 之内，从物理上阻止走出桥面。
     */
    _setupCorridor(cfg) {
        // 桥轴与 config.spawn.bridgeDeck 用的是同一套世界坐标
        const ax0 = { x: -0.1556, z: 0.1905 };
        const ax1 = { x: 0.1546, z: -0.1468 };

        const dx = ax1.x - ax0.x;
        const dz = ax1.z - ax0.z;
        const len = Math.hypot(dx, dz);

        this.corridor = {
            ax0,
            ux: dx / len,
            uz: dz / len,
            nx: -dz / len,           // 桥轴的水平法向
            nz: dx / len,
            length: len,
            halfWidth: (cfg.halfWidthMeters || 3.5) / (cfg.metersPerUnit || 115),
            // 前后各留一点余量，避免桥头处因浮点误差被判出界
            margin: 0.01,
        };
    }

    /* ================================================================ 查询 */

    /**
     * 查询 (x, z) 处的地面高度。
     * @returns {number|null} 地面高度；超出范围或该处无数据时返回 null
     */
    heightAt(x, z) {
        if (!this.ready) return null;

        const { minX, maxX, minZ, maxZ } = this.bounds;
        if (x < minX || x > maxX || z < minZ || z > maxZ) return null;

        // 换算到网格坐标（浮点，便于插值）
        const gxf = ((x - minX) / (maxX - minX)) * (this.gridSize - 1);
        const gzf = ((z - minZ) / (maxZ - minZ)) * (this.gridSize - 1);

        const x0 = Math.floor(gxf);
        const z0 = Math.floor(gzf);
        const x1 = Math.min(x0 + 1, this.gridSize - 1);
        const z1 = Math.min(z0 + 1, this.gridSize - 1);

        const tx = gxf - x0;
        const tz = gzf - z0;

        const h00 = this._at(x0, z0);
        const h10 = this._at(x1, z0);
        const h01 = this._at(x0, z1);
        const h11 = this._at(x1, z1);

        // 双线性插值；缺席的角按权重重新归一化，全部缺席则返回 null
        let sum = 0;
        let weight = 0;

        if (!Number.isNaN(h00)) { const w = (1 - tx) * (1 - tz); sum += h00 * w; weight += w; }
        if (!Number.isNaN(h10)) { const w = tx * (1 - tz); sum += h10 * w; weight += w; }
        if (!Number.isNaN(h01)) { const w = (1 - tx) * tz; sum += h01 * w; weight += w; }
        if (!Number.isNaN(h11)) { const w = tx * tz; sum += h11 * w; weight += w; }

        return weight > 0 ? sum / weight : null;
    }

    /**
     * 该位置是否踩得到地面。
     *
     * 注意：这**不是**完整的是否可通行判断。高度图是俯视投影做的，
     * 桥面正下方的河道格子里也有值（只是低很多），所以「有值」不等于「能站」。
     * 移动时要配 canStandAt() / stepAllowed() 一起用。
     */
    isWalkable(x, z) {
        return this.heightAt(x, z) !== null;
    }

    /* ======================================================= 桥面走廊约束 */

    /** 点是否落在桥段范围内 */
    inDeckSpan(x, z) {
        const c = this.corridor;
        if (!c) return false;
        const dx = x - c.ax0.x;
        const dz = z - c.ax0.z;
        const s = dx * c.ux + dz * c.uz;
        return s >= -c.margin && s <= c.length + c.margin;
    }

    /** 点到桥轴的横向有向偏移（正负表示在轴的哪一侧） */
    deckLateral(x, z) {
        const c = this.corridor;
        if (!c) return 0;
        return (x - c.ax0.x) * c.nx + (z - c.ax0.z) * c.nz;
    }

    /**
     * 把超出桥面走廊的位置夹回桥面。
     *
     * 这是解决「走着走着掉下桥」最直接的手段：只要角色在桥段内，
     * 横向位置就被限制在桥面宽度内，物理上走不出去。
     *
     * @returns {{x:number, z:number, clamped:boolean}}
     */
    clampToDeck(x, z) {
        const c = this.corridor;
        if (!c || !this.inDeckSpan(x, z)) return { x, z, clamped: false };

        const lat = this.deckLateral(x, z);
        if (Math.abs(lat) <= c.halfWidth) return { x, z, clamped: false };

        const excess = lat - Math.sign(lat) * c.halfWidth;
        return {
            x: x - excess * c.nx,
            z: z - excess * c.nz,
            clamped: true,
        };
    }

    /**
     * 从 (fromX, fromZ) 挪到 (toX, toZ) 是否允许。
     *
     * 判据（任一不满足即拒绝）：
     *   1) 目标处有地面
     *   2) 目标处坡度不能太陡
     *   3) 相对当前位置的**落差**不能太大（挡悬崖边缘）
     *   4) 若在桥段内，横向不能超出桥面走廊
     */
    stepAllowed(fromX, fromZ, toX, toZ) {
        const hTo = this.heightAt(toX, toZ);
        if (hTo === null) return false;

        // 桥段内横向夹紧（走廊外直接判定不可走）
        const c = this.corridor;
        if (c && this.inDeckSpan(toX, toZ) && Math.abs(this.deckLateral(toX, toZ)) > c.halfWidth) {
            return false;
        }

        const hFrom = this.heightAt(fromX, fromZ);
        if (hFrom !== null && Math.abs(hTo - hFrom) > this.maxDrop) return false;

        return this._slopeOk(toX, toZ);
    }

    /** 局部坡度是否可接受（用相邻格高差衡量） */
    _slopeOk(x, z) {
        if (!Number.isFinite(this.maxStep)) return true;

        const h = this.heightAt(x, z);
        if (h === null) return false;

        const d = Math.max(this.cellWidth, this.cellDepth);
        const probes = [
            [x + d, z], [x - d, z], [x, z + d], [x, z - d],
        ];

        let checked = 0;
        for (const [px, pz] of probes) {
            const hp = this.heightAt(px, pz);
            if (hp === null) continue;
            checked++;
            if (Math.abs(hp - h) > this.maxStep) return false;
        }

        // 四个方向都取不到值，保守起见认为不可走
        return checked > 0;
    }

    /**
     * 综合判断：这个位置能不能站（用于出生点等一次性判断）。
     * 比 isWalkable() 严格，会额外看坡度与落差。
     */
    canStandAt(x, z) {
        const h = this.heightAt(x, z);
        if (h === null) return false;

        const c = this.corridor;
        if (c && this.inDeckSpan(x, z) && Math.abs(this.deckLateral(x, z)) > c.halfWidth) {
            return false;
        }

        return this._slopeOk(x, z);
    }

    /** 表面法线（用高度差估算），供后续做「爬坡角度限制」等逻辑使用 */
    normalAt(x, z, sample = null) {
        const d = sample || Math.min(this.cellWidth, this.cellDepth);
        const hL = this.heightAt(x - d, z);
        const hR = this.heightAt(x + d, z);
        const hD = this.heightAt(x, z - d);
        const hU = this.heightAt(x, z + d);

        if ([hL, hR, hD, hU].some((v) => v === null)) return null;

        return { dx: (hR - hL) / (2 * d), dz: (hU - hD) / (2 * d) };
    }

    _at(ix, iz) {
        return this.heights[iz * this.gridSize + ix];
    }

    /* ============================================================== 辅助 */

    /**
     * 从参考点出发向外螺旋搜索，找到一个**踏实的**落脚点。
     *
     * 不能只判断「这一格有没有地面」—— 那样很容易生在最边缘，
     * 角色一登场就贴着可行走区域的边界，随便按一个方向都被挡住，
     * 用户第一反应会是「走不动 / 坏了」。所以这里给每个候选打一个
     * 「开阔度」分：周边一圈采样点里可走的比例。
     *
     * @param {number} preferX 期望位置 X
     * @param {number} preferZ 期望位置 Z
     * @param {number} maxRadiusCells 向外搜索的最大半径（格）
     * @param {number} minOpenness 开阔度达标线，达到即可停止搜索
     * @returns {{x:number, z:number, y:number, openness:number}|null}
     */
    findSpawnPoint(preferX, preferZ, maxRadiusCells = 48, minOpenness = 0.85) {
        if (!this.ready) return null;

        // 先看期望位置本身，够开阔就直接用（常见情况，省掉整轮搜索）
        const direct = this._openness(preferX, preferZ);
        if (direct !== null && direct >= minOpenness) {
            return { x: preferX, z: preferZ, y: this.heightAt(preferX, preferZ), openness: direct };
        }

        const { minX, minZ } = this.bounds;
        let best = null;

        for (let radius = 1; radius <= maxRadiusCells; radius++) {
            for (let ring = 0; ring < radius * 8; ring++) {
                const angle = (ring / (radius * 8)) * Math.PI * 2;
                const x = preferX + Math.cos(angle) * radius * this.cellWidth;
                const z = preferZ + Math.sin(angle) * radius * this.cellDepth;

                if (x < minX || z < minZ) continue;

                const score = this._openness(x, z);
                if (score === null) continue;

                if (!best || score > best.openness) {
                    best = { x, z, y: this.heightAt(x, z), openness: score };
                }

                // 一圈里已经找到足够开阔的位置，不必继续往外找
                if (score >= minOpenness) return best;
            }
        }

        return best;
    }

    /**
     * 「开阔度」：以 (x, z) 为中心，在一圈上取若干采样点，
     * 返回其中踩得到地面的比例。中心本身无地面时返回 null。
     */
    _openness(x, z, radiusScale = 4) {
        if (this.heightAt(x, z) === null) return null;

        const r = Math.min(this.cellWidth, this.cellDepth) * radiusScale;
        let walkable = 0;

        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            if (this.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) !== null) walkable++;
        }

        return walkable / 8;
    }

    /**
     * 从 (x, z) 沿某个水平方向望出去，能走多远。
     * @returns {number} 0~1，即若干采样距离中踩得到地面的占比
     */
    clearanceAlong(x, z, dx, dz, maxDistance = null, samples = 12) {
        if (!this.ready) return 0;

        const len = Math.hypot(dx, dz);
        if (len < 1e-9) return 0;
        dx /= len;
        dz /= len;

        const maxD = maxDistance
            || Math.min(this.bounds.maxX - this.bounds.minX,
                        this.bounds.maxZ - this.bounds.minZ) * 0.25;

        let ok = 0;
        for (let i = 1; i <= samples; i++) {
            const d = (i / samples) * maxD;
            if (this.heightAt(x + dx * d, z + dz * d) !== null) ok++;
        }
        return ok / samples;
    }

    get center() {
        if (!this.ready) return { x: 0, z: 0 };
        return {
            x: (this.bounds.minX + this.bounds.maxX) / 2,
            z: (this.bounds.minZ + this.bounds.maxZ) / 2,
        };
    }
}
