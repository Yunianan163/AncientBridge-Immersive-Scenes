# -*- coding: utf-8 -*-
"""
build_heightmap.py — 从 3DGS 的 PLY 生成地面高度图

为什么需要它
    高斯泼溅是一堆各自独立的椭球，没有网格表面，人物走上去时无法做常规的
    物理碰撞。可行的做法是把点云投影到 XZ 平面划分成规则网格，统计每个格子里
    高斯高度的一个稳健分位数，得到一张高度图。网页端用双线性插值就能查询任意
    位置的地面高度。

为什么用分位数而不是最小值或平均值
    场景里有大量飘散的飞点（floaters），取最小值会被坑洞拉低；取平均值会被
    植被冠层抬高。中位数附近的值最接近「人站在上面会觉得踏实」的那层表面。
    同时输出多个分位数，方便网页端对比选择。

坐标系修正
    scene.ply 是上下颠倒的（竖直轴指向 -Y，推导见 web/js/config.js 的注释），
    网页端会绕 X 轴转 180° 把它摆正。高度图必须活在同一套世界坐标系里，
    所以这里用 --rot 施加同一个旋转后再做栅格化，否则人物会踩到「镜像的地面」。

用法:
    python build_heightmap.py <scene.ply> <out.json> [grid_size] [min_points] [--rot=180,0,0]
"""

import json
import os
import sys
import warnings

import numpy as np

# 邻域填充时难免出现「一整圈都没有有效格子」，nanmedian 会刷警告，这里静音
warnings.filterwarnings("ignore", category=RuntimeWarning)

HEADER_SCAN_BYTES = 16384


def euler_xyz_matrix(deg):
    """
    与 three.js 的 Euler(order='XYZ') 完全一致的旋转矩阵。

    顺序对不上会导致模型和地形差 90°，所以这里照抄 three.js
    Matrix4.makeRotationFromEuler 的 XYZ 分支，不做「差不多」的实现。
    """
    x, y, z = np.radians(deg)
    a, b = np.cos(x), np.sin(x)
    c, d = np.cos(y), np.sin(y)
    e, f = np.cos(z), np.sin(z)
    ae, af, be, bf = a * e, a * f, b * e, b * f

    return np.array([
        [c * e,      -c * f,      d],
        [af + be * d, ae - bf * d, -b * c],
        [bf - ae * d, be + af * d, a * c],
    ])


def read_header(path):
    with open(path, "rb") as f:
        raw = f.read(HEADER_SCAN_BYTES)
    idx = raw.find(b"end_header")
    if idx == -1:
        raise ValueError("不是合法的 PLY 文件：找不到 end_header")
    end = raw.find(b"\n", idx)
    header = raw[:end + 1].decode("ascii", "replace")
    return header, end + 1


def parse_header(header):
    fmt, count, props = None, 0, []
    for line in header.splitlines():
        line = line.strip()
        if line.startswith("format "):
            fmt = line.split()[1]
        elif line.startswith("element vertex"):
            count = int(line.split()[-1])
        elif line.startswith("property") and "list" not in line:
            props.append(line.split()[-1])
    return fmt, count, props


def load_positions(path):
    """用 numpy 一次性把 xyz 读出来（只读需要的三列，避免解析全部 23 个属性）"""
    header, header_bytes = read_header(path)
    fmt, count, props = parse_header(header)
    if fmt != "binary_little_endian":
        raise ValueError("仅支持 binary_little_endian 格式，实际为: %s" % fmt)

    stride = len(props) * 4
    ix, iy, iz = props.index("x"), props.index("y"), props.index("z")

    raw = np.fromfile(path, dtype=np.uint8, count=count * stride, offset=header_bytes)
    raw = raw.reshape(count, stride)

    def column(index):
        # 每个 float 占 4 字节，取出对应切片再按 float32 重新解释
        piece = np.ascontiguousarray(raw[:, index * 4: index * 4 + 4])
        return piece.view(np.float32).reshape(count)

    return column(ix), column(iy), column(iz), props


def fill_gaps(hmap, valid, grid, passes=3):
    """
    稀疏格子（点数太少）的高度不可信，先标记为无效，再用周围有效格子的
    中值逐圈向内填充。这样人物走到场景边缘或植被缝隙时，脚下不会突然塌陷。
    """
    h = hmap.copy()
    v = valid.copy()

    for _ in range(passes):
        src = np.where(v, h, np.nan)
        pad = np.pad(src, 1, constant_values=np.nan)
        neighbours = np.stack([
            pad[0:-2, 0:-2], pad[0:-2, 1:-1], pad[0:-2, 2:],
            pad[1:-1, 0:-2],                  pad[1:-1, 2:],
            pad[2:, 0:-2],   pad[2:, 1:-1],   pad[2:, 2:],
        ])
        with np.errstate(all="ignore"):
            candidate = np.nanmedian(neighbours, axis=0)

        newly = (~v) & np.isfinite(candidate)
        h[newly] = candidate[newly]
        v = v | newly
        if not newly.any():
            break

    return h, v


def render_preview(heights, valid, grid, path):
    """把高度图渲染成灰度 PNG，便于肉眼检查地形是否连续合理"""
    try:
        from PIL import Image
    except ImportError:
        print("  （未安装 Pillow，跳过预览图）")
        return

    canvas = np.zeros((grid, grid, 3), dtype=np.uint8)

    if valid.any():
        lo, hi = heights[valid].min(), heights[valid].max()
        span = max(hi - lo, 1e-9)
        # 先把无效格子替换成最低值，避免 NaN 参与运算
        safe = np.where(valid, heights, lo)
        norm = np.clip((safe - lo) / span, 0, 1)
        gray = (norm * 235 + 20).astype(np.uint8)
        canvas[..., 0] = np.where(valid, gray, 0)
        canvas[..., 1] = np.where(valid, gray, 0)
        canvas[..., 2] = np.where(valid, gray, 0)
        # 无效区域标红，一眼能看出覆盖缺口
        canvas[~valid] = (120, 0, 0)

    # 图像坐标 y 向下，而我们的网格 z 向上，翻转一下才和场景方向一致
    Image.fromarray(canvas[::-1]).resize((grid * 2, grid * 2), Image.NEAREST).save(path)
    print("  预览图: %s" % path)


def parse_rot(argv):
    """从命令行里取出 --rot=x,y,z（度，XYZ 欧拉序），默认不旋转。"""
    for a in argv:
        if a.startswith("--rot="):
            parts = a.split("=", 1)[1].split(",")
            if len(parts) == 3:
                return [float(v) for v in parts]
    return [0.0, 0.0, 0.0]


def parse_percentile(argv):
    """取 --percentile=N（默认 80）。

    为什么默认是 80 而不是 50（中位数）
        俯视投影会把**同一 XY 位置、不同高度**的点压进同一格。桥面这一格
        同时含有「真实桥面」和它下方几十米处的「河床 / 崖壁 / 远景」。
        实测：葛镜桥跨中横截面 8.5 m × 1.7 m 范围内 6.2 万个点，高度从
        -57 m 连续分布到 -1 m —— 其中只有顶部约 25% 是真实桥面，
        而且这簇点的高度极差仅 1.5 m（非常集中）。

        取中位数会被下方的河床把桥面高度压低约 4 m，人就会「陷入地面」；
        取 p80 刚好落进桥面那一簇，不会碰到下面的河床。

        注意：这是**结构性偏差**，不是噪声，所以提高网格分辨率解决不了
        （实测细层 512² 反而更糟，因为每格点数变少、分位数更不稳）。
    """
    for a in argv:
        if a.startswith("--percentile="):
            return float(a.split("=", 1)[1])
    return 80.0


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    src = sys.argv[1]
    dst = sys.argv[2]
    grid = int(sys.argv[3]) if len(sys.argv) > 3 else 256
    min_points = int(sys.argv[4]) if len(sys.argv) > 4 else 8
    rot_deg = parse_rot(sys.argv)
    percentile = parse_percentile(sys.argv)

    print("读取点云…")
    x, y, z, props = load_positions(src)
    n = len(x)
    print("  顶点数: {:,}".format(n))

    # 施加与网页端一致的朝向修正，把资产坐标系换算到世界坐标系
    if any(abs(v) > 1e-9 for v in rot_deg):
        m = euler_xyz_matrix(rot_deg)
        pts = np.stack([x, y, z], axis=0)
        pts = m @ pts
        x, y, z = pts[0], pts[1], pts[2]
        print("  已施加朝向修正 rot=%s 度（与网页端 config.js 保持一致）"
              % ",".join("%g" % v for v in rot_deg))
    else:
        print("  未施加朝向修正（rot=0,0,0）")

    # 用分位数确定边界，避免被极少数飞点撑大整张图
    x_lo, x_hi = np.percentile(x, [0.5, 99.5])
    z_lo, z_hi = np.percentile(z, [0.5, 99.5])
    y_lo, y_hi = np.percentile(y, [0.5, 99.5])
    print("  X 范围: %.3f ~ %.3f" % (x_lo, x_hi))
    print("  Y 范围: %.3f ~ %.3f" % (y_lo, y_hi))
    print("  Z 范围: %.3f ~ %.3f" % (z_lo, z_hi))

    # 略微外扩，避免边界格子因浮点误差落空
    pad_x = (x_hi - x_lo) * 0.002
    pad_z = (z_hi - z_lo) * 0.002
    x_lo, x_hi = x_lo - pad_x, x_hi + pad_x
    z_lo, z_hi = z_lo - pad_z, z_hi + pad_z

    # 把点映射到网格下标
    gx = np.clip(((x - x_lo) / (x_hi - x_lo) * grid).astype(np.int32), 0, grid - 1)
    gz = np.clip(((z - z_lo) / (z_hi - z_lo) * grid).astype(np.int32), 0, grid - 1)
    cell = gz * grid + gx

    order = np.argsort(cell, kind="stable")
    cell_sorted = cell[order]
    y_sorted = y[order]
    boundaries = np.searchsorted(cell_sorted, np.arange(grid * grid + 1))

    print("统计每个格子的高度分位数（%d×%d）…" % (grid, grid))

    wanted = [0.2, 0.5, 0.75, 0.8, 0.9]
    raw = {p: np.full(grid * grid, np.nan, dtype=np.float64) for p in wanted}
    counts = np.zeros(grid * grid, dtype=np.int32)

    for idx in range(grid * grid):
        lo, hi = boundaries[idx], boundaries[idx + 1]
        if hi <= lo:
            continue
        counts[idx] = hi - lo
        seg = y_sorted[lo:hi]
        for p in wanted:
            raw[p][idx] = np.percentile(seg, p * 100.0)

    print("  有数据的格子      : {:,} / {:,} ({:.1f}%)".format(
        int((counts > 0).sum()), grid * grid, 100.0 * (counts > 0).sum() / (grid * grid)))

    # 点数太少的格子统计不可信（哪怕只有 1 个飞点，中位数也会被它带跑）
    solid = counts >= min_points
    print("  点数 >= %d 的格子   : %s (%.1f%%)" % (
        min_points, format(int(solid.sum()), ","),
        100.0 * solid.sum() / (grid * grid)))

    pkey = round(percentile / 100.0, 3)
    if pkey not in raw:
        # 用户给了不在预报列表里的分位数，就现场补算一遍
        raw[pkey] = np.full(grid * grid, np.nan, dtype=np.float64)
        for idx in range(grid * grid):
            lo, hi = boundaries[idx], boundaries[idx + 1]
            if hi <= lo:
                continue
            raw[pkey][idx] = np.percentile(y_sorted[lo:hi], percentile)

    primary = raw[pkey].reshape(grid, grid)
    solid_2d = solid.reshape(grid, grid)

    print("  采用的分位数: p%g（避免被下方河床拉低）" % percentile)

    filled, valid = fill_gaps(primary, solid_2d, grid)
    print("  邻域填充后可用格子: {:,} ({:.1f}%)".format(
        int(valid.sum()), 100.0 * valid.sum() / (grid * grid)))

    vals = filled[valid]
    print("  高度(Y) min=%.3f  p5=%.3f  p50=%.3f  p95=%.3f  max=%.3f"
          % (vals.min(), np.percentile(vals, 5), np.percentile(vals, 50),
             np.percentile(vals, 95), vals.max()))
    print("  有效区域内落差: %.3f 场景单位" % (vals.max() - vals.min()))

    flat = np.where(valid, filled, np.nan).reshape(-1)
    heights_out = [None if not np.isfinite(v) else round(float(v), 4) for v in flat]

    payload = {
        "version": 2,
        "gridSize": grid,
        "source": os.path.basename(src),
        "pointCount": n,
        "minPointsPerCell": min_points,
        "percentile": percentile,      # 取高度用的分位数，便于事后核对
        "orientationDeg": rot_deg,     # 生成时施加的朝向修正，便于事后核对
        "bounds": {
            "minX": float(x_lo), "maxX": float(x_hi),
            "minZ": float(z_lo), "maxZ": float(z_hi),
        },
        "yRange": {"min": float(y_lo), "max": float(y_hi)},
        "heights": heights_out,
        "counts": counts.reshape(grid, grid).tolist(),
    }

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))

    print()
    print("已写出: %s  (%.1f KB)" % (dst, os.path.getsize(dst) / 1024.0))

    preview = os.path.splitext(dst)[0] + "_preview.png"
    render_preview(filled, valid, grid, preview)
    print("（预览图中亮=高处，暗=低处，红色=无数据区域）")


if __name__ == "__main__":
    main()
