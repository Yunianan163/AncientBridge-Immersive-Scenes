"""在高度图里定位「桥面」——找出适合让角色行走的平坦高台。

高度图约定：
* heights 为长度 G*G 的扁平列表，行主序，索引 = iz*G + ix；无效格为 null。
* counts 为 G 行 x G 列的嵌套列表，语义同上。
* bounds 给出 (minX..maxX) x (minZ..maxZ) 的覆盖范围。

输出：桥面候选区域的中心与范围，用于 viewer 的出生点。
"""
import json
import os
import sys

import numpy as np

HM = r'E:\葛镜桥高斯\最新模型\web\models\heightmap.json'


def load():
    hm = json.load(open(HM, encoding='utf-8'))
    G = hm['gridSize']
    raw_h = hm['heights']
    H = np.full(G * G, np.nan, dtype=np.float64)
    for i, v in enumerate(raw_h):
        if v is not None:
            H[i] = v
    H = H.reshape(G, G)
    C = np.array(hm['counts'], dtype=np.int32)
    assert C.shape == (G, G), C.shape
    return hm, G, H, C


def main():
    hm, G, H, C = load()
    b = hm['bounds']
    xs = np.linspace(b['minX'], b['maxX'], G)
    zs = np.linspace(b['minZ'], b['maxZ'], G)
    valid = C >= 8
    print(f'网格 {G}x{G}, 有效格 {valid.sum()}')
    print(f'X {b["minX"]:.3f}..{b["maxX"]:.3f}  Z {b["minZ"]:.3f}..{b["maxZ"]:.3f}')
    print(f'高度范围 {np.nanmin(H):.4f} .. {np.nanmax(H):.4f}\n')

    # 逐层看每个高度带的分布位置
    print('高度分层 —— 每层的水平覆盖范围：')
    for lo_bin in range(9, -1, -1):
        lo = -0.30 + lo_bin * 0.06
        hi = lo + 0.06
        m = valid & (H > lo) & (H < hi)
        if m.sum() < 15:
            continue
        xi = np.where(m.any(axis=1))[0]
        zi = np.where(m.any(axis=0))[0]
        # 该层最密的位置
        idx = np.unravel_index(np.argmax(np.where(m, C, 0)), m.shape)
        print(f'  Y[{lo:+.2f},{hi:+.2f})  格 {m.sum():5d}   '
              f'X[{xs[xi.min()]:+.3f},{xs[xi.max()]:+.3f}] '
              f'Z[{zs[zi.min()]:+.3f},{zs[zi.max()]:+.3f}]   '
              f'最密 @({xs[idx[0]]:+.3f},{zs[idx[1]]:+.3f}) counts={C[idx]}')

    # 桥面判据：高度位于全场景 80 分位以上，且坡度小，且周边有连续平台
    hv = H[valid]
    thr = np.nanpercentile(hv, 80)
    print(f'\n全场景高度 80 分位 = {thr:.4f}')

    gy, gx = np.gradient(H)
    slope = np.hypot(np.nan_to_num(gx), np.nan_to_num(gy))
    flat = valid & (H > thr) & (slope < np.nanpercentile(slope[valid], 40))
    print(f'平坦高层格数 {flat.sum()}')
    if flat.sum():
        xi = np.where(flat.any(axis=1))[0]
        zi = np.where(flat.any(axis=0))[0]
        cx = float(xs[xi].mean()); cz = float(zs[zi].mean())
        print(f'  覆盖 X[{xs[xi.min()]:+.3f},{xs[xi.max()]:+.3f}] Z[{zs[zi.min()]:+.3f},{zs[zi.max()]:+.3f}]')
        print(f'  质心 ({cx:+.4f}, {cz:+.4f})')
        # 该区域平均高度
        print(f'  平均高度 {np.nanmean(H[flat]):.4f}')


if __name__ == '__main__':
    main()
