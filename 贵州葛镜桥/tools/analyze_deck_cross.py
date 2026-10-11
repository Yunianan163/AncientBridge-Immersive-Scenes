"""
analyze_deck_cross.py — 沿整座桥逐个横截面统计「桥面平台」的真实宽度。

判定「属于桥面」的标准：与桥轴处高度差 < 0.02 单位（约 2.3 m），
且该格有点。这样能把桥面平台和两侧的崖壁/空气区分开。

输出每 5 m 一个采样，并给出统计量 —— 用来判断人物走多偏会掉下去。
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'models'))


def main():
    hm = json.load(open(os.path.join(MODELS, 'heightmap.json'), 'r', encoding='utf-8'))
    g = hm['gridSize']
    bd = hm['bounds']
    minx, maxx, minz, maxz = bd['minX'], bd['maxX'], bd['minZ'], bd['maxZ']
    cw = (maxx - minx) / (g - 1)
    ch = (maxz - minz) / (g - 1)
    step = (cw + ch) / 2

    H = np.full(g * g, np.nan)
    for i, v in enumerate(hm['heights']):
        if v is not None:
            H[i] = v
    H = H.reshape(g, g)

    def cell(x, z):
        return (int(round((x - minx) / cw)), int(round((z - minz) / ch)))

    def height(x, z):
        ix, iz = cell(x, z)
        if not (0 <= ix < g and 0 <= iz < g):
            return np.nan
        return H[iz, ix]

    ax0 = np.array([-0.1556, 0.1905])
    ax1 = np.array([0.1546, -0.1468])
    axis = ax1 - ax0
    L = np.linalg.norm(axis)
    u = axis / L
    n = np.array([-u[1], u[0]])

    DECK_TOL = 0.02            # 与轴心高度差在 2.3 m 内算同一平台
    MAX_SCAN = 0.25            # 单侧最多扫 28.75 m

    print(f'桥面平台宽度统计  (判定阈值: 与轴心高差 < {DECK_TOL * 115:.1f} m)')
    print(f'{"s(m)":>7} {"h轴心":>10} {"左(m)":>8} {"右(m)":>8} {"总宽(m)":>9}')
    print('-' * 48)

    widths = []
    for t in np.arange(0, L + 1e-9, 0.043):        # 约每 5 m 采样
        p = ax0 + u * t
        h0 = height(p[0], p[1])
        if np.isnan(h0):
            print(f'{t * 115:7.1f} {"null":>10} {"-":>8} {"-":>8} {"-":>9}')
            continue

        left = 0.0
        while left < MAX_SCAN:
            left += step
            q = p - n * left
            hq = height(q[0], q[1])
            if np.isnan(hq) or abs(hq - h0) > DECK_TOL:
                left -= step
                break

        right = 0.0
        while right < MAX_SCAN:
            right += step
            q = p + n * right
            hq = height(q[0], q[1])
            if np.isnan(hq) or abs(hq - h0) > DECK_TOL:
                right -= step
                break

        total = (left + right) * 115
        widths.append(total)
        mark = ''
        if total < 3.0:
            mark = '  <== 极窄'
        elif total < 8.5:
            mark = '  <== 窄于实宽 8.5 m'
        print(f'{t * 115:7.1f} {h0:+10.5f} {left * 115:8.1f} {right * 115:8.1f} {total:9.1f}{mark}')

    widths = np.array(widths)
    print('-' * 48)
    print(f'中位宽度: {np.median(widths):.1f} m')
    print(f'最小宽度: {widths.min():.1f} m')
    print(f'最大宽度: {widths.max():.1f} m')
    print(f'窄于 4 m 的比例: {100 * (widths < 4).mean():.1f}%')
    print(f'窄于 8.5 m 的比例: {100 * (widths < 8.5).mean():.1f}%')
    print()
    print('葛镜桥桥面实宽 8.5 m。上表中「宽」超过 20 m 的段落，')
    print('说明那里高度图已经把两侧崖壁/河岸连成了同一平台，')
    print('人物走上去不会掉 —— 但视觉上他已经离开桥了。')

    return 0


if __name__ == '__main__':
    sys.exit(main())
