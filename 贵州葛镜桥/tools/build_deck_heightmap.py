# -*- coding: utf-8 -*-
"""
build_deck_heightmap.py — 为桥面等「关键可行走区域」生成高分辨率细层高度图

为什么需要它
    全局高度图是 256² 网格、格距约 1.12 m。葛镜桥桥面只有 8.5 m 宽，
    在全局图里只占约 7 格 —— 精度严重不足，走偏一点就查询到桥外的河道高度。

    本脚本只针对一个矩形区域出图，分辨率 1024²，格距约 0.28 m，
    桥面宽度方向能有约 30 格，足够支撑精确贴地与边界判定。

为什么用低分位数（默认 p20）而不是中位数
    桥面两侧是悬空的。虽然按 XZ 投影时，桥面格子里理论上只有桥面的点，
    但在桥体边缘、栏杆外侧，格子里会混入**下方河道/崖壁**的点。
    中位数会被这些低点拉低，而 p20 更贴近「脚会踩到的那层桥面」。

    实测：全局图用中位数时，桥跨中桥面被压到 -0.036，与实际桥面偏差明显。

与全局图的关系
    细层与粗层共用同一套「世界坐标系 + 同一个旋转」，
    网页端查询时细层优先、超出细层范围再回落到粗层。
    两者必须用同一个 --rot 参数生成，否则会出现「人踩在镜像地面上」。

用法:
    python build_deck_heightmap.py <scene.ply> <out.json> [选项]

选项:
    --grid=1024              网格边长（默认 1024）
    --rot=180,0,0            朝向修正，必须与全局图一致
    --region=x0,x1,z0,z1     覆盖区域（世界坐标，单位=场景单位）
                             默认覆盖葛镜桥及两侧各约 15 m
    --percentile=20          取高度的分位数（默认 20）
    --min-points=4           每格最少点数（细层点数少，阈值相应降低）
    --pad=0.02               区域外扩比例，避免边界格子落空
"""

import json
import os
import sys
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_heightmap import (          # noqa: E402  复用已验证的读取与旋转实现
    euler_xyz_matrix,
    fill_gaps,
    load_positions,
    parse_rot,
)

warnings.filterwarnings("ignore", category=RuntimeWarning)

# 葛镜桥桥轴（世界坐标，由 tools/measure_bridge.py 拟合）
AX0 = (-0.1556, 0.1905)
AX1 = (0.1546, -0.1468)

# 桥面实宽 8.5 m，按 115 米/单位换算；两侧各留约 15 m 缓冲
DECK_HALF_WIDTH_UNITS = 8.5 / 2 / 115.0          # ≈ 0.037
BUFFER_UNITS = 15.0 / 115.0                      # ≈ 0.130


def parse_arg(argv, name, default=None):
    key = "--%s=" % name
    for a in argv:
        if a.startswith(key):
            return a.split("=", 1)[1]
    return default


def default_region():
    """默认区域：把桥轴外扩「桥面半宽 + 缓冲」，得到一个包围盒。"""
    ax = np.array(AX0)
    bx = np.array(AX1)
    lo = np.minimum(ax, bx) - (DECK_HALF_WIDTH_UNITS + BUFFER_UNITS)
    hi = np.maximum(ax, bx) + (DECK_HALF_WIDTH_UNITS + BUFFER_UNITS)
    return float(lo[0]), float(hi[0]), float(lo[1]), float(hi[1])


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    src = sys.argv[1]
    dst = sys.argv[2]

    grid = int(parse_arg(sys.argv, "grid", "1024"))
    percentile = float(parse_arg(sys.argv, "percentile", "20"))
    min_points = int(parse_arg(sys.argv, "min-points", "4"))
    pad = float(parse_arg(sys.argv, "pad", "0.02"))
    rot_deg = parse_rot(sys.argv)

    region = parse_arg(sys.argv, "region")
    if region:
        x0, x1, z0, z1 = [float(v) for v in region.split(",")]
    else:
        x0, x1, z0, z1 = default_region()

    print("读取点云…")
    x, y, z, props = load_positions(src)
    n = len(x)
    print("  顶点数: {:,}".format(n))

    if any(abs(v) > 1e-9 for v in rot_deg):
        m = euler_xyz_matrix(rot_deg)
        pts = m @ np.stack([x, y, z], axis=0)
        x, y, z = pts[0], pts[1], pts[2]
        print("  已施加朝向修正 rot=%s 度"
              % ",".join("%g" % v for v in rot_deg))

    # 外扩，避免边界格子因浮点误差落空
    w = x1 - x0
    d = z1 - z0
    x0 -= w * pad
    x1 += w * pad
    z0 -= d * pad
    z1 += d * pad

    print("\n=== 细层区域（世界坐标）===")
    print("  X: %.4f ~ %.4f  (跨度 %.4f 单位 = %.1f m)"
          % (x0, x1, x1 - x0, (x1 - x0) * 115))
    print("  Z: %.4f ~ %.4f  (跨度 %.4f 单位 = %.1f m)"
          % (z0, z1, z1 - z0, (z1 - z0) * 115))
    print("  网格: %d²  格距 %.4f x %.4f 单位 = %.3f x %.3f m"
          % (grid, (x1 - x0) / (grid - 1), (z1 - z0) / (grid - 1),
             (x1 - x0) / (grid - 1) * 115, (z1 - z0) / (grid - 1) * 115))

    # 只保留落在区域内的点（这一刀能省掉大量后续计算）
    inside = (x >= x0) & (x <= x1) & (z >= z0) & (z <= z1)
    print("  区域内点数: {:,} / {:,} ({:.1f}%)".format(
        int(inside.sum()), n, 100.0 * inside.sum() / n))

    xi = x[inside]
    yi = y[inside]
    zi = z[inside]

    if len(xi) == 0:
        print("区域内没有点，请检查 --region 与 --rot 是否正确")
        return 1

    gx = np.clip(((xi - x0) / (x1 - x0) * grid).astype(np.int32), 0, grid - 1)
    gz = np.clip(((zi - z0) / (z1 - z0) * grid).astype(np.int32), 0, grid - 1)
    cell = gz * grid + gx

    order = np.argsort(cell, kind="stable")
    cell_sorted = cell[order]
    y_sorted = yi[order]
    boundaries = np.searchsorted(cell_sorted, np.arange(grid * grid + 1))

    print("\n统计每格高度的 p%g 分位数（%d²）…" % (percentile, grid))

    heights = np.full(grid * grid, np.nan, dtype=np.float64)
    counts = np.zeros(grid * grid, dtype=np.int32)

    for idx in range(grid * grid):
        lo, hi = boundaries[idx], boundaries[idx + 1]
        if hi <= lo:
            continue
        counts[idx] = hi - lo
        heights[idx] = np.percentile(y_sorted[lo:hi], percentile)

    print("  有数据的格子: {:,} / {:,} ({:.1f}%)".format(
        int((counts > 0).sum()), grid * grid,
        100.0 * (counts > 0).sum() / (grid * grid)))

    h2 = heights.reshape(grid, grid)
    solid = (counts >= min_points).reshape(grid, grid)
    print("  点数 >= %d 的格子: %s (%.1f%%)" % (
        min_points, format(int(solid.sum()), ","),
        100.0 * solid.sum() / (grid * grid)))

    filled, valid = fill_gaps(h2, solid, grid)
    print("  邻域填充后可用: {:,} ({:.1f}%)".format(
        int(valid.sum()), 100.0 * valid.sum() / (grid * grid)))

    vals = filled[valid]
    if len(vals):
        print("  高度范围: %.4f ~ %.4f (落差 %.4f 单位 = %.1f m)"
              % (vals.min(), vals.max(), vals.max() - vals.min(),
                 (vals.max() - vals.min()) * 115))
    flat = np.where(valid, filled, np.nan).reshape(-1)
    heights_out = [None if not np.isfinite(v) else round(float(v), 5) for v in flat]

    payload = {
        "version": 1,
        "layer": "deck",
        "gridSize": grid,
        "source": os.path.basename(src),
        "pointCount": int(inside.sum()),
        "percentile": percentile,
        "minPointsPerCell": min_points,
        "orientationDeg": rot_deg,
        "bounds": {
            "minX": float(x0), "maxX": float(x1),
            "minZ": float(z0), "maxZ": float(z1),
        },
        "heights": heights_out,
        "counts": counts.reshape(grid, grid).tolist(),
    }

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))

    print("\n已写出: %s  (%.1f KB)" % (dst, os.path.getsize(dst) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
