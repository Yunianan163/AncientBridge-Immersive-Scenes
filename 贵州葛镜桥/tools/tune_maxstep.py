"""
tune_maxstep.py — 为 maxStep / maxDrop 挑一个合理的阈值

背景
    maxStep 是「相邻格高差上限」。它必须与**网格精度**匹配：
    256² 网格的格距约 1.12 m，沿桥面 1.12 m 内的高度变化本来就可能有 1~2 m
    （拱桥曲率 + 分位数噪声）。阈值定得太小（如 3 m）会把正常桥面也判死。

    这里沿桥轴与几个横向位置采样，统计「相邻格高差」的真实分布，
    据此给出阈值建议 —— 目标是把桥面放行、把崖壁挡住。
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'models'))

MPU = 115.0
AX0 = np.array([-0.1556, 0.1905])
AX1 = np.array([0.1546, -0.1468])


def load(path):
    hm = json.load(open(path, 'r', encoding='utf-8'))
    g = hm['gridSize']
    bd = hm['bounds']
    mnx, mxx, mnz, mxz = bd['minX'], bd['maxX'], bd['minZ'], bd['maxZ']
    cw = (mxx - mnx) / (g - 1)
    ch = (mxz - mnz) / (g - 1)
    H = np.full(g * g, np.nan)
    for i, v in enumerate(hm['heights']):
        if v is not None:
            H[i] = v
    H = H.reshape(g, g)

    def at(x, z):
        if not (mnx <= x <= mxx and mnz <= z <= mxz):
            return np.nan
        ix = int(round((x - mnx) / cw))
        iz = int(round((z - mnz) / ch))
        if not (0 <= ix < g and 0 <= iz < g):
            return np.nan
        return H[iz, ix]

    return at, max(cw, ch), cw, ch


def neighbor_diffs(at, x, z, d):
    """返回该点与四个邻格的高差绝对值（跳过无值方向）"""
    h = at(x, z)
    if np.isnan(h):
        return None
    out = []
    for px, pz in [(x + d, z), (x - d, z), (x, z + d), (x, z - d)]:
        hp = at(px, pz)
        if not np.isnan(hp):
            out.append(abs(hp - h) * MPU)
    return out


def main():
    at, d, cw, ch = load(os.path.join(MODELS, 'heightmap.json'))
    u = (AX1 - AX0) / np.linalg.norm(AX1 - AX0)
    n = np.array([-u[1], u[0]])
    L = np.linalg.norm(AX1 - AX0)

    print(f'网格格距: {cw * MPU:.3f} x {ch * MPU:.3f} m')

    # ---------------------------------------------------- 桥面上（应当放行）
    deck_max = []
    for t in np.arange(0, L + 1e-9, L / 200):
        p = AX0 + u * t
        for off in np.arange(-0.030, 0.0301, 0.003):    # 桥面半宽 3.4 m
            q = p + n * off
            ds = neighbor_diffs(at, q[0], q[1], d)
            if ds:
                deck_max.append(max(ds))

    deck_max = np.array(deck_max)
    print(f'\n=== 桥面内（应放行，{len(deck_max)} 个采样）===')
    for q in [50, 90, 95, 98, 99, 100]:
        print(f'  相邻格高差 p{q:5.1f} = {np.percentile(deck_max, q):7.3f} m')

    # -------------------------------------------------- 桥外崖壁（应当挡住）
    off_max = []
    for t in np.arange(0, L + 1e-9, L / 200):
        p = AX0 + u * t
        for off in [0.05, 0.06, 0.08, 0.10]:           # 桥面外 5.7~11.5 m
            for sgn in (1, -1):
                q = p + n * (off * sgn)
                ds = neighbor_diffs(at, q[0], q[1], d)
                if ds:
                    off_max.append(max(ds))

    off_max = np.array(off_max)
    if len(off_max):
        print(f'\n=== 桥外（应挡住，{len(off_max)} 个采样）===')
        for q in [5, 25, 50, 75, 95]:
            print(f'  相邻格高差 p{q:5.1f} = {np.percentile(off_max, q):7.3f} m')

    print('\n=== 阈值建议 ===')
    p98 = np.percentile(deck_max, 98)
    p99 = np.percentile(deck_max, 99)
    print(f'  要放行 98% 的桥面，maxStep 需 >= {p98:.2f} m')
    print(f'  要放行 99% 的桥面，maxStep 需 >= {p99:.2f} m')
    if len(off_max):
        p50o = np.percentile(off_max, 50)
        print(f'  桥外高差中位 {p50o:.2f} m —— 阈值低于它才能起到区分作用')
    print()
    print(f'  建议 maxStep = maxDrop = {np.ceil(p99):.0f} m')
    print('  （再配合桥面走廊 3.5 m，即使阈值宽松也不会走出桥）')

    np.savez(os.path.join(MODELS, '_step_stats.npz'),
             deck=deck_max, off=off_max)
    return 0


if __name__ == '__main__':
    sys.exit(main())
