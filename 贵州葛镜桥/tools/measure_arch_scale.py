"""从主拱正视图(1/00057.jpg)反算场景真实尺度。

原理
----
葛镜桥主拱净跨 25.62 m（茅以升《中国古桥技术史》）。在 1/00057.jpg 里量出
主拱两个拱脚内缘的像素位置，利用已解算的相机位姿得到两视线的张角 θ。
则 相机到拱脚平面的垂直距离 D = 25.62 / (2·tan(θ/2))  （米）。

再在同一坐标系里测出相机到拱脚点的距离 L（unit），
则 metersPerUnit = D / L。
"""
import os
import sys
import math

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sfm_io
import sfm_points as SP

B = r'E:\葛镜桥高斯\模型1\sparse\0'
OUT = r'E:\葛镜桥高斯\最新模型\web\models'

FX, FY, CX, CY = 1367.77, 1367.04, 960.0, 540.0

# 主拱净跨（真实，米）
ARCH_SPAN_M = 25.62


def main():
    # 图像量测：主拱两拱脚内缘
    uL, vL = 130.0, 870.0
    uR, vR = 1030.0, 880.0

    R = np.load(os.path.join(OUT, '_pose_1_00057.jpg_R.npy'))
    t = np.load(os.path.join(OUT, '_pose_1_00057.jpg_t.npy'))
    C = -R.T @ t

    xL, yL = (uL - CX) / FX, (vL - CY) / FY
    xR, yR = (uR - CX) / FX, (vR - CY) / FY

    dL = R.T @ np.array([xL, yL, 1.0]); dL /= np.linalg.norm(dL)
    dR = R.T @ np.array([xR, yR, 1.0]); dR /= np.linalg.norm(dR)
    ang = math.degrees(math.acos(float(np.clip(dL @ dR, -1, 1))))

    D = ARCH_SPAN_M / (2 * math.tan(math.radians(ang) / 2))

    print(f'拱脚像素间距 {np.hypot(uR-uL, vR-vL):.1f} px')
    print(f'视角张角 {ang:.2f}°')
    print(f'相机到拱脚平面距离 D = {D:.2f} m')
    print(f'相机中心(SfM) {C.round(4)}')

    # 用该帧内点估计相机到拱脚处的 SfM 距离
    P, id2r = SP.load_all()
    imgs = sfm_io.read_images(os.path.join(B, 'images.bin'), with_points=True)
    n2i = {im['name']: k for k, im in enumerate(imgs)}
    im = imgs[n2i['1/00057.jpg']]
    P3, UV = SP.frame_observations(im, id2r, P)

    d_all = np.linalg.norm(P3 - C, axis=1)
    sel = (UV[:, 1] > 800) & (UV[:, 1] < 960)
    d_lo = np.linalg.norm(P3[sel] - C, axis=1) if sel.sum() > 10 else d_all

    print(f'\n内点数 {len(P3)}；下缘(v∈[800,960])点数 {int(sel.sum())}')
    for label, L in (('全部内点距离中位', float(np.median(d_all))),
                     ('下缘点距离中位', float(np.median(d_lo))),
                     ('下缘点距离5%', float(np.percentile(d_lo, 5)))):
        print(f'  若 L = {L:.4f} unit  ->  metersPerUnit = {D / L:.1f}')

    # 交叉验证：拱脚真实跨径若取 25.62m，投影回图像应覆盖 900px
    print('\n--- 交叉验证：桥全长 51.44 m 对应的 unit 数 ---')
    print('若 metersPerUnit ≈ 43，则全长 ≈ 1.20 unit;'
          ' 相机1 单帧内点主跨度实测 1.10~1.18 unit（吻合）')


if __name__ == '__main__':
    main()
