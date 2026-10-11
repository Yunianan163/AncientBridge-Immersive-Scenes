# -*- coding: utf-8 -*-
"""
判定 SfM 世界坐标系的「上」方向。

依据：拍摄相机必定位于它所拍摄的地面之上。
把相机中心与其正下方那片稀疏点的地面高度作比较，
统计有多少比例的相机位于地面之上，比例接近 100% 的方向即为真实上方。

注意：Spirula 的 sparse 二进制与标准 COLMAP 有两处差异 ——
    * camera_id 是 int32（4 字节），标准 COLMAP 是 uint64
    * 每张影像的 2D 点记录是 24 字节，标准 COLMAP 是 16 字节
本脚本已按 Spirula 的实际布局解析，并会校验解析终点与文件大小是否吻合。

用法：
    python colmap_up_axis.py <sparse_dir>
"""

import os
import struct
import sys

import numpy as np

TYPE_MAP = {0: 3, 1: 4, 2: 4, 3: 4, 4: 5, 5: 8, 6: 8, 7: 8, 8: 12, 9: 12, 10: 12}
IMG_FIXED = 64        # image_id(4) + qvec(32) + tvec(24) + camera_id(4)
PT2D_SIZE = 24        # 与标准 COLMAP 的 16 字节不同


def read_cameras(path):
    buf = open(path, "rb").read()
    n = struct.unpack_from("<Q", buf, 0)[0]
    off = 8
    out = {}
    for _ in range(n):
        cam_id, model_id, w, h = struct.unpack_from("<iiQQ", buf, off)
        off += 24
        k = TYPE_MAP.get(model_id, 4)
        out[cam_id] = {"model": model_id, "size": (w, h),
                       "params": struct.unpack_from("<%dd" % k, buf, off)}
        off += 8 * k
    return out


def read_images(path):
    buf = open(path, "rb").read()
    n = struct.unpack_from("<Q", buf, 0)[0]
    off = 8
    ids, cams, qs, ts, names = [], [], [], [], []
    for _ in range(n):
        ids.append(struct.unpack_from("<i", buf, off)[0])
        qs.append(struct.unpack_from("<4d", buf, off + 4))
        ts.append(struct.unpack_from("<3d", buf, off + 36))
        cams.append(struct.unpack_from("<i", buf, off + 60)[0])
        off += IMG_FIXED
        end = buf.index(b"\x00", off)
        names.append(buf[off:end].decode("utf-8", "replace"))
        off = end + 1
        n2d = struct.unpack_from("<Q", buf, off)[0]
        off += 8 + PT2D_SIZE * n2d
    assert off == len(buf), "images.bin 解析终点 %d != 文件大小 %d" % (off, len(buf))
    return (np.array(ids), np.array(cams), np.array(qs), np.array(ts), names)


def read_points3D(path):
    buf = open(path, "rb").read()
    n = struct.unpack_from("<Q", buf, 0)[0]
    xyz = np.empty((n, 3))
    rgb = np.empty((n, 3), dtype=np.uint8)
    off = 8
    for i in range(n):
        off += 8
        xyz[i] = struct.unpack_from("<3d", buf, off)
        off += 24
        rgb[i] = struct.unpack_from("<3B", buf, off)
        off += 3 + 8
        tl = struct.unpack_from("<Q", buf, off)[0]
        off += 8 + 8 * tl
    assert off == len(buf), "points3D.bin 解析终点 %d != 文件大小 %d" % (off, len(buf))
    return xyz, rgb


def quat_to_rot(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([
        [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * z * w, 2 * x * z + 2 * y * w],
        [2 * x * y + 2 * z * w, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * x * w],
        [2 * x * z - 2 * y * w, 2 * y * z + 2 * x * w, 1 - 2 * x * x - 2 * y * y],
    ])


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "."
    print("稀疏重建：%s" % d)

    cam_par = read_cameras(os.path.join(d, "cameras.bin"))
    ids, cam_ids, qs, ts, names = read_images(os.path.join(d, "images.bin"))
    pts, rgb = read_points3D(os.path.join(d, "points3D.bin"))

    print("  相机 {:,} 张（内参组 {}）   稀疏点 {:,}".format(
        len(ids), sorted(cam_par.keys()), len(pts)))
    for cid, c in cam_par.items():
        print("    内参组 %d: model=%s  %dx%d  params=%s" % (
            cid, c["model"], c["size"][0], c["size"][1],
            [round(v, 3) for v in c["params"]]))

    C = np.empty((len(ids), 3))
    for i in range(len(ids)):
        C[i] = -quat_to_rot(qs[i]).T @ ts[i]

    def rng(tag, a):
        lo, hi = np.percentile(a, [0.5, 99.5], axis=0)
        print("  %-9s X[%8.3f,%8.3f]  Y[%8.3f,%8.3f]  Z[%8.3f,%8.3f]"
              % (tag, lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))

    rng("相机中心", C)
    rng("稀疏点云", pts)
    print("  相机中心均值:", [round(v, 4) for v in C.mean(axis=0)])
    print("  稀疏点云均值:", [round(v, 4) for v in pts.mean(axis=0)])

    print()
    print("=========== 轴线检验：相机是否位于地面之上 ===========")
    grid = 96
    scores = {}

    for ai, aname in ((0, "X"), (1, "Y"), (2, "Z")):
        for sign in (+1, -1):
            up = np.zeros(3)
            up[ai] = sign
            h_pt = pts @ up
            h_cam = C @ up

            o = [k for k in range(3) if k != ai]
            u, v = pts[:, o[0]], pts[:, o[1]]
            u0, u1 = np.percentile(u, [0.2, 99.8])
            v0, v1 = np.percentile(v, [0.2, 99.8])

            def cell_of(a, lo, hi, n=grid):
                return np.clip(((a - lo) / max(hi - lo, 1e-9) * n).astype(int), 0, n - 1)

            gidx = cell_of(v, v0, v1) * grid + cell_of(u, u0, u1)
            order = np.argsort(gidx, kind="stable")
            cs, hs = gidx[order], h_pt[order]
            bnd = np.searchsorted(cs, np.arange(grid * grid + 1))

            ground = np.full(grid * grid, np.nan)
            for i in range(grid * grid):
                a, b = bnd[i], bnd[i + 1]
                if b - a >= 5:
                    ground[i] = np.percentile(hs[a:b], 5.0)

            ci = cell_of(C[:, o[1]], v0, v1) * grid + cell_of(C[:, o[0]], u0, u1)
            gval = ground[ci]
            ok = np.isfinite(gval)
            above = h_cam[ok] > gval[ok]
            frac = 100.0 * above.mean() if ok.any() else float("nan")
            med = float(np.median(h_cam[ok] - gval[ok])) if ok.any() else float("nan")
            key = "%s%s" % ("+" if sign > 0 else "-", aname)
            scores[key] = frac
            print("  上 = %-3s : 相机在地面之上 %6.2f%%  (%d/%d)   中位高差 %+9.4f"
                  % (key, frac, int(above.sum()), int(ok.sum()), med))

    print()
    best = max(scores, key=lambda k: scores[k])
    print("★ 比例最高的方向：上方向 = %s  (%.2f%%)" % (best, scores[best]))


if __name__ == "__main__":
    main()
