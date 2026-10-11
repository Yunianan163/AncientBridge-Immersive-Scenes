"""
flatten_for_2dgs.py —— 把子目录图片拍平成 2DGS 要求的平铺布局

问题: 2DGS 的 readColmapCameras 用 os.path.basename(image_name) 找图，
      不支持子目录。数据源是 images/1/ + images/2/ 两段视频的解帧，
      且两目录有 130 个重名文件，不能直接合并。

方案: images/1/xxx.jpg -> images/v1_xxx.jpg
      images/2/xxx.jpg -> images/v2_xxx.jpg
      同时重写 sparse/0/images.bin 里的文件名字段。
"""
import struct
import shutil
from pathlib import Path

ROOT = Path(r'E:\葛镜桥高斯\2DGS重训\model1_undistort')
IMG = ROOT / 'images'
BIN = ROOT / 'sparse' / '0' / 'images.bin'

# ---- 1) 移动图片 ----
moved = 0
for sub in ('1', '2'):
    src_dir = IMG / sub
    if not src_dir.exists():
        continue
    for p in sorted(src_dir.iterdir()):
        if p.is_file():
            target = IMG / f'v{sub}_{p.name}'
            assert not target.exists(), f'目标已存在: {target}'
            shutil.move(str(p), str(target))
            moved += 1
    src_dir.rmdir()
print(f'[1/3] 移动 {moved} 张图片到平铺布局 (v1_*/v2_*)')

# ---- 2) 重写 images.bin 的文件名 ----
raw = BIN.read_bytes()
num = struct.unpack_from('<Q', raw, 0)[0]
off = 8
out = bytearray(struct.pack('<Q', num))
renamed = 0
for _ in range(num):
    image_id, = struct.unpack_from('<i', raw, off); off += 4
    qvec = raw[off:off+32]; off += 32
    tvec = raw[off:off+24]; off += 24
    cam_id, = struct.unpack_from('<i', raw, off); off += 4
    end = raw.index(b'\x00', off)
    name = raw[off:end].decode()
    off = end + 1
    npts, = struct.unpack_from('<Q', raw, off)
    pts = raw[off:off+8+npts*24]; off += 8 + npts*24

    new_name = name
    if name.startswith('1/'):
        new_name = 'v1_' + name[2:]
    elif name.startswith('2/'):
        new_name = 'v2_' + name[2:]
    renamed += 1
    out += struct.pack('<i', image_id) + qvec + tvec + struct.pack('<i', cam_id)
    out += new_name.encode() + b'\x00' + pts
assert off == len(raw), f'images.bin 没对齐: {off} != {len(raw)}'
BIN.write_bytes(bytes(out))
print(f'[2/3] 重写 images.bin: {renamed} 个文件名加前缀')

# ---- 3) 校验 ----
raw2 = BIN.read_bytes()
off = 8
ok = 0
for _ in range(num):
    off += 4 + 32 + 24 + 4
    end = raw2.index(b'\x00', off)
    name = raw2[off:end].decode()
    assert (IMG / name).exists(), f'找不到 {name}'
    off = end + 1
    npts, = struct.unpack_from('<Q', raw2, off); off += 8 + npts*24
    ok += 1
assert off == len(raw2)
print(f'[3/3] 校验通过: {ok}/{num} 个文件名都能找到对应图片')
