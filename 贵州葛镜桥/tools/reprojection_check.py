# -*- coding: utf-8 -*-
"""
reprojection_check.py —— 重训数据预检：验证转换后 COLMAP 的相机参数解释是否正确

原理：COLMAP 的 images.bin 里存了每张图像对 3D 点的 2D 观测（像素坐标）。
用 cameras.bin 的内参 + 畸变系数把 3D 点投影回像素，与观测值比对：
  平均重投影误差 ≈ 1~3 px → 参数解释正确，2DGS/PGSR 可直接用；
  误差巨大 → 参数顺序推断错了，训练前必须修正（否则不收敛）。

同时测试两种候选解释：
  A: OPENCV 标准顺序 fx,fy,cx,cy,k1,k2,p1,p2（Spirula 文件实际采用）
  B: 忽略畸变当 PINHOLE 用（对照组，看畸变量是否真实存在）
"""
import struct
import numpy as np

SPARSE = r'E:\葛镜桥高斯\2DGS重训\model1\sparse\0'


def quat_to_rot(q):
    """COLMAP 四元数 (w,x,y,z) → 3x3 旋转矩阵"""
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def read_cameras(path):
    MODELS = {5: ('OPENCV', 8)}
    out = {}
    with open(path, 'rb') as f:
        num = struct.unpack('<Q', f.read(8))[0]
        for _ in range(num):
            cid, mid, w, h = struct.unpack('<iiQQ', f.read(24))
            name, n = MODELS[mid]
            params = struct.unpack('<' + 'd' * n, f.read(8 * n))
            out[cid] = (w, h, params)
    return out


def read_images(path, max_images=40):
    imgs = []
    with open(path, 'rb') as f:
        num = struct.unpack('<Q', f.read(8))[0]
        step = max(1, num // max_images)
        for i in range(num):
            iid, = struct.unpack('<i', f.read(4))
            q = struct.unpack('<4d', f.read(32))
            t = struct.unpack('<3d', f.read(24))
            cid, = struct.unpack('<i', f.read(4))
            name = b''
            while True:
                ch = f.read(1)
                if ch == b'\x00':
                    break
                name += ch
            n2d, = struct.unpack('<Q', f.read(8))
            if i % step == 0 and len(imgs) < max_images:
                raw = f.read(n2d * 24)
                arr = np.frombuffer(raw, np.uint64).reshape(-1, 3) if False else None
                # 逐条解包 (x: double, y: double, id: int64)
                obs = np.frombuffer(raw, np.uint8).reshape(n2d, 24)
                xs = np.frombuffer(obs[:, 0:8].tobytes(), np.float64)
                ys = np.frombuffer(obs[:, 8:16].tobytes(), np.float64)
                ids = np.frombuffer(obs[:, 16:24].tobytes(), np.int64)
                imgs.append((iid, cid, q, t, name.decode(), xs, ys, ids))
            else:
                f.read(n2d * 24)
        left = f.read()
    assert len(left) == 0, f'images.bin 解析没对齐，残留 {len(left)} 字节'
    return imgs


def read_points3d(path):
    pts = {}
    with open(path, 'rb') as f:
        num = struct.unpack('<Q', f.read(8))[0]
        for _ in range(num):
            pid, x, y, z, r, g, b, err = struct.unpack('<QdddBBBd', f.read(43))
            nt, = struct.unpack('<Q', f.read(8))
            f.read(nt * 8)
            pts[pid] = (x, y, z)
    return pts


def project(X, R, t, params, use_dist):
    """X: (N,3) world → 像素 (u,v)。OPENCV 畸变。"""
    xc = X @ R.T + t
    z = xc[:, 2]
    ok = z > 1e-6
    xn = xc[:, 0] / np.where(ok, z, 1)
    yn = xc[:, 1] / np.where(ok, z, 1)
    if use_dist:
        fx, fy, cx, cy, k1, k2, p1, p2 = params
        r2 = xn * xn + yn * yn
        rad = 1 + k1 * r2 + k2 * r2 * r2
        tx = 2 * p1 * xn * yn + p2 * (r2 + 2 * xn * xn)
        ty = p1 * (r2 + 2 * yn * yn) + 2 * p2 * xn * yn
        xd, yd = xn * rad + tx, yn * rad + ty
    else:
        fx, fy, cx, cy = params[:4]
        xd, yd = xn, yn
    return fx * xd + cx, fy * yd + cy, ok


def main():
    cams = read_cameras(SPARSE + r'\cameras.bin')
    imgs = read_images(SPARSE + r'\images.bin')
    pts = read_points3d(SPARSE + r'\points3D.bin')
    print(f'{len(imgs)} 张抽样图（共 {len(cams)} 相机 / 1378 图 / {len(pts)} 3D 点）')

    for use_dist, tag in [(True, 'A: OPENCV 带畸变(k1,k2,p1,p2)'),
                          (False, 'B: 忽略畸变当 PINHOLE（对照）')]:
        errs = []
        for (iid, cid, q, t, name, xs, ys, ids) in imgs:
            params = cams[cid][2]
            R = quat_to_rot(q)
            valid = ids > 0
            if not valid.any():
                continue
            pid = ids[valid]
            X = np.array([pts[p] for p in pid if p in pts])
            if len(X) < 10:
                continue
            u, v, ok = project(X, R, t, params, use_dist)
            uo, vo = xs[valid][:len(X)], ys[valid][:len(X)]
            e = np.hypot(u - uo, v - vo)
            errs.append(e[ok & (e < 500)])
        e = np.concatenate(errs)
        print(f'{tag}: 平均 {e.mean():.2f} px | 中位 {np.median(e):.2f} px | '
              f'p95 {np.quantile(e, .95):.2f} px | 样本 {len(e):,}')


if __name__ == '__main__':
    main()
