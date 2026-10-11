#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
逐帧求差找"跳一下"——同一套判据既能量合成帧目录，也能量人工录屏 mp4。

判据（这是关键，不是"看着像"）：
  跳变 = 某一帧的帧间差很大，而它**前后两帧都近乎静止**。
  孤立单帧尖峰 ⇒ 画面被瞬移了一下；
  若相邻几帧都在大步变化 ⇒ 那只是正常动画。
  所以只看"孤立尖峰"，不看单纯的最大值。

用法：
  python tools/analyze-frames.py                      # 默认读 %TEMP%/wb-jump/frames-fixed
  python tools/analyze-frames.py <帧目录>
  python tools/analyze-frames.py --mp4 <视频路径> [--fps 30] [--crop l,t,r,b]
"""
import os
import sys
import glob
import json

import numpy as np
from PIL import Image

SPIKE_HARD = 3.0     # 判定"这一帧动得很大"
STILL = 1.2          # 判定"相邻帧近乎静止"
THUMB = (320, 190)   # 统一缩到这个小尺寸再比，抵消编码噪声


def gray(a):
    """RGBA/RGB → 灰度 float32"""
    if a.ndim == 3 and a.shape[2] == 4:
        a = a[:, :, :3]
    return (0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]).astype(np.float32)


def from_dir(d):
    fs = sorted(glob.glob(os.path.join(d, '*.png')) + glob.glob(os.path.join(d, '*.jpg')))
    labels, imgs = [], []
    for f in fs:
        im = Image.open(f).convert('RGB').resize(THUMB, Image.BILINEAR)
        imgs.append(gray(np.asarray(im)))
        labels.append(os.path.basename(f))
    return labels, imgs


def from_mp4(p, fps=None, crop=None):
    try:
        import cv2
    except ImportError:
        sys.exit('需要 cv2 才能读 mp4（pip install opencv-python）')
    cap = cv2.VideoCapture(p)
    labels, imgs = [], []
    i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if crop:
            l, t, r, b = crop
            fr = fr[t:b, l:r]
        # cv2 是 BGR
        g = cv2.cvtColor(cv2.resize(fr, THUMB), cv2.COLOR_BGR2GRAY).astype(np.float32)
        imgs.append(g)
        labels.append(f'f{i:04d}')
        i += 1
    return labels, imgs


def main():
    args = sys.argv[1:]
    crop = None
    if '--crop' in args:
        k = args.index('--crop')
        crop = [int(x) for x in args[k + 1].split(',')]
        del args[k:k + 2]
    if '--mp4' in args:
        k = args.index('--mp4')
        src = args[k + 1]
        del args[k:k + 2]
        labels, imgs = from_mp4(src, crop=crop)
        title = os.path.basename(src)
    else:
        d = args[0] if args else os.path.join(os.environ.get('TEMP', '/tmp'), 'wb-jump', 'frames-fixed')
        if not os.path.isdir(d):
            sys.exit(f'目录不存在：{d}（先跑 tools/probe-frames.mjs）')
        labels, imgs = from_dir(d)
        title = os.path.basename(os.path.normpath(d))

    if len(imgs) < 3:
        sys.exit(f'帧数太少（{len(imgs)}），无法判断')

    diffs = [None] + [float(np.abs(imgs[i] - imgs[i - 1]).mean()) for i in range(1, len(imgs))]

    print(f'== {title}  共 {len(imgs)} 帧')
    print(f'   帧间差：最大 {max(d for d in diffs if d is not None):.2f}  '
          f'中位 {float(np.median([d for d in diffs if d is not None])):.2f}')

    # ① 孤立单帧尖峰 —— 这才是"跳一下"
    spikes = []
    for i in range(1, len(diffs) - 1):
        if diffs[i] > SPIKE_HARD and diffs[i - 1] < STILL and diffs[i + 1] < STILL:
            spikes.append(i)

    print()
    print('① 孤立单帧尖峰（判定「跳一下」的唯一依据）：')
    if not spikes:
        print('   （无）✅ 没有瞬移帧')
    else:
        for i in spikes:
            print(f'   ❌ {labels[i]}  diff={diffs[i]:.2f}  '
                  f'前一帧={diffs[i-1]:.2f} 后一帧={diffs[i+1]:.2f}')

    # ② 最大几帧：区分"正常动画"与"尖峰"
    order = sorted(range(1, len(diffs)), key=lambda i: -diffs[i])[:8]
    print()
    print('② 帧间差最大的 8 帧（动画本身也会大，需连着看邻居）：')
    for i in sorted(order):
        nb = f'{diffs[i-1]:.2f}/{diffs[i+1]:.2f}'
        tag = '  ← 孤立尖峰' if (diffs[i] > SPIKE_HARD and diffs[i-1] < STILL and diffs[i+1] < STILL) else ''
        print(f'   {labels[i]}  diff={diffs[i]:6.2f}   邻帧 {nb}{tag}')

    # ③ 打印一段逐帧曲线，便于和 viewK 曲线对齐
    print()
    print('③ 逐帧差曲线（每帧一行，可直接和 viewK 对齐）：')
    for i in range(1, len(diffs)):
        bar = '#' * min(int(diffs[i] * 2), 70)
        print(f'   {labels[i]}  {diffs[i]:6.2f} {bar}')

    print()
    print('结论：' + ('存在孤立单帧尖峰 ❌' if spikes else '无孤立单帧尖峰 ✅'))
    return 1 if spikes else 0


if __name__ == '__main__':
    sys.exit(main())
