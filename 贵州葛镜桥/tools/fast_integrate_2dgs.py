# -*- coding: utf-8 -*-
"""fast_integrate_2dgs.py —— 大网格快速接入（fuse 3100 万面过大的备用快线）

integrate_2dgs_mesh.py 的 simplify_quadric_decimation 对 31.7M 面单线程太慢，
此处改两阶段:
  1) simplify_vertex_clustering(体素聚类, 秒级) 31.7M -> ~4M
  2) simplify_quadric_decimation 精修 -> 3M
其余(GLB 顶点色 + config.js)复用 integrate_2dgs_mesh.py 的函数。
"""
import sys
import time
from pathlib import Path

import numpy as np
import open3d as o3d

sys.path.insert(0, r'E:\葛镜桥高斯\最新模型\web\tools')
from integrate_2dgs_mesh import write_glb_vertex_color, update_config, OUT_GLB

PLY = Path(r'E:\葛镜桥高斯\2DGS重训\输出网格\fuse_unbounded.ply')
TARGET = 3_000_000

t0 = time.time()
print(f'[1/4] 读取 {PLY}', flush=True)
mesh = o3d.io.read_triangle_mesh(str(PLY))
nv, nt = len(mesh.vertices), len(mesh.triangles)
print(f'      顶点 {nv:,}  面 {nt:,}  顶点色: {mesh.has_vertex_colors()}  ({time.time()-t0:.0f}s)', flush=True)
assert nv > 0 and mesh.has_vertex_colors(), '网格为空或无顶点色'

# ---- 阶段1: 体素聚类粗简到 ~4M 面 ----
print('[2/4] 顶点聚类粗简', flush=True)
diag = np.linalg.norm(np.asarray(mesh.get_max_bound()) - np.asarray(mesh.get_min_bound()))
voxel = diag / 1400.0
for _ in range(8):
    m2 = mesh.simplify_vertex_clustering(voxel)
    nt2 = len(m2.triangles)
    print(f'      voxel={voxel:.4f} -> 面 {nt2:,}  ({time.time()-t0:.0f}s)', flush=True)
    if nt2 <= TARGET * 2:
        break
    voxel *= 1.4
mesh = m2
mesh.remove_degenerate_triangles()
mesh.remove_unreferenced_vertices()
print(f'      粗简完成: 顶点 {len(mesh.vertices):,}  面 {len(mesh.triangles):,}', flush=True)

# ---- 阶段2: 二次误差精简到 3M ----
if len(mesh.triangles) > TARGET:
    print(f'[3/4] 精简 {len(mesh.triangles):,} -> {TARGET:,}', flush=True)
    mesh = mesh.simplify_quadric_decimation(TARGET)
    print(f'      精简后: 顶点 {len(mesh.vertices):,}  面 {len(mesh.triangles):,}  ({time.time()-t0:.0f}s)', flush=True)
else:
    print(f'[3/4] 面数 {len(mesh.triangles):,} <= 目标, 跳过精简', flush=True)

# ---- 写 GLB + 更新 config（复用原脚本函数）----
print('[4/4] 写 GLB + 更新 config.js', flush=True)
pos = np.asarray(mesh.vertices)
col = np.asarray(mesh.vertex_colors)
idx = np.asarray(mesh.triangles)
size = write_glb_vertex_color(OUT_GLB, pos, col, idx)
print(f'      {OUT_GLB}  ({size/1e6:.1f} MB)', flush=True)
update_config()
print(f'完成, 总耗时 {time.time()-t0:.0f}s', flush=True)
