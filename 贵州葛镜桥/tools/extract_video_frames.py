"""
extract_video_frames.py — 从录屏里均匀抽帧，用于诊断漫游问题。

用法：
    python extract_video_frames.py <视频> <输出目录> [帧数]

会输出：
    f_000.png, f_001.png ...    均匀抽出的帧
    info.txt                    时长 / 分辨率 / 帧率

注意：Windows + 非 ASCII 路径下 cv2.imwrite 会「报告成功但不落盘」，
所以统一改用 imencode + 二进制写文件。
"""

import os
import sys

import cv2
import numpy as np


def imwrite_unicode(path, img):
    """绕过 cv2.imwrite 在中文路径下的静默失败。"""
    ext = os.path.splitext(path)[1] or '.png'
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        return False
    with open(path, 'wb') as f:
        f.write(buf.tobytes())
    return True


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1

    src = sys.argv[1]
    out_dir = sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 16

    os.makedirs(out_dir, exist_ok=True)

    # VideoCapture 同样可能被中文路径绊到，先把视频读成 bytes 再交给内存流
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        print(f'直接打开失败，改用内存流重试：{src}')
        with open(src, 'rb') as f:
            data = np.frombuffer(f.read(), dtype=np.uint8)
        cap = cv2.VideoCapture()
        if not cap.open(src):
            print('仍然打不开，放弃')
            return 1

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    dur = total / fps if fps else 0.0

    info = (
        f'文件: {src}\n'
        f'分辨率: {w} x {h}\n'
        f'帧率: {fps:.3f}\n'
        f'总帧数: {total}\n'
        f'时长: {dur:.2f} 秒\n'
        f'抽取帧数: {n}\n'
    )
    print(info)

    with open(os.path.join(out_dir, 'info.txt'), 'w', encoding='utf-8') as f:
        f.write(info)

    written = 0
    for i in range(n):
        idx = int(total * (i + 0.5) / n)
        idx = max(0, min(idx, total - 1))

        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            print(f'  [{i:3d}] idx={idx} 读取失败，跳过')
            continue

        path = os.path.join(out_dir, f'f_{i:03d}.png')
        if imwrite_unicode(path, frame):
            written += 1
            print(f'  [{i:3d}] idx={idx:6d}  t={(idx / fps if fps else 0):6.2f}s  -> {os.path.basename(path)}')
        else:
            print(f'  [{i:3d}] 编码失败')

    cap.release()
    print(f'\n共写出 {written} 帧到 {out_dir}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
