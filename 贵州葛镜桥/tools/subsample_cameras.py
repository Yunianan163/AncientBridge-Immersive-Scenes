"""
subsample_cameras.py —— images.bin 相机隔一保一（1378 -> 689）

原因: 2DGS 载入图片时转 float32 张量常驻内存(960x540x3x4B x 1378 ≈ 8.6GB)，
      WSL 10GB 内存上限下必被 OOM kill。
方案: 视频解帧的相邻帧高度冗余，隔一保一质量几乎无损。
      内存 ~4.5GB，训练时间减半。
"""
import struct
from pathlib import Path

BIN = Path(r'E:\葛镜桥高斯\2DGS重训\model1_undistort\sparse\0\images.bin')

raw = BIN.read_bytes()
num = struct.unpack_from('<Q', raw, 0)[0]
off = 8
records = []
names = []
for _ in range(num):
    start = off
    off += 4 + 32 + 24 + 4           # image_id + qvec + tvec + camera_id
    end = raw.index(b'\x00', off)
    name = raw[off:end].decode()
    off = end + 1
    npts, = struct.unpack_from('<Q', raw, off)
    off += 8 + npts * 24
    records.append(raw[start:off])
    names.append(name)
assert off == len(raw)

# 隔一保一（记录本身是交替的 v1_/v2_ 混合序列，天然交错两段视频）
keep = records[::2]
keep_names = names[::2]
out = bytearray(struct.pack('<Q', len(keep)))
for r in keep:
    out += r
BIN.write_bytes(bytes(out))
print(f'保留 {len(keep)}/{num} 相机')
import collections
c = collections.Counter(n[:2] for n in keep_names)
print('分布:', dict(c))
