# -*- coding: utf-8 -*-
"""
bake_vertex_colors.py — 纹理烘焙第二步：把泼溅渲染颜色烙进网格顶点

输入：bake_views/ 下的 16 机位截图（泼溅模型真实渲染，含 SH 视角项与
      半透明混合效果）+ views.json 里的相机矩阵
输出：scene_mesh_hd_baked.ply —— 几何不变，顶点色替换为多视角烘焙结果

每个顶点的处理：
  1. 资产坐标 → 世界坐标（绕 X 轴 180°，与 viewer 的 orientationDeg 一致）
  2. 投影到每个机位画面，落在视口内才采样
  3. 用 embree 光线投射做遮挡测试：被前景挡住的顶点不采该机位的颜色
  4. 颜色权重 = 与机位方向的夹角余弦^1.5（正对的机位权重高）
  5. 加权平均；没有任何机位覆盖的顶点保留原来的 f_dc 基础色

用法:
  python bake_vertex_colors.py [--mesh ../models/scene_mesh_hd.ply]
                               [--views bake_views] [--out ../models/scene_mesh_hd_baked.ply]
"""
import argparse
import json
import os
import time

import numpy as np
import open3d as o3d
from PIL import Image

CLEAR_COLOR = np.array([10.0, 13.0, 19.0])   # renderer.clearColor 0x0a0d13
MIN_PIXEL_DIFF = 40.0                        # 与清屏色差小于此值视为背景像素


def asset_to_world_matrix():
    """viewer.js 的 orientationDeg=[180,0,0]：绕 X 轴转 180°，(x,y,z)→(x,-y,-z)"""
    R = np.eye(4, dtype=np.float64)
    R[1, 1] = -1.0
    R[2, 2] = -1.0
    return R


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    web = os.path.dirname(here)
    ap.add_argument("--mesh", default=os.path.join(web, "models", "scene_mesh_hd.ply"))
    ap.add_argument("--views", default=os.path.join(here, "bake_views"))
    ap.add_argument("--out", default=os.path.join(web, "models", "scene_mesh_hd_baked.ply"))
    args = ap.parse_args()

    t0 = time.time()
    print("[1/4] 读取网格 …", flush=True)
    mesh = o3d.io.read_triangle_mesh(args.mesh)
    V = np.asarray(mesh.vertices)                     # (N,3) 资产坐标
    N = np.asarray(mesh.vertex_normals)               # (N,3) 资产坐标下的法向
    C0 = np.asarray(mesh.vertex_colors)               # (N,3) 原顶点色（兜底）
    T = np.asarray(mesh.triangles)
    print(f"      {len(V):,} 顶点 / {len(T):,} 面")

    # 资产 → 世界
    A = asset_to_world_matrix()
    Vw = (A[:3, :3] @ V.T).T
    Nw = (A[:3, :3] @ N.T).T
    Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-9)

    # 遮挡测试用的加速结构（世界坐标）
    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.core.Tensor(Vw.astype(np.float32)),
                        o3d.core.Tensor(T.astype(np.uint32)))

    views = json.load(open(os.path.join(args.views, "views.json"), encoding="utf-8"))
    print(f"[2/4] {len(views)} 个机位开始采样 …", flush=True)

    color_sum = np.zeros_like(Vw)
    weight_sum = np.zeros(len(Vw), dtype=np.float64)
    cover_count = np.zeros(len(Vw), dtype=np.int32)

    for vi, v in enumerate(views):
        cam = v["cam"]
        img = np.asarray(Image.open(v["image"]).convert("RGB")).astype(np.float64)
        H, W = img.shape[:2]

        # three.js 的 elements 是列主序，转成 numpy 行主序矩阵
        Mview = np.array(cam["viewMatrix"], dtype=np.float64).reshape(4, 4).T
        Proj = np.array(cam["projMatrix"], dtype=np.float64).reshape(4, 4).T
        cam_pos = np.array(cam["pos"], dtype=np.float64)

        # 资产→世界→视口
        world_h = np.hstack([Vw, np.ones((len(Vw), 1))])
        cam_h = world_h @ Mview.T                      # 相机空间
        clip = cam_h @ Proj.T                          # 裁剪空间
        w = clip[:, 3]
        valid = w > 1e-6
        ndc = np.zeros((len(Vw), 3))
        ndc[valid] = clip[valid, :3] / w[valid, None]

        px = (ndc[:, 0] * 0.5 + 0.5) * (W - 1)
        py = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * (H - 1)
        in_view = valid & (px >= 0) & (px < W) & (py >= 0) & (py < H) & (ndc[:, 2] > -1) & (ndc[:, 2] < 1)

        # 遮挡测试：从机位向每个视口内顶点发射线
        idx = np.where(in_view)[0]
        sel_count = 0
        if len(idx):
            origins = np.repeat(cam_pos[None, :], len(idx), axis=0)
            dirs = Vw[idx] - cam_pos[None, :]
            dist_to_v = np.linalg.norm(dirs, axis=1)
            dirs = dirs / np.maximum(dist_to_v, 1e-9)[:, None]
            rays = o3d.core.Tensor(np.hstack([origins, dirs]).astype(np.float32))
            result = scene.cast_rays(rays)
            t_hit = result["t_hit"].numpy()
            visible = np.ones(len(idx), dtype=bool)
            hit = np.isfinite(t_hit)
            visible[hit] = t_hit[hit] >= (dist_to_v[hit] - 2e-3)

            sel = idx[visible]
            xi = np.clip(px[sel].astype(np.int32), 0, W - 1)
            yi = np.clip(py[sel].astype(np.int32), 0, H - 1)
            colors = img[yi, xi]                       # (k,3)

            # 背景像素不采
            bg = np.abs(colors - CLEAR_COLOR).sum(axis=1) >= MIN_PIXEL_DIFF
            sel, colors = sel[bg], colors[bg]

            if len(sel):
                sel_count = len(sel)
                view_dir = Vw[sel] - cam_pos[None, :]
                view_dir /= np.maximum(np.linalg.norm(view_dir, axis=1, keepdims=True), 1e-9)
                facing = np.clip((Nw[sel] * (-view_dir)).sum(axis=1), 0.0, 1.0)
                wgt = facing ** 1.5

                np.add.at(color_sum, sel, colors * wgt[:, None])
                np.add.at(weight_sum, sel, wgt)
                np.add.at(cover_count, sel, 1)

        print(f"      机位 {vi:02d}: 视口内 {int(in_view.sum()):,}，有效采样 {sel_count:,}")

    print(f"[3/4] 烘焙完成：覆盖 {int((weight_sum > 0).sum()):,} / {len(Vw):,} 顶点"
          f"（{100.0 * (weight_sum > 0).sum() / len(Vw):.1f}%）", flush=True)

    baked = C0.copy()                       # C0 本身是 0~1
    has = weight_sum > 0
    # 截图像素是 0~255，Open3D 顶点色要 0~1（此前漏除 255，全部被 clip 成纯白）
    baked[has] = (color_sum[has] / weight_sum[has, None]) / 255.0
    baked = np.clip(baked, 0.0, 1.0)

    # 邻域扩散：未覆盖顶点从最近的已覆盖顶点取色（按距离加权，k=4），
    # 避免网格上出现「烘焙色 / 基础色」拼接感。
    if (~has).any() and has.any():
        print("      邻域扩散填充未覆盖顶点 …", flush=True)
        pc_cover = o3d.geometry.PointCloud()
        pc_cover.points = o3d.utility.Vector3dVector(Vw[has])
        kdt = o3d.geometry.KDTreeFlann(pc_cover)
        cols_cover = baked[has]
        unc = np.where(~has)[0]
        filled = np.zeros((len(unc), 3))
        for j, vi_unc in enumerate(unc):
            k, idx, d2 = kdt.search_knn_vector_3d(Vw[vi_unc], 4)
            if k == 0:
                continue
            w = 1.0 / (np.sqrt(np.asarray(d2[:k])) + 1e-6)
            cols = cols_cover[np.asarray(idx[:k])]
            filled[j] = (cols * w[:, None]).sum(axis=0) / w.sum()
        baked[unc] = np.clip(filled, 0.0, 1.0)

    mesh.vertex_colors = o3d.utility.Vector3dVector(baked)
    o3d.io.write_triangle_mesh(args.out, mesh, write_ascii=False, compressed=False,
                               write_vertex_normals=True, write_vertex_colors=True,
                               print_progress=True)
    print(f"[4/4] 已写出 {args.out}（{os.path.getsize(args.out) / 1048576:.1f} MB），"
          f"总耗时 {time.time() - t0:.0f} 秒")


if __name__ == "__main__":
    main()
