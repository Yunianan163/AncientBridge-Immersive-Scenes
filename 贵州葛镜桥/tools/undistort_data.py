# -*- coding: utf-8 -*-
"""
undistort_data.py —— 用 OpenCV 完成 COLMAP image_undistorter 的活
（免去用户安装 COLMAP Windows 版）

输入: E:\葛镜桥高斯\2DGS重训\model1            (OPENCV 畸变模型)
输出: E:\葛镜桥高斯\2DGS重训\model1_undistort   (PINHOLE 无畸变, 2DGS 直吃)

做法:
  1) 读 cameras.bin (OPENCV: fx,fy,cx,cy,k1,k2,p1,p2)
  2) 每台相机 initUndistortRectifyMap 生成映射表, K 保持不变
  3) 多进程并行对 1378 张已注册图重采样(保持目录结构)
  4) sparse 重写: cameras.bin -> PINHOLE(id=2, fx,fy,cx,cy)
     images.bin / points3D.bin 原样复制
  5) 抽 1 张存前后对比图供人眼检查
"""
import struct
import shutil
import sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

import cv2
import numpy as np

SRC = Path(r'E:\葛镜桥高斯\2DGS重训\model1')
DST = Path(r'E:\葛镜桥高斯\2DGS重训\model1_undistort')
MODELS = {1: 3, 2: 4, 3: 4, 4: 5, 5: 8}


def read_cameras(path):
    raw = path.read_bytes()
    num = struct.unpack_from('<Q', raw, 0)[0]
    off = 8
    cams = {}
    for _ in range(num):
        cid, mid, w, h = struct.unpack_from('<iiQQ', raw, off); off += 24
        n = MODELS[mid]
        p = struct.unpack_from('<' + 'd' * n, raw, off); off += 8 * n
        cams[cid] = (w, h, p)
    assert off == len(raw)
    return cams


def read_images_bin(path):
    raw = path.read_bytes()
    num = struct.unpack_from('<Q', raw, 0)[0]
    off = 8
    out = []
    for _ in range(num):
        iid, = struct.unpack_from('<i', raw, off); off += 4
        off += 32 + 24                          # qvec, tvec
        cid, = struct.unpack_from('<i', raw, off); off += 4
        end = raw.index(b'\x00', off)
        name = raw[off:end].decode(); off = end + 1
        npts, = struct.unpack_from('<Q', raw, off); off += 8 + npts * 24
        out.append((iid, cid, name))
    assert off == len(raw)
    return out


def imread_unicode(p):
    """cv2.imread 在 Windows 上读不了中文路径，用 imdecode 绕过。"""
    return cv2.imdecode(np.fromfile(str(p), dtype=np.uint8), cv2.IMREAD_COLOR)


def imwrite_unicode(p, img):
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if ok:
        buf.tofile(str(p))
    return ok


def undistort_one(args):
    src_img, dst_img, K, dist, size = args
    img = imread_unicode(src_img)
    if img is None:
        return f'[FAIL] 读不了 {src_img}'
    if img.shape[:2] != (size[1], size[0]):
        return f'[FAIL] 尺寸不符 {src_img}'
    mapx, mapy = cv2.initUndistortRectifyMap(
        K, dist, np.eye(3), K, size, cv2.CV_32FC1)
    out = cv2.remap(img, mapx, mapy, cv2.INTER_LINEAR)
    dst_img.parent.mkdir(parents=True, exist_ok=True)
    if not imwrite_unicode(dst_img, out):
        return f'[FAIL] 写不了 {dst_img}'
    return None


def main():
    cams = read_cameras(SRC / 'sparse/0/cameras.bin')
    ims = read_images_bin(SRC / 'sparse/0/images.bin')
    print(f'相机 {len(cams)} 台, 注册图片 {len(ims)} 张')

    # 预生成每台相机的 K / dist
    per_cam = {}
    for cid, (w, h, p) in cams.items():
        fx, fy, cx, cy, k1, k2, p1, p2 = p
        per_cam[cid] = (np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], np.float64),
                        np.array([k1, k2, p1, p2], np.float64), (w, h))
        print(f'  cam{cid}: fx={fx:.1f} cx={cx:.1f} k1={k1:.5f}')

    jobs = []
    for iid, cid, name in ims:
        w, h, p = cams[cid]
        K, dist, size = per_cam[cid]
        jobs.append((SRC / 'images' / name, DST / 'images' / name, K, dist, size))

    print(f'\n开始去畸变 {len(jobs)} 张 ({jobs[0][0].parent.name} ... {jobs[-1][0].parent.name})')
    done = fails = 0
    with ProcessPoolExecutor(max_workers=8) as ex:
        for r in ex.map(undistort_one, jobs, chunksize=16):
            done += 1
            if r:
                fails += 1
                print(r)
            if done % 200 == 0:
                print(f'  {done}/{len(jobs)}')
    print(f'完成: {done} 张, 失败 {fails}')
    assert fails == 0

    # --- sparse 重写 ---
    dst_sparse = DST / 'sparse/0'
    dst_sparse.mkdir(parents=True, exist_ok=True)
    with open(dst_sparse / 'cameras.bin', 'wb') as f:
        f.write(struct.pack('<Q', len(cams)))
        for cid, (w, h, p) in cams.items():
            fx, fy, cx, cy = p[:4]
            f.write(struct.pack('<iiQQ', cid, 1, w, h))          # id=1 PINHOLE (COLMAP 官方: 0=SIMPLE_PINHOLE,1=PINHOLE,2=SIMPLE_RADIAL)
            f.write(struct.pack('<dddd', fx, fy, cx, cy))
    for fn in ('images.bin', 'points3D.bin'):
        shutil.copy2(SRC / 'sparse/0' / fn, dst_sparse / fn)
    print('[ok] sparse 重写: cameras.bin=PINHOLE, images/points3D 原样')

    # --- 前后对比预览 ---
    name0 = ims[0][2]
    a = imread_unicode(SRC / 'images' / name0)
    b = imread_unicode(DST / 'images' / name0)
    h_, w_ = a.shape[:2]
    # 放大画面右下 1/4 区域(畸变差异最明显处)
    crop = lambda im: im[h_//2:, w_//2:]
    cmp_img = np.hstack([crop(a), crop(b)])
    cv2.putText(cmp_img, 'BEFORE(distorted)', (30, 60), 0, 1.4, (0, 0, 255), 3)
    cv2.putText(cmp_img, 'AFTER(undistorted)', (w_//2+30, 60), 0, 1.4, (0, 255, 0), 3)
    imwrite_unicode(DST / 'undistort_compare.jpg', cmp_img)
    print(f"[ok] 对比预览: {DST / 'undistort_compare.jpg'}")


if __name__ == '__main__':
    main()
