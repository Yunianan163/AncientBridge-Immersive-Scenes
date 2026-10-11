"""
probe_deck_surface.py — 用「顶部点」探测真实的桥面高度剖面与可站立宽度

核心思路
    沿桥轴取一小段（沿轴 ±0.9 m），横向扫 ±10 m，得到该处所有点。
    这些点里同时包含：
      · 真实桥面（高度靠上，集中）
      · 桥下的河床 / 崖壁 / 远景（高度靠下，弥散）

    取 p80 分位数作为桥面高度 —— 实测证明顶部 25% 的点高度极差仅 1.5 m，
    说明顶部那一簇就是真实桥面；而 p80 落在这一簇内，不会碰到下面的河床。

    再统计「高度在桥面 ±1 m 内」的点在横向上覆盖多宽 —— 这就是人真正
    能站住的宽度。桥面实宽 8.5 m，若这个宽度接近 8.5 m，说明数据是好的。
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_heightmap import euler_xyz_matrix, load_positions   # noqa: E402

MODELS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       '..', 'models'))

AX0 = np.array([-0.1556, 0.1905])
AX1 = np.array([0.1546, -0.1468])

MPU = 115.0            # 米/单位
PERCENTILE = 80        # 取高度的分位数，代表桥面
TOL_M = 1.0            # 「算同一平台」的高度容差（米）


def main():
    print('读取点云…')
    x, y, z, props = load_positions(os.path.join(MODELS, 'scene.ply'))
    m = euler_xyz_matrix([180, 0, 0])
    pts = m @ np.stack([x, y, z])
    x, y, z = pts[0], pts[1], pts[2]
    print(f'  点数 {len(x):,}')

    u = (AX1 - AX0) / np.linalg.norm(AX1 - AX0)
    n = np.array([-u[1], u[0]])
    L = np.linalg.norm(AX1 - AX0)

    # 预先算好每个点相对桥轴的（纵向, 横向）偏移，后面反复用
    dx = x - AX0[0]
    dz = z - AX0[1]
    lon_all = dx * u[0] + dz * u[1]
    lat_all = dx * n[0] + dz * n[1]

    print()
    print('沿桥轴探测（p%d 为桥面高度，容差 %.1f m）' % (PERCENTILE, TOL_M))
    print(f'{"s(m)":>7} {"桥面高(m)":>10} {"横向核心带宽(m)":>15} {"核心点数":>9}  判断')
    print('-' * 68)

    half_lon = 0.9 / MPU
    rows = []

    for t in np.arange(0.015, L, 0.018):
        sel = (np.abs(lon_all - t) < half_lon) & (np.abs(lat_all) < 0.09)
        cnt = int(sel.sum())
        if cnt < 100:
            print(f'{t * MPU:7.1f} {"—":>10} {"—":>15} {cnt:9d}  点太少')
            continue

        yy = y[sel]
        lat = lat_all[sel]
        h_deck = np.percentile(yy, PERCENTILE)

        core = np.abs(yy - h_deck) < (TOL_M / MPU)
        if core.sum() < 20:
            print(f'{t * MPU:7.1f} {h_deck * MPU:+10.2f} {"< 1.0":>15} '
                  f'{int(core.sum()):9d}  无连续平台')
            continue

        dc = lat[core]
        width = (dc.max() - dc.min()) * MPU
        rows.append((t * MPU, h_deck * MPU, width))

        verdict = ''
        if width >= 7.0:
            verdict = '接近实宽 8.5 m'
        elif width >= 4.0:
            verdict = '可用但偏窄'
        else:
            verdict = '过窄 / 断裂'

        print(f'{t * MPU:7.1f} {h_deck * MPU:+10.2f} {width:15.1f} '
              f'{int(core.sum()):9d}  {verdict}')

    if not rows:
        print('\n没有采集到任何有效剖面')
        return 1

    arr = np.array(rows)
    print('-' * 68)
    print(f'桥面高: 中位 {np.median(arr[:, 1]):+.2f} m  '
          f'范围 {arr[:, 1].min():+.2f} ~ {arr[:, 1].max():+.2f} m')
    print(f'核心带宽: 中位 {np.median(arr[:, 2]):.1f} m  '
          f'最小 {arr[:, 2].min():.1f} m  '
          f'最大 {arr[:, 2].max():.1f} m')
    print(f'带宽 >= 7 m 的比例: {100 * (arr[:, 2] >= 7).mean():.1f}%')
    print(f'带宽 <  4 m 的比例: {100 * (arr[:, 2] < 4).mean():.1f}%')
    print()
    print('桥面实宽 8.5 m。带宽接近 8.5 m 说明点云里桥面是完整可用的，')
    print('之前高度图之所以乱，是分位数取错了（中位/p20 被下方河床拉偏）。')

    np.savez(os.path.join(MODELS, '_deck_surface.npz'),
             s=arr[:, 0], h=arr[:, 1], w=arr[:, 2])
    print('\n已保存剖面到 models/_deck_surface.npz')
    return 0


if __name__ == '__main__':
    sys.exit(main())
