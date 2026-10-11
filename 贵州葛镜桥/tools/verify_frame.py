# -*- coding: utf-8 -*-
"""
确定 scene.ply 的坐标系与 Spirula SfM 世界坐标系之间的旋转关系。

已知：
  * SfM 世界坐标系是 Z 朝上（由 colmap_up_axis.py 用相机位姿判定）
  * scene.ply 的最薄轴是 Y，说明导出时绕 X 轴转过 ±90°
  于是只剩两种可能（都是绕 X 轴的正常旋转，不改变手性）：
      候选 b:  rotX(-90°)  →  ply = ( x,  z,  -y)   上方向变为 +Y
      候选 c:  rotX(+90°)  →  ply = ( x, -z,   y)   上方向变为 -Y
  两者都保持 X 不变，区别只在 Y/Z 的符号组合。

判定方法：把 SfM 点云投影到它的 (x, y) 平面、把 PLY 投影到 (x, z) 平面，
两者本应是同一张「俯视轮廓图」（因为两者竖直轴不同，但平面内两根轴一一对应）。
按每个候选做映射后算交并比 IoU，高者即为真实变换。

用法：
    python verify_frame.py <scene.ply> <sparse_dir>
"""

import os
import struct
import sys

import numpy as np


# ------------------------------------------------------------------ 读点云

def read_ply_positions(path, max_points=None):
    with open(path, "rb") as f:
        head = f.read(65536)
        end = head.find(b"end_header\n")
        if end < 0:
            raise RuntimeError("不是合法 PLY")
        end += len(b"end_header\n")
        text = head[:end].decode("ascii", "replace")

        n = 0
        props, in_v = [], False
        for line in text.splitlines():
            p = line.split()
            if not p:
                continue
            if p[0] == "element":
                in_v = (p[1] == "vertex")
                if in_v:
                    n = int(p[2])
            elif p[0] == "property" and in_v:
                props.append(p[-1])

        stride = 4 * len(props)
        f.seek(end)

        step = 1
        if max_points and n > max_points:
            step = int(np.ceil(n / max_points))

        buf = np.fromfile(f, dtype="<f4", count=n * len(props)).reshape(n, len(props))
        arr = buf[::step]

    idx = {name: i for i, name in enumerate(props)}
    return arr[:, [idx["x"], idx["y"], idx["z"]]].astype(np.float64)


def read_sfm_points(path):
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
    return xyz


# ------------------------------------------------------------------ 打分

def occupancy(u, v, grid=72, lo=0.5, hi=99.5):
    """把二维点投影成占位图（0/1），返回 (图像, 每格点数)。"""
    u0, u1 = np.percentile(u, [lo, hi])
    v0, v1 = np.percentile(v, [lo, hi])
    iu = np.clip(((u - u0) / max(u1 - u0, 1e-9) * grid).astype(int), 0, grid - 1)
    iv = np.clip(((v - v0) / max(v1 - v0, 1e-9) * grid).astype(int), 0, grid - 1)
    cnt = np.zeros((grid, grid), dtype=np.int64)
    np.add.at(cnt, (iv, iu), 1)
    return cnt


def iou(a, b):
    A, B = a > 0, b > 0
    inter = int((A & B).sum())
    union = int((A | B).sum())
    return inter / max(union, 1)


def dilate(m, k=1, it=1):
    """形态学膨胀，容忍两组点云覆盖率不同带来的边界差异。"""
    out = m.copy()
    for _ in range(it):
        p = np.pad(out, k, mode="constant")
        acc = np.zeros_like(out)
        for dy in range(-k, k + 1):
            for dx in range(-k, k + 1):
                acc |= p[k + dy:k + dy + out.shape[0], k + dx:k + dx + out.shape[1]]
        out = acc
    return out


def main():
    ply = sys.argv[1] if len(sys.argv) > 1 else "../scene.ply"
    sfm_dir = sys.argv[2] if len(sys.argv) > 2 else "."

    print("读取 PLY:", ply)
    p = read_ply_positions(ply, max_points=400000)
    print("  采样点 %d" % len(p))

    print("读取 SfM 稀疏点云…")
    s = read_sfm_points(os.path.join(sfm_dir, "points3D.bin"))
    print("  稀疏点 %d" % len(s))

    print()
    print("SfM  坐标范围: X[%.3f, %.3f] Y[%.3f, %.3f] Z[%.3f, %.3f]"
          % (*np.percentile(s[:, 0], [0.5, 99.5]),
             *np.percentile(s[:, 1], [0.5, 99.5]),
             *np.percentile(s[:, 2], [0.5, 99.5])))
    print("PLY  坐标范围: X[%.3f, %.3f] Y[%.3f, %.3f] Z[%.3f, %.3f]"
          % (*np.percentile(p[:, 0], [0.5, 99.5]),
             *np.percentile(p[:, 1], [0.5, 99.5]),
             *np.percentile(p[:, 2], [0.5, 99.5])))

    # SfM 俯视轮廓：x 向右、y 向上
    sfm_img = occupancy(s[:, 0], s[:, 1])
    # PLY 俯视轮廓：x 向右、z 向上（相对 PLY 自己的竖直轴 Y，这是「从上方俯视」）
    ply_img = occupancy(p[:, 0], p[:, 2])

    # 候选 b：ply = (x, z, -y)  →  PLY 的 z 对应  -y_sfm  →  SfM 图需要上下翻转
    cand_b = np.flipud(sfm_img)
    # 候选 c：ply = (x, -z, y)  →  PLY 的 z 对应  +y_sfm  →  直接对应
    cand_c = sfm_img

    print()
    print("============== 轮廓匹配（IoU 越大越像）==============")
    for name, img, desc in (("b", cand_b, "rotX(-90°)  ply=( x,  z, -y)  → 上方向 +Y"),
                            ("c", cand_c, "rotX(+90°)  ply=( x, -z,  y)  → 上方向 -Y")):
        raw = iou(img, ply_img)
        d1 = iou(dilate(img, 1, 1), dilate(ply_img, 1, 1))
        d2 = iou(dilate(img, 2, 2), dilate(ply_img, 2, 2))
        print("  候选 %s  %s" % (name, desc))
        print("          原始 IoU = %6.3f   膨胀1次 = %6.3f   膨胀2次 = %6.3f"
              % (raw, d1, d2))

    print()
    rb = iou(dilate(cand_b, 1, 1), dilate(ply_img, 1, 1))
    rc = iou(dilate(cand_c, 1, 1), dilate(ply_img, 1, 1))
    if abs(rb - rc) < 0.02:
        print("⚠ 两种候选差别太小（%.3f vs %.3f），无法据此下结论。" % (rb, rc))
    elif rc > rb:
        print("★ 候选 c 胜出 → PLY 的竖直轴是 -Y")
        print("   即：PLY 与真实世界上下颠倒，需要绕 X 轴旋转 180° 才正确。")
    else:
        print("★ 候选 b 胜出 → PLY 的竖直轴是 +Y")
        print("   即：PLY 的方向本来就是正确的。")


if __name__ == "__main__":
    main()
