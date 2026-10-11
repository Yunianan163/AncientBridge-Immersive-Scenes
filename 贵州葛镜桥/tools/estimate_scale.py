# -*- coding: utf-8 -*-
"""
estimate_scale.py — 从 SfM 稀疏重建反推「1 场景单位 = 多少米」

为什么需要它
    三维重建（SfM / 高斯泼溅）本身是**没有尺度**的：把整个场景放大 10 倍，
    投影出来的照片一模一样。所以「人物该多大、一步走多远」必须靠一个外部
    已知尺寸来标定。之前的做法是拿「桥跨度」估，但桥在场景里跨了多少个单位
    并没有实测过，估出来的 12 米/单位偏小了一个数量级。

这里用两个互相独立的锚点，取二者一致才采信：

    锚点 A：相机高度
        拍视频的相机架在人的视线高度（手持/云台约 1.5~1.7 米），
        也一定在它所拍的地面之上。于是
            米/单位 = 真实眼高 / 相机到正下方地面的中位高差

    锚点 B：相邻帧位移
        两段素材共 1378 张影像、约 23 分钟，按 1 帧/秒抽取。
        若拍摄者是步行（约 1.0~1.3 米/秒），则相邻相机间距约为一个步速，
            米/单位 = 步行速度 × 抽帧间隔 / 相邻相机中心的中位距离

两个锚点都依赖假设（人眼高度、是否步行），所以脚本会把分布一并打印出来 ——
只有分布足够集中，中位数才有意义。

用法：
    python estimate_scale.py <sparse_dir>
"""

import os
import re
import struct
import sys

import numpy as np

TYPE_MAP = {0: 3, 1: 4, 2: 4, 3: 4, 4: 5, 5: 8, 6: 8, 7: 8, 8: 12, 9: 12, 10: 12}
IMG_FIXED = 64
PT2D_SIZE = 24

# PLY 资产坐标系与 SfM 世界坐标系的关系（见 config.js 注释）：
#     ply = (x_sfm, -z_sfm, y_sfm)
# 因此各轴跨度的对应关系是：
#     PLY_X ← SfM_X ,  PLY_Y ← SfM_Z ,  PLY_Z ← SfM_Y
PLY_BOUNDS = {"X": (-0.843, 1.639), "Y": (-0.205, 0.258), "Z": (-0.547, 1.419)}


def read_images(path):
    buf = open(path, "rb").read()
    n = struct.unpack_from("<Q", buf, 0)[0]
    off = 8
    ids, cams, qs, ts, names = [], [], [], [], []
    for _ in range(n):
        ids.append(struct.unpack_from("<i", buf, off)[0])
        qs.append(struct.unpack_from("<4d", buf, off + 4))
        ts.append(struct.unpack_from("<3d", buf, off + 36))
        cams.append(struct.unpack_from("<i", buf, off + 60)[0])
        off += IMG_FIXED
        end = buf.index(b"\x00", off)
        names.append(buf[off:end].decode("utf-8", "replace"))
        off = end + 1
        n2d = struct.unpack_from("<Q", buf, off)[0]
        off += 8 + PT2D_SIZE * n2d
    assert off == len(buf), "images.bin 解析终点 %d != 文件大小 %d" % (off, len(buf))
    return np.array(ids), np.array(cams), np.array(qs), np.array(ts), names


def read_points3D(path):
    buf = open(path, "rb").read()
    n = struct.unpack_from("<Q", buf, 0)[0]
    xyz = np.empty((n, 3))
    off = 8
    for i in range(n):
        off += 8
        xyz[i] = struct.unpack_from("<3d", buf, off)
        off += 24 + 3 + 8
        tl = struct.unpack_from("<Q", buf, off)[0]
        off += 8 + 8 * tl
    assert off == len(buf), "points3D.bin 解析终点 %d != 文件大小 %d" % (off, len(buf))
    return xyz


def quat_to_rot(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([
        [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * z * w, 2 * x * z + 2 * y * w],
        [2 * x * y + 2 * z * w, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * x * w],
        [2 * x * z - 2 * y * w, 2 * y * z + 2 * x * w, 1 - 2 * x * x - 2 * y * y],
    ])


def frame_key(name):
    """影像名形如 0/123.jpg，按 (片段号, 帧号) 排序才等于时间顺序"""
    m = re.match(r"^(\d+)/(\d+)", name)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 0, 0


def pct(tag, a, unit=""):
    q = np.percentile(a, [5, 25, 50, 75, 95])
    print("  %-22s p5=%9.5f  p25=%9.5f  **p50=%9.5f**  p75=%9.5f  p95=%9.5f %s"
          % (tag, q[0], q[1], q[2], q[3], q[4], unit))
    return float(q[2])


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "."

    print("=" * 78)
    print("从 SfM 稀疏重建反推尺度：%s" % d)
    print("=" * 78)

    ids, cam_ids, qs, ts, names = read_images(os.path.join(d, "images.bin"))
    pts = read_points3D(os.path.join(d, "points3D.bin"))

    C = np.empty((len(ids), 3))
    for i in range(len(ids)):
        C[i] = -quat_to_rot(qs[i]).T @ ts[i]

    print("影像 {:,} 张    稀疏点 {:,}".format(len(ids), len(pts)))

    # ---------- 1. 单位是否与 PLY 一致 ----------
    print()
    print("---------- 1. SfM 与 PLY 的单位一致性 ----------")
    print("  %-8s %-12s %-12s %-12s" % ("轴", "SfM 跨度", "PLY 对应轴", "PLY 跨度"))
    mapping = [("X", "X"), ("Y", "Z"), ("Z", "Y")]
    consistent = True
    for sa, pa in mapping:
        i = "XYZ".index(sa)
        lo, hi = np.percentile(pts[:, i], [0.5, 99.5])
        s_span = hi - lo
        p_span = PLY_BOUNDS[pa][1] - PLY_BOUNDS[pa][0]
        ratio = s_span / p_span
        print("  %-8s %-12.4f %-12s %-12.4f  比值 %.4f" % (sa, s_span, pa, p_span, ratio))
        if not (0.5 < ratio < 2.0):
            consistent = False
    if consistent:
        print("  ✔ 各轴跨度与 PLY 基本一致 → SfM 与 PLY 使用**同一套单位**，可直接换算")
    else:
        print("  ✘ 跨度差异明显 → 两者之间存在缩放，下面的数值需要再乘这个比值")

    # ---------- 2. 锚点 A：相机高度 ----------
    print()
    print("---------- 2. 锚点 A：相机离地高度（假设手持约 1.5~1.7 米）----------")
    grid = 200
    xy = pts[:, :2]

    # 只统计相机所在的那片区域，避免远处稀疏点把网格撑大
    x_lo, x_hi = np.percentile(np.concatenate([xy[:, 0], C[:, 0]]), [0.2, 99.8])
    y_lo, y_hi = np.percentile(np.concatenate([xy[:, 1], C[:, 1]]), [0.2, 99.8])

    def cell_of(a, lo, hi):
        return np.clip(((a - lo) / max(hi - lo, 1e-9) * grid).astype(int), 0, grid - 1)

    gidx = cell_of(xy[:, 1], y_lo, y_hi) * grid + cell_of(xy[:, 0], x_lo, x_hi)
    order = np.argsort(gidx, kind="stable")
    cs, zs = gidx[order], pts[order, 2]
    bnd = np.searchsorted(cs, np.arange(grid * grid + 1))

    floor = np.full(grid * grid, np.nan)
    for i in range(grid * grid):
        a, b = bnd[i], bnd[i + 1]
        if b - a >= 3:
            floor[i] = np.percentile(zs[a:b], 3.0)   # 3% 分位≈贴地那一层

    ci = cell_of(C[:, 1], y_lo, y_hi) * grid + cell_of(C[:, 0], x_lo, x_hi)
    fval = floor[ci]
    ok = np.isfinite(fval)
    above = (C[:, 2] - fval)[ok]
    above = above[above > 0]
    print("  有效相机 %d / %d   （其余落在点云覆盖不到的格子上）" % (int(ok.sum()), len(ids)))
    med_h = pct("相机离地高度", above)

    for eye in (1.5, 1.6, 1.7):
        print("    若眼高 %.1f 米 → %.1f 米/单位" % (eye, eye / med_h))

    # ---------- 3. 锚点 B：相邻帧位移 ----------
    print()
    print("---------- 3. 锚点 B：相邻帧相机位移（假设步行 1.0~1.3 米/秒）----------")
    keys = [frame_key(n) for n in names]
    ordr = sorted(range(len(keys)), key=lambda i: keys[i])
    C_o = C[ordr]
    seq = [keys[i][0] for i in ordr]

    steps, jumps = [], []
    for i in range(1, len(C_o)):
        if seq[i] != seq[i - 1]:
            jumps.append(i - 1)
            continue
        steps.append(float(np.linalg.norm(C_o[i] - C_o[i - 1])))
    steps = np.array(steps)

    # 少数帧之间可能有跳变（抽帧不严格等间隔），先剔除极端值
    keep = steps < np.percentile(steps, 99)
    med_step = pct("相邻帧位移", steps[keep])
    print("  片段数 %d，跨片段接缝 %d 处（已排除）" % (len(set(seq)), len(jumps)))

    # 路径总长（按中位步长估算，避免个别跳变污染）
    for fps_note, dt in (("1 帧/秒", 1.0), ("2 帧/秒", 0.5)):
        print("  若抽帧间隔 %.1f 秒：" % dt)
        for v in (1.0, 1.1, 1.3):
            print("    步行 %.1f 米/秒 → %.1f 米/单位" % (v, v * dt / med_step))

    # ---------- 4. 汇总 ----------
    print()
    print("=" * 78)
    print("参考结论")
    print("=" * 78)
    print("  锚点 A（相机高度）与锚点 B（步行位移）若落在大致相同的量级，")
    print("  就可以采信；两者若差很多，说明拍摄方式不是步行（可能是无人机/车），")
    print("  此时以锚点 A 为准，并务必再用桥面宽度（真实 8.5 米）复核一次。")
    print()
    print("  当前角色设定：1.7 米 ÷ 12 米/单位 = 0.1417 场景单位")
    print("  该尺寸占场景总竖高（%.3f 单位）的 %.1f%% —— 一个人不可能占山谷的这么大比例。"
          % (PLY_BOUNDS["Y"][1] - PLY_BOUNDS["Y"][0],
             100 * 0.1417 / (PLY_BOUNDS["Y"][1] - PLY_BOUNDS["Y"][0])))


if __name__ == "__main__":
    main()
