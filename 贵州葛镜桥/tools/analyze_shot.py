# -*- coding: utf-8 -*-
"""
analyze_shot.py — 分析三维查看器截图，客观判断画面里到底有没有内容

只看画面中央区域（避开四周的 UI 面板），统计与清屏色不同的像素占比。
占比接近 0% 说明模型没有渲染出来；有明显占比说明渲染成功。

用法:
    python analyze_shot.py <screenshot.png>
"""
import sys

from PIL import Image

CLEAR_COLOR = (10, 13, 19)      # 与 CONFIG.renderer.clearColor 保持一致
TOLERANCE = 8


def is_background(c):
    return all(abs(c[i] - CLEAR_COLOR[i]) <= TOLERANCE for i in range(3))


def main():
    path = sys.argv[1]
    im = Image.open(path).convert("RGB")
    w, h = im.size

    # 中央 56% 区域：四周留给 HUD / 性能面板 / 工具栏
    crop = im.crop((int(w * 0.22), int(h * 0.22), int(w * 0.78), int(h * 0.78)))
    pixels = list(crop.getdata())
    total = len(pixels)

    content = [c for c in pixels if not is_background(c)]
    ratio = 100.0 * len(content) / total if total else 0.0

    verdict = "有内容" if ratio > 0.5 else ("极少" if ratio > 0.05 else "空白")

    print("  中央区域 %d px | 非背景 %d (%.2f%%) | 颜色种类 %d | %s"
          % (total, len(content), ratio, len(set(pixels)), verdict), end="")

    if content:
        brightest = max(content, key=lambda c: sum(c))
        avg = tuple(sum(c[i] for c in content) // len(content) for i in range(3))
        print(" | 最亮 RGB%s 均值 RGB%s" % (brightest, avg))
    else:
        print()


if __name__ == "__main__":
    main()
