# -*- coding: utf-8 -*-
"""
cam_track.py — 把 SfM 的相机轨迹换算到网页的世界坐标系并导出

为什么需要它
    要在场景里给人物找一个「合理的落脚点」（例如桥面），得先知道场景里
    各部分到底在哪。相机轨迹是现成的路标：拍摄者走过的路线必然是可通行的
    地方，而且**站在桥上时正下方是几十米深的河谷**，相机离地高度会明显异常。
    把轨迹画到场景上，桥就在那些异常点附近。

坐标换算
    PLY 资产坐标系：  asset = (x_sfm, -z_sfm, y_sfm)
    网页世界坐标系：  world = asset 绕 X 轴转 180° = (x_sfm, z_sfm, -y_sfm)

用法：
    python cam_track.py <sparse_dir> <out.json> [步长]
"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from estimate_scale import quat_to_rot, read_images, read_points3D, frame_key  # noqa: E402


def main():
    d = sys.argv[1]
    out = sys.argv[2]
    stride = int(sys.argv[3]) if len(sys.argv) > 3 else 25

    ids, cam_ids, qs, ts, names = read_images(os.path.join(d, "images.bin"))
    pts = read_points3D(os.path.join(d, "points3D.bin"))

    C = np.empty((len(ids), 3))
    for i in range(len(ids)):
        C[i] = -quat_to_rot(qs[i]).T @ ts[i]

    # SfM(Z-up) → 网页世界坐标系(Y-up)
    W = np.stack([C[:, 0], C[:, 2], -C[:, 1]], axis=1)

    keys = [frame_key(n) for n in names]
    segs = {}
    for k in keys:
        segs[k[0]] = segs.get(k[0], 0) + 1

    print("影像 %d 张，片段分布: %s" % (len(ids), segs))
    print("稀疏点 %d" % len(pts))
    print()

    # ---- 用地形网格求每个相机离「脚下地面」的高度（SfM 水平面 = XY）----
    grid = 220
    x_lo, x_hi = np.percentile(np.concatenate([pts[:, 0], C[:, 0]]), [0.2, 99.8])
    y_lo, y_hi = np.percentile(np.concatenate([pts[:, 1], C[:, 1]]), [0.2, 99.8])

    def cell_of(a, lo, hi):
        return np.clip(((a - lo) / max(hi - lo, 1e-9) * grid).astype(int), 0, grid - 1)

    gidx = cell_of(pts[:, 1], y_lo, y_hi) * grid + cell_of(pts[:, 0], x_lo, x_hi)
    order = np.argsort(gidx, kind="stable")
    cs, zs = gidx[order], pts[order, 2]
    bnd = np.searchsorted(cs, np.arange(grid * grid + 1))

    floor = np.full(grid * grid, np.nan)
    for i in range(grid * grid):
        a, b = bnd[i], bnd[i + 1]
        if b - a >= 3:
            floor[i] = np.percentile(zs[a:b], 3.0)

    ci = cell_of(C[:, 1], y_lo, y_hi) * grid + cell_of(C[:, 0], x_lo, x_hi)
    fval = floor[ci]
    height = C[:, 2] - fval

    ok = np.isfinite(height)
    print("相机离脚下地面的高度分布（单位: 场景单位）")
    q = np.percentile(height[ok], [5, 25, 50, 75, 90, 95, 99])
    print("  p5=%.5f p25=%.5f p50=%.5f p75=%.5f p90=%.5f p95=%.5f p99=%.5f"
          % tuple(q))
    print()

    # 高差最大的那些相机：脚下是深谷 —— 极可能就在桥上（或峡谷崖边）
    idx = np.argsort(-np.nan_to_num(height, nan=-1))
    print("离地最高的 30 个相机（可能位于桥上或峡谷崖边）")
    print("  %-6s %-8s %-28s %-10s" % ("名次", "影像", "世界坐标 (x, y, z)", "离地高度"))
    for r, i in enumerate(idx[:30]):
        print("  %-6d %-8s (%8.3f, %8.3f, %8.3f)   %.5f"
              % (r + 1, names[i], W[i, 0], W[i, 1], W[i, 2], height[i]))
    print()

    # 这些「高点」相机聚在哪里
    top = idx[:40]
    print("这 40 个高差相机的位置统计")
    for ax, nm in enumerate("XYZ"):
        v = W[top, ax]
        print("  %s: 均值 %8.3f   范围 [%8.3f, %8.3f]   标准差 %.3f"
              % (nm, v.mean(), v.min(), v.max(), v.std()))
    print()

    print("整个轨迹的世界坐标范围")
    lo = np.percentile(W, 0.5, axis=0)
    hi = np.percentile(W, 99.5, axis=0)
    for ax, nm in enumerate("XYZ"):
        print("  %s: [%8.3f, %8.3f]" % (nm, lo[ax], hi[ax]))

    # ---- 导出供网页渲染的轨迹点 ----
    track = []
    for i in range(0, len(W), stride):
        track.append({
            "n": names[i],
            "h": None if not np.isfinite(height[i]) else round(float(height[i]), 5),
            "p": [round(float(v), 4) for v in W[i]],
        })

    payload = {
        "source": d,
        "count": len(ids),
        "segments": segs,
        "heightPercentiles": [round(float(v), 5) for v in q],
        "track": track,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print()
    print("已写出轨迹: %s （%d 个点，步长 %d）" % (out, len(track), stride))


if __name__ == "__main__":
    main()
