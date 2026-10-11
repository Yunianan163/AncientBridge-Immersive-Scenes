# -*- coding: utf-8 -*-
"""final_fix_2dgs_glb.py —— 2DGS 网格最终修正（连通域去浮块 + 坐标置换）

坐标链条（均已实证）:
  2DGS fuse_unbounded.ply 与 model1_undistort/模型1 的 COLMAP 世界系逐位一致
  （points3D 与 345 台相机位姿均 0 偏差），
  scene.ply = 该坐标系经 (x, -z, y) 轴置换（config.js IoU 0.689 验证），
  因此网格 -> 泼溅资产坐标系就是纯置换，无需缩放/旋转/平移。

  另补上 WSL 里 OOM 没跑完的最大连通域后处理：按面数过滤小浮块。

用法: python final_fix_2dgs_glb.py [--min-ratio 0.01] [--dry-run]
"""
import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
import open3d as o3d

WEB = Path(r'E:\葛镜桥高斯\最新模型\web')
GLB = WEB / 'models' / 'scene_mesh_2dgs.glb'

sys.path.insert(0, str(WEB / 'tools'))
from integrate_2dgs_mesh import write_glb_vertex_color


def read_glb(path):
    raw = path.read_bytes()
    jlen = struct.unpack_from('<II', raw, 12)[0]
    g = json.loads(raw[20:20 + jlen])
    prim = g['meshes'][0]['primitives'][0]
    accs = g['accessors']
    def get(acc_id):
        acc = accs[acc_id]
        bv = g['bufferViews'][acc['bufferView']]
        off = 28 + jlen + bv['byteOffset']
        if acc['componentType'] == 5126:
            return np.frombuffer(raw, '<f4', acc['count'] * 3, off).reshape(-1, 3).astype(np.float64)
        assert acc['componentType'] == 5125
        return np.frombuffer(raw, '<u4', acc['count'], off).reshape(-1, 3)
    pos = get(prim['attributes']['POSITION'])
    col = get(prim['attributes']['COLOR_0'])
    idx = get(prim['indices'])
    return pos, col, idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-ratio', type=float, default=0.01,
                    help='保留连通域的最小面数占比(相对最大连通域)')
    ap.add_argument('--max-comp', type=int, default=8, help='最多保留前 N 个连通域')
    ap.add_argument('--margin', type=float, default=0.12,
                    help='裁剪盒相对泼溅包围盒的外扩余量(场景单位)')
    ap.add_argument('--max-tris', type=int, default=3_000_000)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    pos, col, idx = read_glb(GLB)
    print(f'读入: 顶点 {len(pos):,}  面 {len(idx):,}', flush=True)

    # ---- 先置换到泼溅资产坐标系 (x, -z, y) ----
    pos = pos[:, [0, 2, 1]] * np.array([1.0, -1.0, 1.0])

    # ---- 按泼溅包围盒+余量裁剪（去掉 TSDF 远景/竖直幕帘浮块）----
    splat = np.asarray(o3d.io.read_point_cloud(str(WEB / 'models' / 'scene.ply')).points)
    lo = np.percentile(splat, 0.5, axis=0) - args.margin
    hi = np.percentile(splat, 99.5, axis=0) + args.margin
    inside = ((pos >= lo) & (pos <= hi)).all(1)
    keep_face = inside[idx].all(1)
    print(f'裁剪盒 {np.round(lo, 2)} ~ {np.round(hi, 2)}: 保留面 {int(keep_face.sum()):,}/{len(idx):,}', flush=True)
    idx = idx[keep_face]

    # ---- 连通域: 只留最大域(裁剪后可能产生孤立碎块) ----
    mesh = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(pos),
        o3d.utility.Vector3iVector(idx.astype(np.int32)))
    tri_cls, cls_cnt, _ = mesh.cluster_connected_triangles()
    tri_cls = np.asarray(tri_cls)
    cls_cnt = np.asarray(cls_cnt)
    biggest = cls_cnt.max()
    keep_cls = np.where(cls_cnt >= biggest * args.min_ratio)[0]
    keep_mask = np.isin(tri_cls, keep_cls)
    print(f'连通域 {len(cls_cnt)} 个, 最大 {biggest:,} 面; 保留 {len(keep_cls)} 个域 '
          f'{int(keep_mask.sum()):,} 面 ({keep_mask.sum() / len(idx) * 100:.1f}%)', flush=True)
    idx = idx[keep_mask]

    # ---- 精简到 web 流畅上限 ----
    if len(idx) > args.max_tris:
        mesh = o3d.geometry.TriangleMesh(
            o3d.utility.Vector3dVector(pos),
            o3d.utility.Vector3iVector(idx.astype(np.int32)))
        mesh = mesh.simplify_quadric_decimation(args.max_tris)
        pos = np.asarray(mesh.vertices)
        col = np.asarray(mesh.vertex_colors) if mesh.has_vertex_colors() else col[:len(pos)]
        idx = np.asarray(mesh.triangles)
        print(f'精简后: 顶点 {len(pos):,}  面 {len(idx):,}', flush=True)
    else:
        # 清未引用顶点
        used = np.unique(idx)
        remap = np.full(len(pos), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        pos, col, idx = pos[used], col[used], remap[idx]

    qn = np.percentile(pos, [1, 50, 99], axis=0)
    print('最终网格 p1-p99 跨度', np.round(qn[2] - qn[0], 3), ' 中位', np.round(qn[1], 3))
    print('泼溅       p1-p99 跨度 [2.17  0.387 1.908]  中位 [-0.014 -0.005  0.008]')

    if args.dry_run:
        print('[dry-run] 未写回')
        return

    size = write_glb_vertex_color(GLB, pos, col, idx)
    print(f'[ok] GLB 已重写: {GLB} ({size / 1e6:.1f} MB), 顶点 {len(pos):,}, 面 {len(idx):,}')


if __name__ == '__main__':
    main()
