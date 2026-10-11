"""
check_gaussian_extent.py — 检查桥面的高斯到底有多「虚」。

背景：高斯泼溅是一堆半透明椭球，不是面。判断「桥面看起来像雾」
是不是因为：
  a) 该处点太少（稀疏）
  b) 该处点的尺度（scale）太大（糊成一片）
  c) 该处确实没有点，只在别的视角补出来的

这里直接从 scene.ply 读原始高斯，统计桥面附近的点数密度与尺度。
"""

import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'models'))
PLY = os.path.join(MODELS, 'scene.ply')


def read_ply_header(f):
    """返回 (顶点数, 属性列表, 头部字节数)"""
    line = f.readline().decode('ascii', 'replace').strip()
    if line != 'ply':
        raise ValueError('不是 PLY 文件')

    fmt = None
    n = 0
    props = []
    in_vertex = False

    while True:
        raw = f.readline()
        if not raw:
            raise ValueError('头部未结束')
        s = raw.decode('ascii', 'replace').strip()

        if s.startswith('format'):
            fmt = s.split()[1]
        elif s.startswith('element vertex'):
            n = int(s.split()[2])
            in_vertex = True
        elif s.startswith('element'):
            in_vertex = False
        elif s.startswith('property') and in_vertex:
            props.append(s)
        elif s == 'end_header':
            break

    return n, props, fmt


def main():
    size = os.path.getsize(PLY)
    print(f'scene.ply: {size / 1024 / 1024:.1f} MB')

    with open(PLY, 'rb') as f:
        n, props, fmt = read_ply_header(f)
        header_end = f.tell()

    print(f'格式: {fmt}   顶点数: {n:,}')
    print(f'头部结束于 {header_end} 字节')

    per = (size - header_end) / n
    print(f'每点字节数: {per:.2f}')

    nprop = len(props)
    print(f'属性数: {nprop}')
    # 输出前几个属性名帮助确认布局
    names = [p.split()[-1] for p in props]
    print(f'属性名（前 12 个）: {names[:12]}')

    # 标准 3DGS：x y z nx ny nz f_dc_0..2 f_rest_0..44 opacity scale_0..2 rot_0..3
    # 3 + 3 + 3 + 45 + 1 + 3 + 4 = 62 float32 = 248 字节
    stride = int(round(per))
    xyz_dtype = np.dtype([
        ('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
    ])

    # 只在需要时读 scale：先定位 scale 属性的偏移
    # 属性顺序里 scale_0 的下标 -> 字节偏移
    try:
        si = names.index('scale_0')
    except ValueError:
        si = None
    print(f'scale_0 属性下标: {si}')

    n_read = min(n, 400_000)
    idx = np.linspace(0, n - 1, n_read).astype(np.int64)

    print(f'\n抽样读取 {n_read:,} 个点（均匀间隔）...')

    with open(PLY, 'rb') as f:
        base = header_end
        # 一次性把需要的字段读出来
        dt = np.dtype([(nm, '<f4') for nm in names])
        # 逐块读，避免大内存
        chunk = 200_000
        XYZ = []
        SCALE = []
        already = 0
        take = set(idx.tolist())

        f.seek(base)
        buf = f.read(stride * n)
        arr = np.frombuffer(buf, dtype=dt, count=n)

        P = np.stack([arr['x'], arr['y'], arr['z']], axis=1).astype(np.float64)
        if si is not None:
            S = np.stack([arr[f'scale_{k}'] for k in range(3)], axis=1).astype(np.float64)
            # 3DGS 里 scale 一般存的是 log 值
            S = np.exp(S)
            # 平均椭球半径（三个轴的几何平均 / 2 近似）
            Smean = S.mean(axis=1)

    print(f'读入点数: {len(P):,}')
    print(f'XYZ 范围: X[{P[:,0].min():.4f},{P[:,0].max():.4f}] '
          f'Y[{P[:,1].min():.4f},{P[:,1].max():.4f}] '
          f'Z[{P[:,2].min():.4f},{P[:,2].max():.4f}]')

    # 世界系：world_x = ply_x, world_y = -ply_y, world_z = -ply_z  (绕 X 转 180°)
    W = np.stack([P[:, 0], -P[:, 1], -P[:, 2]], axis=1)

    if si is not None:
        print(f'\n高斯尺度（已 exp 还原，单位=场景单位）:')
        print(f'  中位 {np.median(Smean):.6f}  均值 {Smean.mean():.6f}')
        print(f'  p10 {np.percentile(Smean, 10):.6f}  p90 {np.percentile(Smean, 90):.6f}')
        print(f'  按 115 米/单位换算: 中位 {np.median(Smean) * 115:.3f} m')
        print(f'  （1.7 m 的人若站在半径 >0.5 m 的高斯堆里，视觉上就会「糊进去」）')

    # ---------------------------------------------- 桥面附近的局部密度与尺度
    ax0 = np.array([-0.1556, 0.1905])
    ax1 = np.array([0.1546, -0.1468])
    axis = ax1 - ax0
    L = np.linalg.norm(axis)
    u = axis / L

    print('\n=== 沿桥轴的分段统计（点密度 / 高斯尺度）===')
    print(f'{"s(m)":>7} {"点数":>8} {"密度(个/m²)":>12} {"尺度中位(m)":>13}')

    for t in np.arange(0, L + 1e-9, 0.057):     # 约每 6.6 m
        p = ax0 + u * t
        # 用竖直圆柱取样：水平距离 4 m 内
        d = np.hypot(W[:, 0] - p[0], W[:, 2] - p[1])
        m = d < (4.0 / 115)
        cnt = int(m.sum())
        area = np.pi * (4.0 / 115) ** 2 * 115 ** 2      # 面积（m²）
        dens = cnt / area if area else 0.0
        if si is not None and cnt:
            sm = np.median(Smean[m]) * 115
            sms = f'{sm:13.3f}'
        else:
            sms = f'{"-":>13}'
        print(f'{t * 115:7.1f} {cnt:8d} {dens:12.1f} {sms}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
