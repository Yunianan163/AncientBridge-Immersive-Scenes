"""
diagnose_heightmap.py — 诊断「人物掉下去 / 陷入地面」的成因。

检查三件事：
1. 高度图在桥面区域的覆盖率（多少格是 null）
2. 桥面沿轴线的高度剖面（是否有断崖式的跳变）
3. 桥面横向（垂直桥轴）的高度剖面 —— 看桥面是否被重建成了「一条窄脊」，
   两侧迅速跌落。这直接决定「稍微走偏就掉下去」。

索引约定：build_heightmap.py 写的是 cell = gz*grid + gx，
reshape(G,G) 后 H[iz, ix]，与 JS 的 heights[iz*G+ix] 一致。
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'models'))


def load_heightmap(path):
    with open(path, 'r', encoding='utf-8') as f:
        hm = json.load(f)

    g = hm['gridSize']
    raw = hm['heights']
    H = np.full(g * g, np.nan, dtype=np.float64)
    for i, v in enumerate(raw):
        if v is not None:
            H[i] = v
    H = H.reshape(g, g)          # H[iz, ix]
    counts = np.array(hm['counts'], dtype=np.int32)

    return hm, H, counts


def main():
    path = os.path.join(MODELS, 'heightmap.json')
    hm, H, counts = load_heightmap(path)

    g = hm['gridSize']
    bd = hm['bounds']
    minx, maxx = bd['minX'], bd['maxX']
    minz, maxz = bd['minZ'], bd['maxZ']
    cw = (maxx - minx) / (g - 1)
    ch = (maxz - minz) / (g - 1)

    print(f'高度图: grid={g}  X[{minx:.4f},{maxx:.4f}]  Z[{minz:.4f},{maxz:.4f}]')
    print(f'单元尺寸: {cw:.6f} x {ch:.6f} 单位   '
          f'(按 115 米/单位 -> {cw * 115:.2f} m x {ch * 115:.2f} m)')

    valid = ~np.isnan(H)
    print(f'\n有效格: {valid.sum()} / {g * g}  ({100 * valid.mean():.1f}%)')
    print(f'高度范围: {np.nanmin(H):.4f} ~ {np.nanmax(H):.4f}')

    # 每格平均点数 —— 太少说明该处高斯稀疏，高度不可信
    print(f'平均点数/格: 全体 {counts.mean():.1f}, 有效格 {counts[valid].mean():.1f}, '
          f'最小值 {counts[valid].min()}')

    def to_cell(x, z):
        ix = int(round((x - minx) / cw))
        iz = int(round((z - minz) / ch))
        return ix, iz

    # ---------------------------------------------------------- 桥面纵向剖面
    # 桥轴：(-0.1556, +0.1905) -> (+0.1546, -0.1468)
    ax0 = np.array([-0.1556, 0.1905])
    ax1 = np.array([0.1546, -0.1468])
    axis = ax1 - ax0
    L = np.linalg.norm(axis)
    u = axis / L
    n = np.array([-u[1], u[0]])          # 垂直桥轴的水平法向

    print(f'\n桥轴: {ax0} -> {ax1}   长度 {L:.4f} 单位 = {L * 115:.1f} m')

    print('\n=== 沿桥轴的高度剖面（纵向） ===')
    print(f'{"s(单位)":>9} {"s(m)":>7} {"h":>10} {"点数":>6} {"横向可用宽(m)":>14}')
    step = 0.02
    wid_hist = []
    for t in np.arange(0, L + 1e-9, step):
        p = ax0 + u * t
        ix, iz = to_cell(p[0], p[1])
        if not (0 <= ix < g and 0 <= iz < g):
            continue
        h = H[iz, ix]
        c = counts[iz, ix]
        hs = '  null' if np.isnan(h) else f'{h:+.5f}'

        # 横向扫描：从桥轴往两边走，看有多宽是「连续可用」的
        pos = 0.0
        while pos < 0.25:
            pos += (cw + ch) / 2
            q = p + n * pos
            jx, jz = to_cell(q[0], q[1])
            if not (0 <= jx < g and 0 <= jz < g) or np.isnan(H[jz, jx]):
                break
        neg = 0.0
        while neg < 0.25:
            neg += (cw + ch) / 2
            q = p - n * neg
            jx, jz = to_cell(q[0], q[1])
            if not (0 <= jx < g and 0 <= jz < g) or np.isnan(H[jz, jx]):
                break

        width = (pos + neg) * 115
        wid_hist.append(width)
        flag = ''
        if np.isnan(h):
            flag = '  <== 断裂'
        elif width < 8.5 * 0.6:
            flag = '  <== 太窄（桥面实宽 8.5 m）'

        print(f'{t:9.3f} {t * 115:7.1f} {hs:>10} {c:6d} {width:14.1f}{flag}')

    wid_hist = np.array(wid_hist)
    print(f'\n横向可用宽度: 中位 {np.median(wid_hist):.1f} m, '
          f'最小 {wid_hist.min():.1f} m, 最大 {wid_hist.max():.1f} m')
    print(f'  （葛镜桥桥面实宽 8.5 m；若重建出的「可用带」明显窄于此，')
    print(f'    说明桥面在高度图里只是一条窄脊，走偏一点就会掉）')

    # ------------------------------------------------- 为什么横向是断的？
    # 关键是「桥面两侧的格子里有没有点」。桥面本身有宽度，
    # 但栏杆、桥台外侧是悬空的，直方图里根本没有点 -> null
    print('\n=== 桥跨中横截面（垂直桥轴，过 s=0.23 处）===')
    pc = ax0 + u * 0.23
    print(f'{"偏移(单位)":>10} {"偏移(m)":>8} {"h":>10} {"点数":>6}')
    for k in range(-8, 9):
        q = pc + n * (k * (cw + ch) / 2)
        ix, iz = to_cell(q[0], q[1])
        if not (0 <= ix < g and 0 <= iz < g):
            print(f'{k * (cw + ch) / 2:10.4f} {k * (cw + ch) / 2 * 115:8.2f}  越界')
            continue
        h = H[iz, ix]
        hs = '  null' if np.isnan(h) else f'{h:+.5f}'
        print(f'{k * (cw + ch) / 2:10.4f} {k * (cw + ch) / 2 * 115:8.2f} {hs:>10} {counts[iz, ix]:6d}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
