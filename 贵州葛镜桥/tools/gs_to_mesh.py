# -*- coding: utf-8 -*-
"""
gs_to_mesh.py — 把训练好的 3D Gaussian Splatting 模型（scene.ply）转成三角网格

采用学术界与社区（SuGaR / 3DGS-to-PC, arXiv:2501.07478）公认的训练后转换范式：

    高斯椭球 → 表面采样点(中心 + 最短轴法向) → 法向朝相机定向 → 泊松重建 → 网格

步骤：
  1. 解析 scene.ply（二进制小端，23 个 float 属性）
  2. 过滤低不透明度高斯（噪声）与异常巨大高斯（漂浮物）
  3. 每个高斯取中心作为表面采样点；旋转矩阵中最短缩放轴的方向即表面法向
  4. 用 SfM 相机中心把法向定向为「朝外」（朝离它最近的相机）
  5. Open3D 泊松重建（带颜色），按密度分位裁掉外包气泡
  6. 二次误差度量简化到目标面数，导出带顶点色的二进制 PLY（含面片）
  7. 用正交投影渲染若干预览图供人工检查

用法:
  python gs_to_mesh.py [--ply models/scene.ply] [--out models/scene_mesh.ply]
                      [--depth 10] [--target-tris 1200000] [--preview-only]
"""
import argparse
import os
import sys
import time

import numpy as np

# ---------------------------------------------------------------- PLY 解析

def read_ply_fields(path):
    """读取二进制小端 PLY，返回 (属性字典)。只抽取网格化需要的字段。"""
    with open(path, "rb") as f:
        raw = f.read(1 << 16)
    idx = raw.find(b"end_header")
    if idx == -1:
        raise ValueError("不是合法 PLY：找不到 end_header")
    header_bytes = raw.find(b"\n", idx) + 1
    header_text = raw[:header_bytes].decode("ascii", "replace")

    fmt, n_vert, props = None, 0, []
    for line in header_text.splitlines():
        line = line.strip()
        if line.startswith("format "):
            fmt = line.split()[1]
        elif line.startswith("element vertex"):
            n_vert = int(line.split()[-1])
        elif line.startswith("property") and "list" not in line:
            parts = line.split()
            props.append((parts[1], parts[2]))
    if fmt != "binary_little_endian":
        raise ValueError("只支持 binary_little_endian，实际为 " + str(fmt))

    dtype = np.dtype([(name, "<f4") for _, name in props])
    data = np.fromfile(path, dtype=dtype, count=n_vert, offset=header_bytes)
    return {name: np.ascontiguousarray(data[name]) for _, name in props}


def quat_to_rotmat(qw, qx, qy, qz):
    """四元数 (w,x,y,z) → 旋转矩阵 (N,3,3)。列向量约定：R @ v。"""
    R = np.empty((len(qw), 3, 3), dtype=np.float32)
    R[:, 0, 0] = 1 - 2 * (qy * qy + qz * qz)
    R[:, 0, 1] = 2 * (qx * qy - qz * qw)
    R[:, 0, 2] = 2 * (qx * qz + qy * qw)
    R[:, 1, 0] = 2 * (qx * qy + qz * qw)
    R[:, 1, 1] = 1 - 2 * (qx * qx + qz * qz)
    R[:, 1, 2] = 2 * (qy * qz - qx * qw)
    R[:, 2, 0] = 2 * (qx * qz - qy * qw)
    R[:, 2, 1] = 2 * (qy * qz + qx * qw)
    R[:, 2, 2] = 1 - 2 * (qx * qx + qy * qy)
    return R


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    web = os.path.dirname(here)
    ap.add_argument("--ply", default=os.path.join(web, "models", "scene.ply"))
    ap.add_argument("--cams", default=os.path.join(web, "models", "_cam_centers_sfm.npy"))
    ap.add_argument("--out", default=os.path.join(web, "models", "scene_mesh.ply"))
    ap.add_argument("--min-opacity", type=float, default=0.05)
    ap.add_argument("--max-scale-q", type=float, default=0.999,
                    help="剔除最胖的 x% 高斯（漂浮物），0 表示不过滤")
    ap.add_argument("--depth", type=int, default=10, help="泊松八叉树深度")
    ap.add_argument("--density-q", type=float, default=0.02,
                    help="按密度分位裁掉底部 x% 顶点（去外包气泡）")
    ap.add_argument("--target-tris", type=int, default=1_200_000)
    ap.add_argument("--cam-step", type=int, default=3, help="法向定向时相机抽样间隔")
    ap.add_argument("--voxel", type=float, default=0.0,
                    help=">0 时泊松前按该体素尺寸降采样（世界单位），控制内存；"
                         "0 表示不降采样")
    ap.add_argument("--preview-only", action="store_true",
                    help="跳过重建，只渲染现有网格的预览图")
    args = ap.parse_args()

    if args.preview_only:
        preview_mesh(args.out)
        return

    t0 = time.time()
    print("[1/6] 读取 PLY …", flush=True)
    d = read_ply_fields(args.ply)
    n_all = len(d["x"])
    xyz = np.stack([d["x"], d["y"], d["z"]], axis=1).astype(np.float32)
    opacity = sigmoid(d["opacity"].astype(np.float32))
    scales = np.exp(np.stack([d["scale_0"], d["scale_1"], d["scale_2"]], axis=1).astype(np.float32))
    R = quat_to_rotmat(d["rot_0"], d["rot_1"], d["rot_2"], d["rot_3"])
    color = 0.5 + 0.28209479177387814 * np.stack(
        [d["f_dc_0"], d["f_dc_1"], d["f_dc_2"]], axis=1).astype(np.float32)
    color = np.clip(color, 0.0, 1.0)
    print(f"      高斯总数 {n_all:,}")

    # ---- 过滤
    keep = opacity >= args.min_opacity
    if args.max_scale_q and args.max_scale_q < 1.0:
        smax = scales.max(axis=1)
        cutoff = np.quantile(smax, args.max_scale_q)
        keep &= smax <= cutoff
    xyz, opacity, scales, R, color = (a[keep] for a in (xyz, opacity, scales, R, color))
    print(f"[2/6] 过滤后剩余 {len(xyz):,} 个高斯（不透明度≥{args.min_opacity}"
          f"，剔除最胖 {round((1-args.max_scale_q)*100,2)}%）")

    # ---- 法向：最短缩放轴（必须在降采样之前算，因为法向来自旋转矩阵列向量）
    axis = np.argmin(scales, axis=1)                     # (N,)
    normals = np.take_along_axis(R, axis[:, None, None], axis=2)[:, :, 0]
    # R 的第 axis 列 = 该轴在世界坐标下的方向

    # ---- 体素降采样（可选，控制泊松/定向内存；点/法向/颜色一起降采样）
    if args.voxel > 0:
        import open3d as o3d
        pcd_tmp = o3d.geometry.PointCloud()
        pcd_tmp.points = o3d.utility.Vector3dVector(xyz.astype(np.float64))
        pcd_tmp.normals = o3d.utility.Vector3dVector(normals.astype(np.float64))
        pcd_tmp.colors = o3d.utility.Vector3dVector(color.astype(np.float64))
        n_before = len(xyz)
        pcd_tmp = pcd_tmp.voxel_down_sample(args.voxel)
        xyz = np.asarray(pcd_tmp.points).astype(np.float32)
        normals = np.asarray(pcd_tmp.normals).astype(np.float32)
        color = np.asarray(pcd_tmp.colors).astype(np.float32)
        # 降采样后重新归一化法向长度
        nl = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = normals / np.maximum(nl, 1e-8)
        print(f"      体素降采样({args.voxel})：{n_before:,} → {len(xyz):,} 点")

    # ---- 法向定向：优先用相机；相机数据不可用（如解算全 NaN）时
    #      改用 Open3D 切平面一致定向（kNN 图 + 最小生成树传播，无需相机）
    cams = None
    if args.cams and os.path.exists(args.cams):
        try:
            cams_sfm = np.load(args.cams).astype(np.float32)
            cams_sfm = cams_sfm[np.isfinite(cams_sfm).all(axis=1)]
            if len(cams_sfm) >= 8:
                # SfM(+Z up) → PLY 资产坐标，见 config.js 的坐标系推导
                cams = np.stack([cams_sfm[:, 0], -cams_sfm[:, 2], cams_sfm[:, 1]], axis=1)
                cams = cams[::args.cam_step]
        except Exception as e:
            print(f"      相机文件读取失败（{e}），改用一致定向")

    if cams is not None:
        print(f"[3/6] 法向朝相机定向：相机 {len(cams)} 台（抽样 1/{args.cam_step}）")
        for name, arr in (("cam_x", cams[:, 0]), ("cam_y", cams[:, 1]), ("cam_z", cams[:, 2])):
            print(f"        {name}: [{arr.min():.2f}, {arr.max():.2f}]")
        for name, arr in (("pts_x", xyz[:, 0]), ("pts_y", xyz[:, 1]), ("pts_z", xyz[:, 2])):
            print(f"        {name}: [{arr.min():.2f}, {arr.max():.2f}]")

        CH = 40000
        flip_count = 0
        for i in range(0, len(xyz), CH):
            j = min(i + CH, len(xyz))
            P = xyz[i:j]                                  # (c,3)
            # 最近相机：|P|² + |C|² - 2 P·C
            d2 = ((P * P).sum(1)[:, None] + (cams * cams).sum(1)[None, :]
                  - 2.0 * P @ cams.T)                      # (c,K)
            nn = cams[np.argmin(d2, axis=1)]               # (c,3)
            to_cam = nn - P
            s = np.einsum("ij,ij->i", normals[i:j], to_cam)
            flip = s < 0
            normals[i:j][flip] *= -1.0
            flip_count += int(flip.sum())
        print(f"      翻转了 {flip_count:,} / {len(xyz):,} 条法向"
              f"（{100.0*flip_count/max(1,len(xyz)):.1f}%）")
    else:
        import open3d as o3d
        print("[3/6] 相机数据不可用，改用切平面一致定向（MST，较慢）…", flush=True)
        t_orient = time.time()
        pcd_o = o3d.geometry.PointCloud()
        pcd_o.points = o3d.utility.Vector3dVector(xyz.astype(np.float64))
        pcd_o.normals = o3d.utility.Vector3dVector(normals.astype(np.float64))
        pcd_o.orient_normals_consistent_tangent_plane(k=15)
        normals = np.asarray(pcd_o.normals).astype(np.float32)
        print(f"      一致定向完成（{time.time()-t_orient:.0f} 秒）")

    # ---- Open3D 泊松
    print("[4/6] 泊松重建（depth=%d）…" % args.depth, flush=True)
    import open3d as o3d

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(xyz.astype(np.float64))
    pcd.normals = o3d.utility.Vector3dVector(normals.astype(np.float64))
    pcd.colors = o3d.utility.Vector3dVector(color.astype(np.float64))

    t1 = time.time()
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=args.depth, scale=1.1, linear_fit=False, n_threads=-1)
    print(f"      泊松完成：{len(mesh.vertices):,} 顶点 / {len(mesh.triangles):,} 面"
          f"（{time.time()-t1:.0f} 秒）")

    dens = np.asarray(densities)
    q = np.quantile(dens, args.density_q)
    mesh.remove_vertices_by_mask(dens < q)
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    print(f"[5/6] 密度裁剪（q={args.density_q}）后：{len(mesh.vertices):,} 顶点 / "
          f"{len(mesh.triangles):,} 面")

    if args.target_tris and len(mesh.triangles) > args.target_tris:
        mesh = mesh.simplify_quadric_decimation(args.target_tris)
        print(f"      简化到 {len(mesh.triangles):,} 面（目标 {args.target_tris:,}）")

    # 重新归一化颜色到 uchar 常见范围（保持 float 存储，写 PLY 时 Open3D 会处理）
    o3d.io.write_triangle_mesh(args.out, mesh,
                               write_ascii=False, compressed=False,
                               write_vertex_normals=True, write_vertex_colors=True,
                               print_progress=True)
    size_mb = os.path.getsize(args.out) / 1048576
    print(f"[6/6] 已写出 {args.out}（{size_mb:.1f} MB），总耗时 {time.time()-t0:.0f} 秒")

    preview_mesh(args.out)


# ---------------------------------------------------------------- 预览渲染

def preview_mesh(mesh_path, out_prefix=None, views=None):
    """正交投影渲染网格顶点（带颜色），快速人工检查网格质量。"""
    from PIL import Image

    import open3d as o3d
    mesh = o3d.io.read_triangle_mesh(mesh_path)
    V = np.asarray(mesh.vertices)
    C = np.asarray(mesh.vertex_colors)
    if len(V) == 0:
        raise RuntimeError("网格为空")

    if out_prefix is None:
        out_prefix = os.path.splitext(mesh_path)[0] + "_preview"
    if views is None:
        views = {
            "iso":   ((0.6, 0.55, 0.58), (0.0, 1.0, 0.0)),
            "front": ((0.0, 0.2, 1.0), (0.0, 1.0, 0.0)),
            "top":   ((0.0, 1.0, 0.0), (0.0, 0.0, -1.0)),
        }

    for name, (eye_dir, up) in views.items():
        t = time.time()
        e = np.array(eye_dir, dtype=np.float64)
        e /= np.linalg.norm(e)
        upv = np.array(up, dtype=np.float64)
        right = np.cross(upv, e); right /= np.linalg.norm(right)
        upv = np.cross(e, right)

        X = V @ right
        Y = V @ upv
        D = V @ e

        W = H = 1400
        xmin, xmax = np.percentile(X, [0.5, 99.5])
        ymin, ymax = np.percentile(Y, [0.5, 99.5])
        span = max(xmax - xmin, ymax - ymin) * 1.05
        cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
        ix = ((X - cx) / span + 0.5) * (W - 1)
        iy = ((Y - cy) / span + 0.5) * (H - 1)

        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        ixf, iyf, Df, Cf = ix[ok].astype(np.int32), iy[ok].astype(np.int32), D[ok], C[ok]

        order = np.argsort(-Df)         # 远的先画，近的覆盖
        img = np.zeros((H, W, 3), dtype=np.uint8)
        img[iyf[order], ixf[order]] = (Cf[order] * 255).astype(np.uint8)

        path = f"{out_prefix}_{name}.png"
        Image.fromarray(img).save(path)
        print(f"      预览 {name}: {path}（{time.time()-t:.0f}s）")


if __name__ == "__main__":
    main()
