# -*- coding: utf-8 -*-
"""
inspect_ply.py — 快速检查 3D Gaussian Splatting 的 .ply 文件

输出：
  * PLY 头部信息（格式 / 顶点数 / 属性列表 / 每点字节数）
  * 抽样点的 xyz 分布（分位数），用于推算场景中心、尺度与主轴朝向
  * opacity 的 sigmoid 前取值分布，用于评估裁剪阈值

用法:
  python inspect_ply.py <path/to/scene.ply> [sample_count]
"""
import math
import os
import struct
import sys


def read_header(path):
    with open(path, "rb") as f:
        raw = f.read(16384)
    idx = raw.find(b"end_header")
    if idx == -1:
        raise ValueError("不是合法的 PLY 文件：找不到 end_header")
    nl = raw.find(b"\n", idx)
    header_bytes = nl + 1
    header_text = raw[:header_bytes].decode("ascii", "replace")
    return header_text, header_bytes


def parse_header(header_text):
    fmt, vertex_count, props = None, 0, []
    for line in header_text.splitlines():
        line = line.strip()
        if line.startswith("format "):
            fmt = line.split()[1]
        elif line.startswith("element vertex"):
            vertex_count = int(line.split()[-1])
        elif line.startswith("property") and "list" not in line:
            props.append(line.split()[-1])
    return fmt, vertex_count, props


def pct(sorted_vals, p):
    if not sorted_vals:
        return float("nan")
    k = (len(sorted_vals) - 1) * p
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "scene.ply"
    want = int(sys.argv[2]) if len(sys.argv) > 2 else 300000

    file_size = os.path.getsize(path)
    header_text, header_bytes = read_header(path)
    fmt, n_vert, props = parse_header(header_text)
    stride = len(props) * 4

    print("=" * 62)
    print("文件        :", path)
    print("大小        : %.2f MB (%d bytes)" % (file_size / 1048576, file_size))
    print("格式        :", fmt)
    print("-" * 62)
    print("顶点(高斯)数:", "{:,}".format(n_vert))
    print("属性个数    :", len(props))
    print("每点字节数  :", stride)
    print("头部字节数  :", header_bytes)
    expected = header_bytes + n_vert * stride
    print("理论总大小  : %d  (%s)" % (expected, "一致" if expected == file_size else "不一致!"))
    print("-" * 62)
    print("属性列表    :")
    for i in range(0, len(props), 6):
        print("   ", ", ".join(props[i:i + 6]))

    if fmt != "binary_little_endian":
        print("\n[!] 非 binary_little_endian，跳过数值采样")
        return

    # SH 阶数推断：f_rest 系数个数 / 3  ->  n(n+1)-1
    n_rest = sum(1 for p in props if p.startswith("f_rest_"))
    sh_degree = "n/a"
    if n_rest:
        for d in range(0, 5):
            if (d + 1) * (d + 1) - 1 == n_rest // 3:
                sh_degree = d
                break
    print("-" * 62)
    print("SH 阶数     :", sh_degree)

    ix, iy, iz = props.index("x"), props.index("y"), props.index("z")
    iop = props.index("opacity") if "opacity" in props else None
    isc = props.index("scale_0") if "scale_0" in props else None

    step = max(1, n_vert // want)
    xs, ys, zs, ops, scs = [], [], [], [], []
    buf = bytearray(stride * min(step, 4096))
    mv = memoryview(buf)

    with open(path, "rb") as f:
        f.seek(header_bytes)
        i = 0
        while i < n_vert:
            block = min(step, n_vert - i)
            need = block * stride
            if len(buf) < need:
                buf = bytearray(need)
                mv = memoryview(buf)
            got = f.readinto(mv[:need])
            if not got or got < need:
                break
            b = bytes(mv[:got])
            for j in range(block):
                base = j * stride
                x, y, z = struct.unpack_from("<3f", b, base)
                xs.append(x)
                ys.append(y)
                zs.append(z)
                if iop is not None:
                    ops.append(struct.unpack_from("<f", b, base + iop * 4)[0])
                if isc is not None:
                    scs.append(struct.unpack_from("<f", b, base + isc * 4)[0])
            f.seek((step - block) * stride, os.SEEK_CUR)
            i += step

    print("-" * 62)
    print("抽样点数    : {:,}  (每 {} 个取 1)".format(len(xs), step))

    for name, arr in (("X", xs), ("Y", ys), ("Z", zs)):
        s = sorted(arr)
        print("  %s  min=%10.3f  p0.5=%10.3f  p5=%10.3f  p50=%10.3f  p95=%10.3f  p99.5=%10.3f  max=%10.3f"
              % (name, s[0], pct(s, .005), pct(s, .05), pct(s, .5), pct(s, .95), pct(s, .995), s[-1]))

    def extent(arr):
        s = sorted(arr)
        return pct(s, .995) - pct(s, .005)

    ex, ey, ez = extent(xs), extent(ys), extent(zs)
    print("-" * 62)
    print("有效范围(剔除飞点, p99.5-p0.5):  X=%.3f  Y=%.3f  Z=%.3f" % (ex, ey, ez))

    sa = sorted(xs); sb = sorted(ys); sc = sorted(zs)
    cx = (pct(sa, .005) + pct(sa, .995)) / 2
    cy = (pct(sb, .005) + pct(sb, .995)) / 2
    cz = (pct(sc, .005) + pct(sc, .995)) / 2
    print("场景中心(bbox中心)              : (%.3f, %.3f, %.3f)" % (cx, cy, cz))
    print("最大跨度                        : %.3f  -> 相机建议起始距离 ~ %.3f"
          % (max(ex, ey, ez), max(ex, ey, ez) * 1.6))

    if ops:
        so = sorted(ops)
        print("-" * 62)
        print("opacity(未 sigmoid)  p1=%.3f p5=%.3f p50=%.3f p95=%.3f p99=%.3f"
              % (pct(so, .01), pct(so, .05), pct(so, .5), pct(so, .95), pct(so, .99)))
        # sigmoid 之后的真实不透明度
        sm = lambda v: 1.0 / (1.0 + math.exp(-v))
        print("opacity(sigmoid 后)  p1=%.4f p5=%.4f p50=%.4f p95=%.4f p99=%.4f"
              % (sm(pct(so, .01)), sm(pct(so, .05)), sm(pct(so, .5)),
                 sm(pct(so, .95)), sm(pct(so, .99))))
        print("不透明度 < 0.05 的点占比: %.1f%%"
              % (100.0 * sum(1 for v in ops if sm(v) < 0.05) / len(ops)))

    if scs:
        ss = sorted(scs)
        print("-" * 62)
        print("scale(未 exp)      p5=%.3f p50=%.3f p95=%.3f   -> 实际尺寸 p50=%.4f"
              % (pct(ss, .05), pct(ss, .5), pct(ss, .95), math.exp(pct(ss, .5))))
    print("=" * 62)


if __name__ == "__main__":
    main()
