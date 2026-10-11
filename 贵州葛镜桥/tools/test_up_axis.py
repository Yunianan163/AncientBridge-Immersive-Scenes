# -*- coding: utf-8 -*-
"""
test_up_axis.py — 客观判定点云的「上」方向是 +Y 还是 -Y

不依赖任何主观视觉，只用两条物理事实：

  事实 1：地面/河床是连续的平滑曲面，树冠/植被是锯齿状的起伏。
          分别取每个网格列的最低点面 A 与最高点面 B，
          更平滑的那个就是地面，地面所在的一侧即为「下」。

  事实 2：植被冠层偏绿，裸露地面/河床偏灰。
          如果「高处」比「低处」更绿，说明高处是树冠，即 +Y 朝上。

两条证据一致才下结论。

用法：
    python test_up_axis.py <scene.ply> [grid]
"""

import sys

import numpy as np

CHUNK = 1 << 20
ALPHA_MIN = 0.05      # 只看不透明度 sigmoid >= 该值的点（滤掉雾状噪点）
MIN_POINTS = 8        # 每列最少点数，低于此值该列丢弃


def read_ply(path):
    """一次性读入，返回 props 名字列表与 (N, P) 的 float32 数组。"""
    import os

    size = os.path.getsize(path)
    with open(path, "rb") as f:
        head_bytes = f.read(65536)
        end = head_bytes.find(b"end_header\n")
        if end < 0:
            raise RuntimeError("不是合法的 PLY：找不到 end_header")
        end += len(b"end_header\n")
        head = head_bytes[:end].decode("ascii", "replace")

        n = 0
        props = []
        in_vertex = False
        for line in head.splitlines():
            p = line.split()
            if not p:
                continue
            if p[0] == "element":
                in_vertex = (p[1] == "vertex")
                if in_vertex:
                    n = int(p[2])
            elif p[0] == "property" and in_vertex:
                props.append(p[-1])

        if not props:
            raise RuntimeError("没有解析到顶点属性")
        if "double" in head:
            dtype = "f8"
            w = 8
        else:
            dtype = "f4"
            w = 4

        stride = len(props) * w
        if end + n * stride != size:
            raise RuntimeError("数据长度与头部不符：%d + %d*%d != %d"
                               % (end, n, stride, size))

        f.seek(end)
        data = np.empty((n, len(props)), dtype=dtype)
        buf = np.empty(min(CHUNK, n) * len(props), dtype=dtype)
        got = 0
        while got < n:
            take = min(CHUNK, n - got)
            want = take * len(props)
            view = np.frombuffer(f.read(want * w), dtype=dtype)
            data[got:got + take] = view.reshape(take, len(props))
            got += take

    return props, data


def roughness(surf, grid):
    """曲面粗糙度：与右邻/下邻有效值的高差均值，越大越锯齿。"""
    s = surf.reshape(grid, grid)
    tot, cnt = 0.0, 0
    for dx, dz in ((1, 0), (0, 1)):
        a = s[: grid - dx, : grid - dz]
        b = s[dx:, dz:]
        m = np.isfinite(a) & np.isfinite(b)
        tot += float(np.abs(a[m] - b[m]).sum())
        cnt += int(m.sum())
    return tot / max(cnt, 1)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src = sys.argv[1]
    grid = int(sys.argv[2]) if len(sys.argv) > 2 else 128

    print("读取点云：%s" % src)
    props, data = read_ply(src)
    idx = {name: i for i, name in enumerate(props)}
    n = data.shape[0]
    print("  顶点数: {:,}   属性数: {}".format(n, len(props)))

    x = data[:, idx["x"]].astype(np.float64)
    y = data[:, idx["y"]].astype(np.float64)
    z = data[:, idx["z"]].astype(np.float64)

    # 滤掉近乎透明的雾状噪点
    alpha = 1.0 / (1.0 + np.exp(-data[:, idx["opacity"]].astype(np.float64)))
    keep = alpha >= ALPHA_MIN
    print("  不透明度 >= %.2f: {:,} ({:.1f}%)".format(ALPHA_MIN, int(keep.sum()), 100.0 * keep.mean()))

    x, y, z = x[keep], y[keep], z[keep]
    # 3DGS: color = 0.5 + 0.28209 * f_dc  →  取绿度 = G - (R+B)/2
    rgb = data[keep][:, [idx["f_dc_0"], idx["f_dc_1"], idx["f_dc_2"]]].astype(np.float64)
    rgb = 0.5 + 0.28209479177387814 * rgb
    green = rgb[:, 1] - 0.5 * (rgb[:, 0] + rgb[:, 2])

    # 栅格化
    x_lo, x_hi = np.percentile(x, [0.5, 99.5])
    z_lo, z_hi = np.percentile(z, [0.5, 99.5])
    x_lo -= (x_hi - x_lo) * 0.002
    x_hi += (x_hi - x_lo) * 0.002
    z_lo -= (z_hi - z_lo) * 0.002
    z_hi += (z_hi - z_lo) * 0.002

    gx = np.clip(((x - x_lo) / (x_hi - x_lo) * grid).astype(np.int64), 0, grid - 1)
    gz = np.clip(((z - z_lo) / (z_hi - z_lo) * grid).astype(np.int64), 0, grid - 1)
    cell = gz * grid + gx

    order = np.argsort(cell, kind="stable")
    cell_s, y_s, g_s = cell[order], y[order], green[order]
    bnd = np.searchsorted(cell_s, np.arange(grid * grid + 1))

    lo_surf = np.full(grid * grid, np.nan)     # 每列低处高度
    hi_surf = np.full(grid * grid, np.nan)     # 每列高处高度
    lo_green = np.full(grid * grid, np.nan)    # 低处（最下 10%）的平均绿度
    hi_green = np.full(grid * grid, np.nan)    # 高处（最上 10%）的平均绿度

    for i in range(grid * grid):
        a, b = bnd[i], bnd[i + 1]
        if b - a < MIN_POINTS:
            continue
        seg = y_s[a:b]
        gg = g_s[a:b]
        th_lo = np.percentile(seg, 10.0)
        th_hi = np.percentile(seg, 90.0)

        lo_surf[i] = np.percentile(seg, 5.0)
        hi_surf[i] = np.percentile(seg, 95.0)

        m_lo = seg <= th_lo
        m_hi = seg >= th_hi
        if m_lo.any():
            lo_green[i] = gg[m_lo].mean()
        if m_hi.any():
            hi_green[i] = gg[m_hi].mean()

    valid = np.isfinite(lo_surf)
    print("  有效列: {:,} / {:,}".format(int(valid.sum()), grid * grid))

    r_lo = roughness(lo_surf, grid)
    r_hi = roughness(hi_surf, grid)
    g_lo = float(np.nanmean(lo_green))
    g_hi = float(np.nanmean(hi_green))

    print()
    print("================= 判 定 =================")
    print("【证据 1　平滑度】地面更平滑")
    print("    低处曲面粗糙度 = %.5f" % r_lo)
    print("    高处曲面粗糙度 = %.5f" % r_hi)
    if r_lo < r_hi:
        v1 = "低处更平滑 → 地面在低 Y → 上方向 = +Y（方向正确）"
    else:
        v1 = "高处更平滑 → 地面在高 Y → 上方向 = -Y（上下颠倒，需翻转）"
    print("    => %s" % v1)

    print()
    print("【证据 2　颜色】树冠更绿")
    print("    低处(最下10%%)平均绿度 = %+.4f" % g_lo)
    print("    高处(最上10%%)平均绿度 = %+.4f" % g_hi)
    if g_hi > g_lo:
        v2 = "高处更绿 → 高处是树冠 → 上方向 = +Y（方向正确）"
    else:
        v2 = "低处更绿 → 低处是树冠 → 上方向 = -Y（上下颠倒，需翻转）"
    print("    => %s" % v2)

    print()
    if (r_lo < r_hi) == (g_hi > g_lo):
        if r_lo < r_hi:
            print("★ 两条证据一致：上方向 = +Y ，模型方向本来就是对的，不需要翻转。")
        else:
            print("★ 两条证据一致：上方向 = -Y ，模型上下颠倒，需要绕 X 轴旋转 180°。")
    else:
        print("⚠ 两条证据冲突，需要人工看图判断。")


if __name__ == "__main__":
    main()
