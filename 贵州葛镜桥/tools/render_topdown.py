"""把点云俯视图渲染成 PNG，并把已知相机位置标上去，用于人工判读桥面位置。

输出：web/models/_topdown.png
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT = r'E:\葛镜桥高斯\最新模型\web\models'


def main():
    W = np.load(os.path.join(OUT, '_ply_xyz.npy'))
    W = np.stack([W[:, 0], -W[:, 1], -W[:, 2]], axis=1)      # -> web world (Y up)

    # 用高度着色渲染俯视图
    xi = W[:, 0]; zi = W[:, 2]; yi = W[:, 1]
    lo, hi = np.percentile(xi, [0.3, 99.7])
    lo2, hi2 = np.percentile(zi, [0.3, 99.7])
    Wpx, Hpx = 900, 620
    px = ((xi - lo) / (hi - lo) * (Wpx - 1)).astype(np.int32)
    pz = ((zi - lo2) / (hi2 - lo2) * (Hpx - 1)).astype(np.int32)
    ok = (px >= 0) & (px < Wpx) & (pz >= 0) & (pz < Hpx)
    px, pz, yy = px[ok], pz[ok], yi[ok]

    # 颜色：按高度映射 蓝(低) -> 青 -> 绿 -> 黄(高)
    ylo, yhi = np.percentile(yy, [2, 98])
    t = np.clip((yy - ylo) / max(yhi - ylo, 1e-9), 0, 1)
    r = np.clip(1.5 * t - 0.4, 0, 1)
    g = np.clip(1.4 - np.abs(t - 0.55) * 2.4, 0, 1)
    b = np.clip(1.2 - 2.2 * t, 0, 1) * 0.9 + 0.1

    canvas = np.zeros((Hpx, Wpx, 3), dtype=np.float32)
    # 累积密度（对数），用于突出密集结构
    acc = np.zeros((Hpx, Wpx), dtype=np.float32)
    colsum = np.zeros((Hpx, Wpx, 3), dtype=np.float32)
    np.add.at(acc, (pz, px), 1.0)
    for ch, col in enumerate((r, g, b)):
        np.add.at(colsum[:, :, ch], (pz, px), col)

    dens = np.log1p(acc)
    dn = dens / max(dens.max(), 1e-9)
    mean = colsum / np.maximum(acc, 1)[:, :, None]

    for ch in range(3):
        canvas[:, :, ch] = mean[:, :, ch] * (0.35 + 0.65 * dn)

    img = np.clip(canvas * 255, 0, 255).astype(np.uint8)
    img = img[::-1]      # 图像 y 向下，z 向上

    # 叠加相机轨迹（世界坐标 -> 像素）；文件不存在就跳过
    cam_path = os.path.join(OUT, '_cam_world.npy')
    if os.path.exists(cam_path):
        C = np.load(cam_path)
        cx = ((C[:, 0] - lo) / (hi - lo) * (Wpx - 1)).astype(np.int32)
        cz = ((C[:, 2] - lo2) / (hi2 - lo2) * (Hpx - 1)).astype(np.int32)
        czd = (Hpx - 1) - cz
        for k in range(len(C) - 1):
            if 0 <= cx[k] < Wpx and 0 <= czd[k] < Hpx and 0 <= cx[k+1] < Wpx and 0 <= czd[k+1] < Hpx:
                n = max(abs(cx[k+1]-cx[k]), abs(czd[k+1]-czd[k]), 1)
                for s in range(n + 1):
                    xx = int(cx[k] + (cx[k+1]-cx[k]) * s / n)
                    yy2 = int(czd[k] + (czd[k+1]-czd[k]) * s / n)
                    if 0 <= xx < Wpx and 0 <= yy2 < Hpx:
                        img[yy2, xx] = [255, 60, 60]
    else:
        print('（未找到 _cam_world.npy，跳过相机轨迹叠加）')

    try:
        from PIL import Image
        Image.fromarray(img).save(os.path.join(OUT, '_topdown.png'))
        print('已保存 _topdown.png', img.shape)
    except ImportError:
        np.save(os.path.join(OUT, '_topdown.npy'), img)
        print('无 PIL，已存 _topdown.npy')

    print(f'世界 X 范围画到 {lo:.3f}..{hi:.3f}（列 0..{Wpx}）')
    print(f'世界 Z 范围画到 {lo2:.3f}..{hi2:.3f}（行 0..{Hpx}，上=+Z）')


if __name__ == '__main__':
    main()
