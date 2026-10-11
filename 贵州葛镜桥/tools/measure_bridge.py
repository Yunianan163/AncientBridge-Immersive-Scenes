"""精确测量葛镜桥（石拱桥）在世界坐标下的桥面轴线与范围。

做法：在俯视图里桥体表现为一条高亮直线。先在 XZ 平面圈出桥所在区域，
再用 PCA 拟合轴线，得到桥的起止点与长度（世界单位）。

真实对照：葛镜桥全长 51.44 m，桥面宽 8.5 m。
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT = r'E:\葛镜桥高斯\最新模型\web\models'


def main():
    W = np.load(os.path.join(OUT, '_ply_xyz.npy'))
    W = np.stack([W[:, 0], -W[:, 1], -W[:, 2]], axis=1)

    # 石桥大致区域（由 _topdown_zoom.png 目测）
    m = ((W[:, 0] > -0.30) & (W[:, 0] < 0.20) &
         (W[:, 2] > -0.20) & (W[:, 2] < 0.25))
    S = W[m]
    print(f'石桥候选区点数 {len(S)}')

    # 桥体应是窄条：用 XZ 密度找到最密的脊线
    # 先用 PCA 粗定方向
    c = S[:, [0, 2]].mean(0)
    u, s, vt = np.linalg.svd(S[:, [0, 2]] - c, full_matrices=False)
    print(f'粗 PCA 主方向 {vt[0].round(3)}  次方向 {vt[1].round(3)}')
    print(f'奇异值 {s.round(1)}  比值 {s[0]/max(s[1],1e-9):.2f}')

    axis = vt[0]
    perp = vt[1]
    proj = (S[:, [0, 2]] - c) @ axis
    offs = (S[:, [0, 2]] - c) @ perp

    # 桥是窄带：在中位轴线 ±0.03 内取点
    for half in (0.01, 0.02, 0.03, 0.05):
        band = np.abs(offs - np.median(offs)) < half
        if band.sum() < 30:
            continue
        p = proj[band]
        # 用 2-98 分位避免端点飞点
        lo, hi = np.percentile(p, [1, 99])
        length = float(hi - lo)
        print(f'  带宽±{half:.2f}: 点 {band.sum():6d}  长度 {length:.4f} unit'
              f'  -> {length * 122:.1f} m (@122)')

    # 用最窄的稳定带宽定轴
    band = np.abs(offs - np.median(offs)) < 0.02
    p = proj[band]
    lo, hi = np.percentile(p, [1, 99])
    p_lo, p_hi = c + axis * lo, c + axis * hi
    print(f'\n桥轴端点 (world XZ):')
    print(f'  起点 ({p_lo[0]:+.4f}, {p_lo[1]:+.4f})')
    print(f'  终点 ({p_hi[0]:+.4f}, {p_hi[1]:+.4f})')
    print(f'  长度 {float(hi-lo):.4f} unit')
    print(f'  中点 ({(p_lo[0]+p_hi[0])/2:+.4f}, {(p_lo[1]+p_hi[1])/2:+.4f})')

    # 桥面高度：取带内点的高度中位
    yb = S[band][:, 1]
    print(f'  桥面高度 中位 {np.median(yb):+.4f}  5-95% {np.percentile(yb, [5,95]).round(4)}')

    # 桥宽：垂直方向上的有效宽度
    o = offs[band]
    print(f'  带宽内垂直方向 5-95% 宽 {float(np.percentile(o,95)-np.percentile(o,5)):.4f} unit'
          f' -> {float(np.percentile(o,95)-np.percentile(o,5))*122:.2f} m (@122)')

    np.savez(os.path.join(OUT, '_bridge_axis.npz'),
             p0=p_lo, p1=p_hi, axis=axis, center=c,
             deck_y=float(np.median(yb)))
    print('\n已保存 _bridge_axis.npz')

    # 换算成真实尺度
    L = float(hi - lo)
    print(f'\n若桥全长按 51.44 m:  metersPerUnit = {51.44 / L:.1f}')
    print(f'若桥全长按 52.7  m:  metersPerUnit = {52.7 / L:.1f}')


if __name__ == '__main__':
    main()
