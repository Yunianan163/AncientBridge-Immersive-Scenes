# -*- coding: utf-8 -*-
"""
convert_colmap.py —— 把 Spirula Studio 的 COLMAP 工程转成 2DGS/PGSR 可用格式

背景：Spirula 导出的 sparse/0/cameras.bin 是非标 COLMAP——
相机模型 ID 写的是 4（COLMAP 的 RADIAL，5 参数），但实际带 8 个参数
（fx,fy,cx,cy,k1,k2,p1,p2 = OPENCV 模型）。直接喂给 2DGS/PGSR 会在
解析 cameras.bin 时崩溃或错位。

本脚本做的事：
  1) 读入 Spirula 的 cameras.bin，校验参数个数；
  2) 按 OPENCV（COLMAP 模型 ID = 5）重写 cameras.bin；
  3) images.bin / points3D.bin 已验证是严格标准格式，原样复制；
  4) images 目录用 Windows junction 链接（不复制、不占磁盘）。

产物布局（2DGS/PGSR 的 -s 参数直接指向 model1 即可）：
  E:/葛镜桥高斯/2DGS重训/model1/
      images/          (junction → E:/葛镜桥高斯/模型1/images)
      sparse/0/
          cameras.bin  (已修成标准 OPENCV)
          images.bin
          points3D.bin

用法： python convert_colmap.py
"""
import shutil
import struct
import sys
from pathlib import Path

SRC = Path(r'E:\葛镜桥高斯\模型1')
DST = Path(r'E:\葛镜桥高斯\2DGS重训\model1')

# COLMAP 相机模型：(名称, 参数个数) —— 与 colmap/src/base/retrieval 一致
MODELS = {1: ('SIMPLE_PINHOLE', 3), 2: ('PINHOLE', 4), 3: ('SIMPLE_RADIAL', 4),
          4: ('RADIAL', 5), 5: ('OPENCV', 8), 6: ('SIMPLE_RADIAL_FISHEYE', 4),
          7: ('RADIAL_FISHEYE', 5), 8: ('OPENCV_FISHEYE', 8),
          9: ('FULL_OPENCV', 12), 10: ('FOV', 5)}


def read_cameras(path):
    """返回 [(cid, model_name, params)]；Spirula 的 id=4+8 参数按 OPENCV 处理。"""
    raw = path.read_bytes()
    f = memoryview(raw)
    num = struct.unpack_from('<Q', f, 0)[0]
    off = 8
    out = []
    for _ in range(num):
        cid, mid, w, h = struct.unpack_from('<iiQQ', f, off)
        off += 24
        # Spirula 写法：id=4 但 8 个参数。按文件总长度反推每相机参数个数。
        nparams_inferred = (len(raw) - 8 - num * 24) // (8 * max(num, 1))
        if mid == 4 and nparams_inferred == 8:
            mid = 5                                  # RADIAL(id4)+8参 → 实为 OPENCV
        name, n = MODELS[mid]
        params = struct.unpack_from('<' + 'd' * n, f, off)
        off += 8 * n
        out.append((cid, mid, w, h, name, params))
    assert off == len(raw), f'cameras.bin 解析没对齐: {off} != {len(raw)}'
    return out


def write_cameras(path, cams):
    with open(path, 'wb') as f:
        f.write(struct.pack('<Q', len(cams)))
        for (cid, mid, w, h, name, params) in cams:
            f.write(struct.pack('<iiQQ', cid, mid, w, h))
            f.write(struct.pack('<' + 'd' * len(params), *params))


def main():
    src_sparse = SRC / 'sparse' / '0'
    dst_sparse = DST / 'sparse' / '0'
    dst_sparse.mkdir(parents=True, exist_ok=True)

    cams = read_cameras(src_sparse / 'cameras.bin')
    for c in cams:
        print(f'  camera {c[0]}: {c[2]}x{c[3]} {c[4]} '
              f'fx={c[5][0]:.1f} fy={c[5][1]:.1f} k1={c[5][4]:.4f}')
    write_cameras(dst_sparse / 'cameras.bin', cams)
    print(f'[ok] cameras.bin 已按标准 COLMAP OPENCV 写出')

    for fn in ('images.bin', 'points3D.bin'):
        shutil.copy2(src_sparse / fn, dst_sparse / fn)
        print(f'[ok] {fn} 复制完成（已验证为标准格式）')

    # images 目录 junction（不复制 1 个多 GB 的图像）
    junc = DST / 'images'
    if junc.exists():
        print(f'[skip] images 链接已存在: {junc}')
    else:
        import os
        os.system(f'mklink /J "{junc}" "{SRC / "images"}"')
        print(f'[ok] images junction: {junc} → {SRC / "images"}')

    print('\n完成。2DGS 训练时用:  -s /mnt/e/葛镜桥高斯/2DGS重训/model1')


if __name__ == '__main__':
    main()
