#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把「全商品验证矩阵」画成一张海报 PNG。由 `scripts/make-matrix.mjs` 调用：

    <python> scripts/make-matrix.py <数据.json> <输出.png>

数据 json 是编排器现算的（见 make-matrix.mjs 里的 payload），这里**不做任何判断**，
只负责排版 —— 所以图上的每个数字都能追到一次真实断言。

配色与栅格是拿原图逐像素量出来的，不是拍脑袋：
    底色 #18181A  表头带 #222226  分隔线 #3E3E44  隔行 #1D1D21
    标题 #EEEEF0   灰字 #9EA0A6   蓝 #78B4FA     绿 #6ED296
    列心 x = 415 / 600 / 790 / 965，内容左边距 23，表头与数据行各 52px 高。

⚠️ 字体用 msyh.ttc（微软雅黑）。**它没有 `✓`(U+2713) 的字形**，画出来是豆腐块 □，
   所以打勾一律用 `√`(U+221A) —— 数据侧也统一用这个字符。
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

BG = (24, 24, 26)
BAND = (34, 34, 38)
SEP = (62, 62, 68)
ROW_ALT = (29, 29, 33)
TITLE_C = (238, 238, 240)
MUTED = (158, 160, 166)
BLUE = (120, 180, 250)
GREEN = (110, 210, 150)
RED = (235, 110, 110)
DIM = (120, 122, 128)

W = 1114
X0 = 23                     # 内容左边距
COL_C = [415, 600, 790, 965]  # 4 个数值列的列心
TITLE_TOP = 40
SUB_TOP = 82
BAND_TOP = 118
BAND_H = 52
ROW_H = 52
NOTE_LH = 26
NOTE_PAD_TOP = 28
NOTE_PAD_BOTTOM = 34
FONT_DIR = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')


def font(size, bold=False):
    names = ['msyhbd.ttc', 'msyh.ttc'] if bold else ['msyh.ttc']
    for n in names:
        p = os.path.join(FONT_DIR, n)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def value_color(text, dim=False):
    if dim:
        return DIM
    if text.startswith('×'):
        return RED
    if text.startswith('√'):
        return GREEN
    return MUTED


def main():
    if len(sys.argv) < 3:
        print('用法：make-matrix.py <数据.json> <输出.png>', file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding='utf-8') as fh:
        data = json.load(fh)
    out_path = sys.argv[2]

    rows = data['rows']
    notes = data.get('notes', [])

    # ---- 高度按内容算，别写死（写死必裁掉底部的注释）
    y = BAND_TOP + BAND_H + 1
    row_tops = []
    for i, r in enumerate(rows):
        if i > 0 and bool(r.get('dim')) != bool(rows[i - 1].get('dim')):
            y += 1                      # 分组之间加一条分隔线
        row_tops.append(y)
        y += ROW_H
    notes_top = y + NOTE_PAD_TOP
    H = notes_top + NOTE_LH * len(notes) + NOTE_PAD_BOTTOM

    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)

    f_title = font(30, bold=True)
    f_sub = font(15)
    f_head = font(16)
    f_cell = font(16)
    f_note = font(14)

    # ---- 标题区
    d.text((X0, TITLE_TOP), data['title'], font=f_title, fill=TITLE_C)
    d.text((X0, SUB_TOP), data['subtitle'], font=f_sub, fill=MUTED)

    # ---- 表头带
    d.rectangle([0, BAND_TOP, W - 1, BAND_TOP + BAND_H - 1], fill=BAND)
    head_cy = BAND_TOP + BAND_H / 2
    d.text((X0, head_cy), data['head'][0], font=f_head, fill=BLUE, anchor='lm')
    for i, txt in enumerate(data['head'][1:]):
        d.text((COL_C[i], head_cy), txt, font=f_head, fill=BLUE, anchor='mm')
    d.line([(0, BAND_TOP + BAND_H), (W - 1, BAND_TOP + BAND_H)], fill=SEP)

    # ---- 数据行
    for i, r in enumerate(rows):
        top = row_tops[i]
        cy = top + ROW_H / 2
        if i % 2 == 1:
            d.rectangle([0, top, W - 1, top + ROW_H - 1], fill=ROW_ALT)
        if i > 0 and bool(r.get('dim')) != bool(rows[i - 1].get('dim')):
            d.line([(0, top), (W - 1, top)], fill=SEP)
        dim = bool(r.get('dim'))
        d.text((X0, cy), r['label'], font=f_cell, fill=DIM if dim else TITLE_C, anchor='lm')
        for j, txt in enumerate(r['cells']):
            d.text((COL_C[j], cy), txt, font=f_cell, fill=value_color(txt, dim), anchor='mm')

    # ---- 脚注
    for k, note in enumerate(notes):
        d.text((X0, notes_top + k * NOTE_LH), note, font=f_note, fill=MUTED)

    im.save(out_path)
    print(f'  {W}×{H}  {len(rows)} 行 × {len(data["head"])} 列  →  {out_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
