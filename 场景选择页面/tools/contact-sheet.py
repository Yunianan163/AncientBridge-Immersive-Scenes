#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 probe-door.mjs 录的帧挑 8 个关键时刻，拼成一张分镜图（2 行 × 4 列）。
用法：py -3 tools/contact-sheet.py [帧目录] [输出png]
默认：读 %TEMP%/wb-door/frames，输出 tools/shots/18-门敞开穿门分镜.png"""
import json, os, sys, glob
from PIL import Image, ImageDraw, ImageFont

TEMP = os.environ.get('TEMP', r'C:\Users\32686\AppData\Local\Temp')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(TEMP, 'wb-door', 'frames')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'shots', '18-门敞开穿门分镜.png')

# 关键时刻（ms，相对 flyShop 触发点）与中文说明
# 时序 v2：门开(0→620)与抵近 fly(0→900)同时 → push(900→2100)
#          → veil ≈1600（相机距门面 0.13）→ 跳转 ≈1860（z≈0.078，压着门面）
# 关键时刻（ms，相对 flyShop 触发点）与中文说明
# v3 时序：开门(880)与抵近(900)同时进行同时结束 → push(easeOut，~200ms 后 veil)
# → veil 后 260ms 跳转 ≈ 1.36s
KEYS = [
    (0,    '触发 · 门开+镜头同动'),
    (250,  '门开 ~60° · 抵近中'),
    (550,  '门开 ~100° · 逼近'),
    (850,  '门将全开'),
    (980,  '门全开 · 推进起步'),
    (1120, '门口 · 压暗起'),
    (1280, '门面 · 将换景'),
    (1400, '末帧（暗）'),
]

meta = json.load(open(os.path.join(SRC, '_meta.json'), encoding='utf-8'))
files = {m['ms']: m['file'] for m in meta}

def pick(target):
    best = min(meta, key=lambda m: abs(m['ms'] - target))
    return best['file'], best['ms']

# 每格目标宽度（JPEG 源已 ≤1280 宽；缩到 480 够看）
CELL_W, CELL_H = 480, 270
PAD, LABEL_H = 10, 44
COLS, ROWS = 4, 2
W = COLS * CELL_W + (COLS + 1) * PAD
H = ROWS * (CELL_H + LABEL_H) + (ROWS + 1) * PAD

sheet = Image.new('RGB', (W, H), (28, 26, 23))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
except Exception:
    font = ImageFont.load_default()

for idx, (t, label) in enumerate(KEYS):
    fn, real_ms = pick(t)
    img = Image.open(os.path.join(SRC, fn)).convert('RGB')
    iw, ih = img.size
    # 等比缩放进 CELL_W×CELL_H（cover）
    s = max(CELL_W / iw, CELL_H / ih)
    img2 = img.resize((int(iw * s), int(ih * s)), Image.LANCZOS)
    left = (img2.width - CELL_W) // 2
    top = (img2.height - CELL_H) // 2
    img2 = img2.crop((left, top, left + CELL_W, top + CELL_H))

    col, row = idx % COLS, idx // COLS
    x = PAD + col * (CELL_W + PAD)
    y = PAD + row * (CELL_H + LABEL_H + PAD) if False else PAD + row * (CELL_H + LABEL_H) + (row) * PAD
    y = PAD + row * (CELL_H + LABEL_H + PAD)
    sheet.paste(img2, (x, y))
    # 边框
    draw.rectangle([x, y, x + CELL_W - 1, y + CELL_H - 1], outline=(150, 130, 90), width=1)
    # 标签
    ly = y + CELL_H + 4
    draw.text((x + 6, ly), label, fill=(235, 225, 195), font=font)
    draw.text((x + 6, ly + 22), f'{real_ms} ms', fill=(170, 160, 135), font=font)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT, 'PNG')
print(f'分镜图 → {OUT}  ({sheet.size[0]}x{sheet.size[1]})')
