# -*- coding: utf-8 -*-
"""
annotate_topdown.py — 给正俯视截图叠加世界坐标网格

用途
    俯视截图里能看见桥，但没法直接读出它落在哪个世界坐标上。
    这个脚本按已知的相机参数（位置、fov、视口尺寸）做一次「像素 → 世界」反算，
    把等间距的坐标网格画回去，看一眼就知道特征点的坐标。

    注意：正俯视的像素映射依赖被观测点的高度。网格是按参考平面（相机注视点）
    画的，高于/低于该平面的物体会向外/向内偏移一点。所以网格只用来**粗定位**，
    精确坐标仍以页面里的射线检测（pickAtScreen）为准。

用法
    python annotate_topdown.py <截图> <输出图> <相机X> <相机Y> <相机Z> <注视Y> <fov度> <视口宽> <视口高>
"""

import sys

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def main():
    if len(sys.argv) < 10:
        print(__doc__)
        sys.exit(1)

    src, dst = sys.argv[1], sys.argv[2]
    cx, cy, cz = (float(sys.argv[i]) for i in (3, 4, 5))
    look_y = float(sys.argv[6])
    fov = float(sys.argv[7])
    vw, vh = int(sys.argv[8]), int(sys.argv[9])

    # 相机在注视点正上方 H，屏幕右 = +X，屏幕上 = -Z（相机 up 取 (0,0,-1)）
    import math
    height = cy - look_y
    half_h = height * math.tan(math.radians(fov / 2.0))
    half_w = half_h * (vw / float(vh))

    def world_to_px(wx, wz):
        ndc_x = (wx - cx) / half_w
        ndc_y = (cz - wz) / half_h
        return (ndc_x * 0.5 + 0.5) * vw, (1.0 - (ndc_y * 0.5 + 0.5)) * vh

    im = Image.open(src).convert("RGB")

    # 放大：我的判读分辨率有限，等比放大后再看细节
    scale = 2.5
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    dr = ImageDraw.Draw(im, "RGBA")

    font = load_font(18)

    def line(p0, p1, color, width):
        dr.line([(p0[0] * scale, p0[1] * scale), (p1[0] * scale, p1[1] * scale)], fill=color, width=width)

    # 粗定位用：每 0.2 单位一条；每 1.0 单位加粗并标数值
    step_minor, step_major = 0.2, 1.0
    x0 = math.floor((cx - half_w) / step_minor) * step_minor
    z0 = math.floor((cz - half_h) / step_minor) * step_minor

    nx = int((2 * half_w) / step_minor) + 2
    nz = int((2 * half_h) / step_minor) + 2

    for i in range(nx):
        wx = x0 + i * step_minor
        px0, py0 = world_to_px(wx, cz - half_h)
        px1, py1 = world_to_px(wx, cz + half_h)
        is_major = abs(wx / step_major - round(wx / step_major)) < 1e-6
        line((px0, py0), (px1, py1),
             (255, 60, 60, 200 if is_major else 70),
             3 if is_major else 1)
        if is_major and 0 <= px0 < vw:
            dr.text((px0 * scale + 4, 8 * scale),
                    "x=%.0f" % wx, fill=(255, 90, 90, 255), font=font)

    for j in range(nz):
        wz = z0 + j * step_minor
        px0, py0 = world_to_px(cx - half_w, wz)
        px1, py1 = world_to_px(cx + half_w, wz)
        is_major = abs(wz / step_major - round(wz / step_major)) < 1e-6
        line((px0, py0), (px1, py1),
             (60, 160, 255, 200 if is_major else 70),
             3 if is_major else 1)
        if is_major and 0 <= py0 < vh:
            dr.text((8 * scale, py0 * scale + 4),
                    "z=%.0f" % wz, fill=(90, 180, 255, 255), font=font)

    im.save(dst)
    print("已写出: %s  (%d x %d)" % (dst, im.width, im.height))
    print()
    print("换算参数（供像素 → 世界坐标反查）:")
    print("  相机 (%.4f, %.4f, %.4f)   注视 Y = %.4f" % (cx, cy, cz, look_y))
    print("  半高 = %.4f  半宽 = %.4f   视口 %d x %d  放大 %.1fx" % (half_h, half_w, vw, vh, scale))
    print("  网格步长: 细 %.2f / 粗 %.2f（单位: 场景单位）" % (step_minor, step_major))


if __name__ == "__main__":
    main()
