"""
compare_layers.py — 对比粗层 / 细层高度图在桥面的「可用平台宽度」。

这是判断细层是否解决问题的关键验证：如果细层让桥面可用宽度从 5 m 提升到
接近实宽 8.5 m，并且断裂处消失，那么「走偏就掉下去」的根因就被消除了。
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'models'))

AX0 = np.array([-0.1556, 0.1905])
AX1 = np.array([0.1546, -0.1468])
DECK_TOL = 0.02          # 与轴心高差 < 2.3 m 算同一平台


class Layer:
    def __init__(self, path, name):
        hm = json.load(open(path, 'r', encoding='utf-8'))
        self.name = name
        self.g = hm['gridSize']
        bd = hm['bounds']
        self.minx, self.maxx = bd['minX'], bd['maxX']
        self.minz, self.maxz = bd['minZ'], bd['maxZ']
        self.cw = (self.maxx - self.minx) / (self.g - 1)
        self.ch = (self.maxz - self.minz) / (self.g - 1)
        self.H = np.full(self.g * self.g, np.nan)
        for i, v in enumerate(hm['heights']):
            if v is not None:
                self.H[i] = v
        self.H = self.H.reshape(self.g, self.g)
        self.region_area = (self.maxx - self.minx) * (self.maxz - self.minz) * 115 ** 2

    def covers(self, x, z):
        return (self.minx <= x <= self.maxx) and (self.minz <= z <= self.maxz)

    def height(self, x, z):
        if not self.covers(x, z):
            return np.nan
        ix = int(round((x - self.minx) / self.cw))
        iz = int(round((z - self.minz) / self.ch))
        if not (0 <= ix < self.g and 0 <= iz < self.g):
            return np.nan
        return self.H[iz, ix]

    @property
    def step(self):
        return (self.cw + self.ch) / 2


def analyze(layer, limit_to_region=False):
    axis = AX1 - AX0
    L = np.linalg.norm(axis)
    u = axis / L
    n = np.array([-u[1], u[0]])

    widths = []
    for t in np.arange(0, L + 1e-9, 0.043):
        p = AX0 + u * t
        if limit_to_region and not layer.covers(p[0], p[1]):
            continue
        h0 = layer.height(p[0], p[1])
        if np.isnan(h0):
            widths.append(0.0)
            continue

        left = 0.0
        while left < 0.25:
            left += layer.step
            q = p - n * left
            hq = layer.height(q[0], q[1])
            if np.isnan(hq) or abs(hq - h0) > DECK_TOL:
                left -= layer.step
                break

        right = 0.0
        while right < 0.25:
            right += layer.step
            q = p + n * right
            hq = layer.height(q[0], q[1])
            if np.isnan(hq) or abs(hq - h0) > DECK_TOL:
                right -= layer.step
                break

        widths.append((left + right) * 115)

    return np.array(widths)


def main():
    coarse = Layer(os.path.join(MODELS, 'heightmap.json'), '粗层 256²')
    fine = Layer(os.path.join(MODELS, 'heightmap_deck.json'), '细层 512²(桥面区)')

    print('=' * 62)
    print('桥面「可用平台宽度」对比   判定：与轴心高差 < 2.3 m')
    print('=' * 62)
    print(f'{"":22} {"粗层 256²":>14} {"细层 512²":>14}')
    print('-' * 62)

    rows = [
        ('格距 (m)', f'{coarse.step * 115:.3f}', f'{fine.step * 115:.3f}'),
    ]

    wc = analyze(coarse)
    wf = analyze(fine)

    rows.append(('可用宽度 中位 (m)', f'{np.median(wc):.1f}', f'{np.median(wf):.1f}'))
    rows.append(('可用宽度 最小 (m)', f'{wc.min():.1f}', f'{wf.min():.1f}'))
    rows.append(('不足 4 m 的比例', f'{100 * (wc < 4).mean():.1f}%', f'{100 * (wf < 4).mean():.1f}%'))
    rows.append(('不足 8.5 m 的比例', f'{100 * (wc < 8.5).mean():.1f}%', f'{100 * (wf < 8.5).mean():.1f}%'))
    rows.append(('完全断裂处数', f'{int((wc < 0.5).sum())}', f'{int((wf < 0.5).sum())}'))

    for a, b, c in rows:
        print(f'{a:22} {b:>14} {c:>14}')

    print('-' * 62)
    print(f'桥面实宽 8.5 m。细层把可用宽度从 {np.median(wc):.1f} m 提到 {np.median(wf):.1f} m。')

    # ------------------------------------------------ 逐段对比（看断裂处是否补上）
    print('\n=== 逐段对比（每约 5 m）===')
    print(f'{"s(m)":>7} {"粗层宽(m)":>11} {"细层宽(m)":>11}  {"":<4}')
    print('-' * 48)
    step_n = max(1, len(wc) // 11)
    for i in range(0, len(wc), step_n):
        s = i / (len(wc) - 1) * np.linalg.norm(AX1 - AX0) * 115
        mark = ''
        if wc[i] < 0.5 <= wf[i]:
            mark = '<== 断裂已补上'
        elif wc[i] < 4 <= wf[i]:
            mark = '<== 已拓宽'
        print(f'{s:7.1f} {wc[i]:11.1f} {wf[i]:11.1f}  {mark}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
