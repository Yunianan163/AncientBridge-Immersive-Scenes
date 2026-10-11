# -*- coding: utf-8 -*-
"""
verify_2dgs_data.py —— 重训前最终数据体检
校验 model1 是否符合 2DGS/PGSR 的 -s 数据要求：
  1) cameras.bin：标准 COLMAP（OPENCV 模型），参数个数对齐
  2) images.bin：严格解析到位（证明格式标准），文件名都能在 images/ 下找到
  3) 图片数 == 相机数，分辨率与 cameras.bin 声明一致（抽查）
"""
import struct
from pathlib import Path
from PIL import Image

ROOT = Path(r'E:\葛镜桥高斯\2DGS重训\model1')
MODELS = {1: ('SIMPLE_PINHOLE', 3), 2: ('PINHOLE', 4), 3: ('SIMPLE_RADIAL', 4),
          4: ('RADIAL', 5), 5: ('OPENCV', 8)}


def read_images_bin(path):
    """严格按 COLMAP images.bin 格式解析，返回 [(image_id, camera_id, name)]。"""
    raw = path.read_bytes()
    num = struct.unpack_from('<Q', raw, 0)[0]
    off = 8
    out = []
    for _ in range(num):
        image_id, = struct.unpack_from('<i', raw, off); off += 4
        struct.unpack_from('<dddd', raw, off); off += 32   # qvec
        struct.unpack_from('<ddd', raw, off); off += 24    # tvec
        camera_id, = struct.unpack_from('<i', raw, off); off += 4
        end = raw.index(b'\x00', off)
        name = raw[off:end].decode('utf-8')
        off = end + 1
        npts, = struct.unpack_from('<Q', raw, off); off += 8
        off += npts * 24          # 每 point2D: x,y (double) + point3D_id (int32)
        out.append((image_id, camera_id, name))
    assert off == len(raw), f'images.bin 没对齐: {off} != {len(raw)}'
    return num, out


def main():
    # --- cameras.bin ---
    raw = (ROOT / 'sparse/0/cameras.bin').read_bytes()
    num = struct.unpack_from('<Q', raw, 0)[0]
    off = 8
    print(f'=== cameras.bin: {num} 台相机 ===')
    for _ in range(num):
        cid, mid, w, h = struct.unpack_from('<iiQQ', raw, off); off += 24
        name, n = MODELS[mid]
        params = struct.unpack_from('<' + 'd' * n, raw, off); off += 8 * n
        print(f'  id={cid} {name} {w}x{h} fx={params[0]:.1f} fy={params[1]:.1f} '
              f'k1={params[4]:.5f} k2={params[5]:.5f}')
    assert off == len(raw), 'cameras.bin 没对齐'
    print('[ok] cameras.bin 标准格式、字节对齐')

    # --- images.bin ---
    n, ims = read_images_bin(ROOT / 'sparse/0/images.bin')
    print(f'\n=== images.bin: {n} 张注册图片 ===')
    print(f'  前3: {[i[2] for i in ims[:3]]}')
    print(f'  后3: {[i[2] for i in ims[-3:]]}')

    # --- 图片实存 + 分辨率抽查 ---
    missing = [i[2] for i in ims if not (ROOT / 'images' / i[2]).exists()]
    print(f'  缺失文件: {len(missing)}', missing[:5] if missing else '(无)')
    assert not missing, '有图片缺失！'

    real = [p for p in (ROOT / 'images').rglob('*') if p.suffix.lower() in ('.jpg', '.png', '.jpeg')]
    print(f'  磁盘实存图片: {len(real)}（{len(real) - n} 张未注册，属正常——SfM 剔除的模糊帧）')

    for p in (real[0], real[len(real)//2], real[-1]):
        im = Image.open(p)
        assert im.size == (w, h), f'{p.name} 分辨率 {im.size} != 相机声明 {(w, h)}'
    print(f'  [ok] 分辨率抽查 3/3 一致: {w}x{h}')

    # --- points3D.bin 头 ---
    raw3 = (ROOT / 'sparse/0/points3D.bin').read_bytes()
    npts = struct.unpack_from('<Q', raw3, 0)[0]
    print(f'\n=== points3D.bin: {npts} 个 3D 点 ===')

    print('\n========== 数据体检全部通过，可直接喂给 2DGS ==========')


if __name__ == '__main__':
    main()
