"""
verify_deck_fix.py — 验证改用 p80 后，桥面在高度图里是否连续可走。

判定标准不再用「与轴心高差」（那个阈值太宽松，会把河床也算进来），
而是直接检查：
  1. 沿桥轴是否处处有值（无断裂）
  2. 相邻采样点的高度跳变是否在合理范围（人走上去不会瞬移）
  3. 高度剖面是否呈「两端高、跨中低」的拱桥形态
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'models'))

AX0 = np.array([-0.1556, 0.1905])
AX1 = np.array([0.1546, -0.1468])
MPU = 115.0


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
    pct = hm.get('percentile', '?')

    def at(x, z):
        if not (mnx <= x <= mxx and mnz <= z <= mxz):
            return np.nan
        ix = int(round((x - mnx) / cw))
        iz = int(round((z - mnz) / ch))
        if not (0 <= ix < g and 0 <= iz < g):
            return np.nan
        return H[iz, ix]

    return at, pct


def profile(at, label):
    u = (AX1 - AX0) / np.linalg.norm(AX1 - AX0)
    L = np.linalg.norm(AX1 - AX0)
    step = 0.002                       # 约 0.23 m，比格距更密

    hs = []
    ss = []
    for t in np.arange(0, L + 1e-9, step):
        p = AX0 + u * t
        ss.append(t * MPU)
        hs.append(at(p[0], p[1]))

    hs = np.array(hs)
    ss = np.array(ss)

    nulls = np.isnan(hs)
    print(f'\n=== {label} ===')
    print(f'采样点: {len(hs)}   无数据(null): {int(nulls.sum())} '
          f'({100 * nulls.mean():.1f}%)')

    ok = ~nulls
    if ok.sum() < 2:
        print('  全程几乎无数据')
        return None

    vals = hs[ok] * MPU
    print(f'高度范围: {vals.min():+.2f} ~ {vals.max():+.2f} m')

    # 相邻跳变
    if ok.sum() > 1:
        diffs = np.abs(np.diff(hs[ok])) * MPU
        print(f'相邻采样高差: 中位 {np.median(diffs):.3f} m  '
              f'p95 {np.percentile(diffs, 95):.3f} m  '
              f'max {diffs.max():.3f} m')
        big = (diffs > 2.0).sum()
        print(f'  跳变 > 2 m 的次数: {big}'
              + ('   <== 有瞬移风险' if big > 0 else '   <== 平滑'))

    return ss, hs * MPU


def main():
    cur, pct_cur = load(os.path.join(MODELS, 'heightmap.json'))
    print(f'当前高度图采用的分位数: p{pct_cur}')

    res = profile(cur, f'改用 p{pct_cur} 后的桥面剖面')

    # 拱形判据：两端应高于跨中
    if res:
        ss, hs = res
        mid = (ss > 18) & (ss < 35)
        ends = ((ss > 0) & (ss < 6)) | ((ss > 46) & (ss < 52.7))
        if mid.any() and ends.any():
            hm_ = np.nanmedian(hs[mid])
            he = np.nanmedian(hs[ends])
            print(f'\n拱形检查: 跨中中位 {hm_:+.2f} m, 两端中位 {he:+.2f} m, '
                  f'差 {he - hm_:+.2f} m')
            if he > hm_:
                print('  → 两端高于跨中，符合拱桥形态 ✓')
            else:
                print('  → 形态异常，需要复查 ✗')

    print('\n参考：葛镜桥主拱净跨 25.62 m，全长 51.44 m，桥面实宽 8.5 m')
    return 0


if __name__ == '__main__':
    sys.exit(main())
