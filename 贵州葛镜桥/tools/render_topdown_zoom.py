"""放大俯视图的桥区域，标出世界坐标刻度，用于精确定位桥面。

输出：web/models/_topdown_zoom.png
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT = r'E:\葛镜桥高斯\最新模型\web\models'

# 桥区域（世界坐标，由 _topdown.png 目测）
X0, X1 = -0.85, 0.35
Z0, Z1 = -0.95, 0.25


def main():
    W = np.load(os.path.join(OUT, '_ply_xyz.npy'))
    W = np.stack([W[:, 0], -W[:, 1], -W[:, 2]], axis=1)
    xi, yi, zi = W[:, 0], W[:, 1], W[:, 2]

    Wpx, Hpx = 1200, 900
    px = ((xi - X0) / (X1 - X0) * (Wpx - 1)).astype(np.int32)
    pz = ((zi - Z0) / (Z1 - Z0) * (Hpx - 1)).astype(np.int32)
    ok = (px >= 0) & (px < Wpx) & (pz >= 0) & (pz < Hpx)
    px, pz, yy = px[ok], pz[ok], yi[ok]

    ylo, yhi = np.percentile(yy, [2, 98])
    t = np.clip((yy - ylo) / max(yhi - ylo, 1e-9), 0, 1)
    r = np.clip(1.5 * t - 0.4, 0, 1)
    g = np.clip(1.4 - np.abs(t - 0.55) * 2.4, 0, 1)
    b = np.clip(1.2 - 2.2 * t, 0, 1) * 0.9 + 0.1

    acc = np.zeros((Hpx, Wpx), dtype=np.float32)
    colsum = np.zeros((Hpx, Wpx, 3), dtype=np.float32)
    np.add.at(acc, (pz, px), 1.0)
    for ch, col in enumerate((r, g, b)):
        np.add.at(colsum[:, :, ch], (pz, px), col)

    dn = np.log1p(acc); dn /= max(dn.max(), 1e-9)
    mean = colsum / np.maximum(acc, 1)[:, :, None]
    img = np.clip(mean * (0.35 + 0.65 * dn)[:, :, None] * 255, 0, 255).astype(np.uint8)
    img = img[::-1]                       # 翻转：行 0 = Z1（上）

    im = Image.fromarray(img)
    d = ImageDraw.Draw(im)

    # 画世界坐标网格：每 0.1 unit 一条
    step = 0.1
    x = X0
    while x <= X1 + 1e-9:
        cxp = (x - X0) / (X1 - X0) * (Wpx - 1)
        d.line([(cxp, 0), (cxp, Hpx)], fill=(90, 90, 110), width=1)
        d.text((cxp + 2, 4), f'{x:+.2f}', fill=(255, 255, 0))
        x = round(x + step, 4)
    z = Z0
    while z <= Z1 + 1e-9:
        cyp = (Hpx - 1) - (z - Z0) / (Z1 - Z0) * (Hpx - 1)
        d.line([(0, cyp), (Wpx, cyp)], fill=(90, 90, 110), width=1)
        d.text((4, cyp + 2), f'z{z:+.2f}', fill=(255, 255, 0))
        z = round(z + step, 4)

    im.save(os.path.join(OUT, '_topdown_zoom.png'))
    print('已保存 _topdown_zoom.png')
    print(f'世界 X {X0}..{X1}  Z {Z0}..{Z1}')
    print(f'像素/世界单位: 横向 {Wpx/(X1-X0):.0f}, 纵向 {Hpx/(Z1-Z0):.0f}')


if __name__ == '__main__':
    main()
