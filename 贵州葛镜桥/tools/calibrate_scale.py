"""用已解算的相机位姿 + 图像语义，标定场景真实尺度。

核心思路
--------
葛镜桥的真实尺寸有权威记载（茅以升《中国古桥技术史》等）：
    全长 51.44 m，桥面宽 8.5 m，高约 23~30 m
    主拱净跨 25.62 m，中拱 12.3 m，小拱 6.26 m
    拱高 9.61 / 7.9 / 5.02 m

只要能在 SfM 点云里量出「主拱净跨」对应的长度，就能得到 meters/unit。

步骤
----
1. 载入相机中心（SfM 坐标系，Z-up）。
2. 找出位于桥面上、朝主拱方向拍摄的帧（1/00057.jpg 是主拱正视图）。
3. 从该帧反投影：把图像中拱脚两点对应的视线与点云求交，得到拱脚 3D 位置。
   简化做法：用该帧的内点 3D 点，取其在「桥拱平面」内的水平跨度。

由于逐点语义标注成本高，这里改用更稳健的等效做法：
    * 用 1/00057 帧（主拱正视图）的内点云做平面拟合，得到桥拱立面。
    * 在该立面内找拱洞（点云的空洞）—— 最大空洞即主拱。
    * 量出空洞的水平宽度 = 主拱净跨（单位 unit）。
    * metersPerUnit = 25.62 / span_units
"""
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT = r'E:\葛镜桥高斯\最新模型\web\models'


def load():
    C = np.load(os.path.join(OUT, '_cam_centers_sfm.npy'))
    ok = np.load(os.path.join(OUT, '_cam_ok.npy'))
    names = np.load(os.path.join(OUT, '_cam_names.npy'), allow_pickle=True)
    return C, ok, names


def main():
    C, ok, names = load()
    print(f'相机总数 {len(C)}, 解算成功 {int(ok.sum())}')
    Cv = C[ok]
    # 转到 web world: world=(sfm_y, sfm_z, -sfm_x)
    Wc = np.stack([Cv[:, 1], Cv[:, 2], -Cv[:, 0]], axis=1)
    print('相机中心(world) 范围')
    for i, n in enumerate('XYZ'):
        print(f'  {n} {Wc[:,i].min():+.3f} .. {Wc[:,i].max():+.3f}')
    print('轨迹总长(world):', round(float(np.linalg.norm(np.diff(Wc, axis=0), axis=1).sum()), 2), 'unit')

    # 高度分布：桥面上的相机应在桥面高度附近
    y = Wc[:, 1]
    print('相机高度分位:', np.percentile(y, [5, 25, 50, 75, 95]).round(4))

    # 相邻帧位移（用于步长/尺度）
    steps = np.linalg.norm(np.diff(Wc, axis=0), axis=1)
    keep = steps[steps > 0]
    print('帧间位移中位:', round(float(np.median(keep)), 5), ' mean:', round(float(keep.mean()), 5))

    np.save(os.path.join(OUT, '_cam_world.npy'), Wc)


if __name__ == '__main__':
    main()
