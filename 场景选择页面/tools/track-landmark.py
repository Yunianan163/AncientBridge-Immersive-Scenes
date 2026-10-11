#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
地标追踪：盯住画面里一个**有特征色**的物体，逐帧量它在屏幕上的位置与大小，
再找"单帧跳了多远"。比整帧差稳得多 —— 整帧差会被捕获抖动、
别的物体（地图缩退、文字淡入）干扰，地标则只反映那一个物体的真实位移。

本项目的地标就是**朱砂**：文创坊檐下那对灯笼、两道朱砂竖签条、
匾额上的红印，都是同一族色（R 明显高于 G/B，且背景是暖墨/暖绢）。
判据与「人工看录屏」完全一致，所以两条链路的结果可以直接对比。

⚠️ 判据必须**同时看 dt**：捕获帧间隔不均匀（本项目实测每 ~5 帧有 40~60ms 空档），
   同一段位移摊在 60ms 和 5ms 里，绝对差能差 10 倍。
   所以看「位移/毫秒」的突变，且**要求同一时刻在重复录制里复现** ——
   真跳变是确定性的，捕获抖动不是。

用法：
  python tools/track-landmark.py <帧目录> [--min-area 60] [--top 12]
"""
import os
import re
import sys
import glob

import numpy as np
from PIL import Image


def t_of(name):
    """从 f0059_t674.jpg 里取相对时间；取不到就返回帧序号"""
    m = re.search(r'_t(-?\d+)', name)
    return int(m.group(1)) if m else None


def blobs(path, min_area):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    m = ((r > 105) & (r - g > 42) & (r - b > 42)).astype(np.uint8)
    try:
        import cv2
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, lab, stats, cent = cv2.connectedComponentsWithStats(m)
        out = []
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= min_area:
                out.append((float(cent[i][0]), float(cent[i][1]), int(stats[i, cv2.CC_STAT_AREA])))
        return out
    except ImportError:
        # 无 cv2 时的退化实现：整体质心（不去噪）
        ys, xs = np.nonzero(m)
        if len(xs) < min_area:
            return []
        return [(float(xs.mean()), float(ys.mean()), int(len(xs)))]


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    d = args[0]
    min_area = int(args[args.index('--min-area') + 1]) if '--min-area' in args else 60
    top = int(args[args.index('--top') + 1]) if '--top' in args else 12

    fs = sorted(glob.glob(os.path.join(d, '*.jpg')) + glob.glob(os.path.join(d, '*.png')))
    if len(fs) < 3:
        sys.exit(f'帧太少：{d}')

    rows = []
    prev_pos = None
    for f in fs:
        nm = os.path.basename(f)
        bb = blobs(f, min_area)
        if bb:
            """★ 位置怎么选：既不能取"最大的两块的中点"（地标进出阈值时会换参考系，
               制造几十上百像素的假位移 —— 我踩过：修复后实测 96.26px 的"跳"，
               查下去只是块数由 1 变 2），也不能简单取"最大块"（两盏灯笼面积相近时
               会来回换身份，一次换就是两三百像素的假位移）。
               正解：**就近延续** —— 在所有够大的候选里，挑离上一帧位置最近的那个，
               没有上一帧（首帧或断档后）才退回"最大块"。身份稳定，位移才可信。"""
            cands = [t for t in bb if t[2] >= 0.5 * max(x[2] for x in bb)]
            if prev_pos is not None:
                big = min(cands, key=lambda t: (t[0] - prev_pos[0]) ** 2 + (t[1] - prev_pos[1]) ** 2)
            else:
                big = max(cands, key=lambda t: t[2])
            cx, cy = float(big[0]), float(big[1])
            prev_pos = (cx, cy)
            xs = sorted(t[0] for t in bb)
            span = float(xs[-1] - xs[0]) if len(bb) >= 2 else 0.0
        else:
            cx = cy = span = float('nan')
            prev_pos = None
        rows.append({'name': nm, 't': t_of(nm), 'n': len(bb), 'cx': cx, 'cy': cy, 'span': span})

    have = [r for r in rows if not np.isnan(r['cx'])]
    print(f'== {os.path.basename(os.path.normpath(d))}  共 {len(rows)} 帧，其中 {len(have)} 帧检出地标')
    if len(have) < 3:
        print('   地标太少，无法追踪（物体太小/离屏/不在画面里）')
        return 0

    # 逐帧位移（只在地标连续可用的相邻帧之间算）
    steps = []
    prev = None
    for i, r in enumerate(rows):
        if np.isnan(r['cx']):
            prev = None
            continue
        if prev is not None:
            dt = (r['t'] - prev['t']) if (r['t'] is not None and prev['t'] is not None) else None
            d = float(np.hypot(r['cx'] - prev['cx'], r['cy'] - prev['cy']))
            steps.append({'i': i, 'name': r['name'], 't': r['t'], 'dt': dt, 'd': d,
                          'rate': (d / dt) if dt else None})
        prev = r

    if not steps:
        print('   没有连续的地标帧对')
        return 0

    print(f'   位移中位 {np.median([s["d"] for s in steps]):.2f}px  '
          f'最大 {max(s["d"] for s in steps):.2f}px')
    print()
    print(f'位移最大的 {top} 帧（看「速率」列是否比邻居突出一截）：')
    print('   帧号            t(ms)   dt(ms)   位移px     速率px/ms')
    for s in sorted(steps, key=lambda x: -x['d'])[:top]:
        rt = f'{s["rate"]:.4f}' if s['rate'] is not None else '-'
        print(f'   {s["name"]:<16} {str(s["t"]):>7} {str(s["dt"]):>7} {s["d"]:>9.2f}   {rt}')

    if '--trace' in args:
        print()
        print('全程轨迹（位置 / 单帧位移 / 速率）：')
        byname = {r['name']: r for r in rows}
        print('   帧号              t(ms)     x       y      位移px    dt   速率px/ms')
        for s in steps:
            r = byname[s['name']]
            rt = f'{s["rate"]:.4f}' if s['rate'] is not None else '-'
            flag = '   <<<' if (s['rate'] and s['rate'] > 3) else ''
            print(f'   {s["name"]:<16} {str(r["t"]):>7} {r["cx"]:>8.1f} {r["cy"]:>7.1f} '
                  f'{s["d"]:>9.2f} {str(s["dt"]):>5} {rt:>10}{flag}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
