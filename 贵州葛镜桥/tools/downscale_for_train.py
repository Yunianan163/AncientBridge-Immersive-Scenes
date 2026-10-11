"""
downscale_for_train.py —— 把 model1_undistort 图片降到 960x540 训练分辨率

背景: 2DGS 训练把所有图载入内存。1378 张 1920x1080 = 8.1GB，超过 WSL 内存上限被 OOM kill。
方案: 磁盘上直接降一半（与 -r 2 的训练分辨率完全一致，零画质损失），
      cameras.bin 内参同步 x0.5，训练改用 -r 1。内存占用 8.1GB -> 2.0GB。
"""
import struct
from pathlib import Path
import numpy as np
import cv2
from multiprocessing import Pool

ROOT = Path(r'E:\葛镜桥高斯\2DGS重训\model1_undistort')
IMG = ROOT / 'images'
BIN = ROOT / 'sparse' / '0' / 'cameras.bin'
TARGET_W, TARGET_H = 960, 540


def down_one(p):
    data = np.fromfile(str(p), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        return f'[FAIL] {p.name}'
    out = cv2.resize(img, (TARGET_W, TARGET_H), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 95])
    tmp = p.with_suffix('.tmp.jpg')
    import time, os
    for attempt in range(5):
        try:
            buf.tofile(str(tmp))
            os.replace(str(tmp), str(p))
            return None
        except PermissionError:
            time.sleep(1.0)
    return f'[FAIL] {p.name} (锁定)'


if __name__ == '__main__':
    files = sorted(IMG.glob('*.jpg'))
    print(f'共 {len(files)} 张图，降采样到 {TARGET_W}x{TARGET_H} ...')
    with Pool(8) as pool:
        fails = [r for r in pool.map(down_one, files) if r]
    print(f'完成，失败 {len(fails)} 张', fails[:5])

    # ---- cameras.bin 内参减半 ----
    raw = bytearray(BIN.read_bytes())
    n, = struct.unpack_from('<Q', raw, 0)
    off = 8
    for _ in range(n):
        cid, model = struct.unpack_from('<ii', raw, off)
        w, h = struct.unpack_from('<QQ', raw, off + 8)
        struct.pack_into('<QQ', raw, off + 8, TARGET_W, TARGET_H)
        k = 4  # PINHOLE: fx fy cx cy
        p_off = off + 24
        fx, fy, cx, cy = struct.unpack_from('<dddd', raw, p_off)
        struct.pack_into('<dddd', raw, p_off,
                         fx * TARGET_W / w, fy * TARGET_H / h,
                         cx * TARGET_W / w, cy * TARGET_H / h)
        off += 24 + 8 * k
    BIN.write_bytes(bytes(raw))
    print('cameras.bin 已同步缩放')

    # ---- 校验 ----
    raw2 = BIN.read_bytes()
    off = 8
    for _ in range(n):
        cid, model, w, h = struct.unpack_from('<iiQQ', raw2, off)
        params = struct.unpack_from('<dddd', raw2, off + 24)
        print(f'  camera id={cid} model={model} {w}x{h} fx={params[0]:.1f} cx={params[2]:.1f}')
        off += 24 + 32
    import cv2 as _
    im = cv2.imdecode(np.fromfile(str(files[0]), dtype=np.uint8), cv2.IMREAD_COLOR)
    print(f'抽查图片尺寸: {im.shape[1]}x{im.shape[0]}')
