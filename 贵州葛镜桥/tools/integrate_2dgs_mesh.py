# -*- coding: utf-8 -*-
"""
integrate_2dgs_mesh.py —— 2DGS 重训产物的网页接入管线（训练完成后由 WorkBuddy 运行）

输入:  E:\\葛镜桥高斯\\2DGS重训\\输出网格\\fuse_unbounded_post.ply
       （2DGS render.py --unbounded 产物，COLMAP 世界坐标 + 顶点色）
输出:  web\\models\\scene_mesh_2dgs.glb
       （POSITION + COLOR_0 + KHR_materials_unlit；顶点保持资产坐标，
        查看器 loadMesh 统一 modelOrientation，与泼溅/旧网格同轴）

步骤:
  1) Open3D 读网格，统计面数/顶点数
  2) 面数超过上限时四边形坍缩简化（web 端 3M 面是流畅上限）
  3) [可选 --align scene.ply] 与泼溅点云做中心+尺度粗对齐并报告偏差
     —— 泼溅 scene.ply 与 2DGS 同源 COLMAP，理论上无需对齐；此步仅做体检
  4) 顶点色 float(0-1) → GLB COLOR_0；手写 GLB（复用 bake_texture 的容器逻辑）
  5) [可选 --update-config] 把 config.js 的 mesh.url 切到新 GLB（保留旧值注释）

用法:
  python integrate_2dgs_mesh.py [--ply <fuse_*.ply>] [--max-tris 3000000]
                                [--align scene.ply] [--update-config]
"""
import argparse
import json
import re
import struct
import sys
from pathlib import Path

import numpy as np
import open3d as o3d

WEB = Path(r'E:\葛镜桥高斯\最新模型\web')
DEFAULT_PLY = Path(r'E:\葛镜桥高斯\2DGS重训\输出网格\fuse_unbounded_post.ply')
OUT_GLB = WEB / 'models' / 'scene_mesh_2dgs.glb'
CONFIG_JS = WEB / 'js' / 'config.js'


# ---------------------------------------------------------------- GLB（顶点色版）
def write_glb_vertex_color(path, pos, colors, idx):
    """顶点色 GLB：COLOR_0 让 GLTFLoader 自动开 vertexColors，
    KHR_materials_unlit → MeshBasicMaterial，与泼溅自发光观感一致。"""
    pos = np.ascontiguousarray(pos, np.float32)
    col = np.ascontiguousarray(np.clip(colors, 0, 1), np.float32)
    idx = np.ascontiguousarray(idx, np.uint32).reshape(-1)  # 必须摊平成元素数

    def pad4(b, ch=b'\x00'):
        return b + ch * ((4 - len(b) % 4) % 4)

    blobs, views, accessors = [], [], []

    def add_view(raw, target=0):
        off = sum(len(b) for b in blobs)
        if off % 4:
            blobs.append(b'\x00' * (4 - off % 4))
            off = sum(len(b) for b in blobs)
        blobs.append(raw)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    v_pos = add_view(pos.tobytes(), 34962)
    a_pos = len(accessors)
    accessors.append({'bufferView': v_pos, 'componentType': 5126,
                      'count': len(pos), 'type': 'VEC3',
                      'min': np.round(pos.min(0), 4).tolist(),
                      'max': np.round(pos.max(0), 4).tolist()})

    v_col = add_view(col.tobytes(), 34962)
    a_col = len(accessors)
    accessors.append({'bufferView': v_col, 'componentType': 5126,
                      'count': len(col), 'type': 'VEC3'})

    v_idx = add_view(idx.tobytes(), 34963)
    a_idx = len(accessors)
    accessors.append({'bufferView': v_idx, 'componentType': 5125,
                      'count': len(idx), 'type': 'SCALAR'})

    gltf = {
        'asset': {'version': '2.0', 'generator': 'integrate_2dgs_mesh.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'GeJingQiao_2dgs'}],
        'meshes': [{'name': 'mesh', 'primitives': [{
            'attributes': {'POSITION': a_pos, 'COLOR_0': a_col},
            'indices': a_idx, 'material': 0, 'mode': 4}]}],
        'materials': [{
            'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 1.0},
            'doubleSided': True,
            'extensions': {'KHR_materials_unlit': {}}}],
        'extensionsUsed': ['KHR_materials_unlit'],
        'buffers': [{'byteLength': 0}],
        'bufferViews': views,
        'accessors': accessors,
    }

    bin_data = pad4(b''.join(blobs))
    gltf['buffers'][0]['byteLength'] = len(bin_data)
    jb = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes = jb + b' ' * ((4 - len(jb) % 4) % 4)   # 必须空格补齐

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_data)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack('<II', len(bin_data), 0x004E4942))
        f.write(bin_data)
    return path.stat().st_size


# ---------------------------------------------------------------- 主流程
def check_align(mesh, splat_ply):
    """与泼溅 PLY 做中心/尺度体检（同源 COLMAP 理论上无需变换，只报告偏差）。"""
    print('\n[对齐体检] 泼溅点云 vs 2DGS 网格')
    # 泼溅 PLY 很大(2.8M 高斯)，只抽样读位置
    pcd = o3d.io.read_point_cloud(str(splat_ply))
    pts = np.asarray(pcd.points)
    if len(pts) > 500_000:
        pts = pts[np.random.default_rng(0).choice(len(pts), 500_000, replace=False)]
    c_s, ext_s = pts.mean(0), pts.max(0) - pts.min(0)
    v = np.asarray(mesh.vertices)
    c_m, ext_m = v.mean(0), v.max(0) - v.min(0)
    print(f'  泼溅中心 {np.round(c_s, 2)}  尺寸 {np.round(ext_s, 2)}')
    print(f'  网格中心 {np.round(c_m, 2)}  尺寸 {np.round(ext_m, 2)}')
    off = np.linalg.norm(c_s - c_m) / np.linalg.norm(ext_s)
    scale = np.linalg.norm(ext_m) / np.linalg.norm(ext_s)
    print(f'  中心偏移 {off * 100:.2f}%（场景尺度）  尺寸比 {scale:.3f}')
    ok = off < 0.05 and 0.7 < scale < 1.4
    print(f'  {"[ok] 坐标系一致，直接可用" if ok else "[!!] 偏差偏大——训练后回报此数值，WorkBuddy 再定对齐策略"}')
    return ok


def update_config():
    """把 config.js 的 mesh.url 切到 2DGS GLB，旧值保留为注释。

    注意: 只匹配 mesh: 小节内的 url —— config.js 里 model(泼溅) 小节也有 url，
    早期版本用全局第一个匹配曾把泼溅的 scene.ply 误改成 GLB。"""
    src = CONFIG_JS.read_text(encoding='utf-8')
    new_url = './models/scene_mesh_2dgs.glb'
    if new_url in src:
        print('[skip] config.js 已指向 2DGS 网格')
        return
    # 定位 mesh: { ... } 小节，只在其内部找第一个 url
    sec = re.search(r'mesh:\s*\{', src)
    if not sec:
        sys.exit('config.js 里没找到 mesh 小节')
    m = re.search(r"url:\s*'(\.\/models\/[^']+)'", src[sec.end():])
    if not m:
        sys.exit('config.js 的 mesh 小节里没找到 url')
    old = m.group(1)
    start = sec.end() + m.start()
    end = sec.end() + m.end()
    marker = f"// 2DGS 重训版(原: {old})\n        "
    src = src[:start] + f"url: '{new_url}'" + src[end:]
    src = src[:start] + marker + src[start:]
    CONFIG_JS.write_text(src, encoding='utf-8')
    print(f'[ok] config.js mesh.url: {old} → {new_url}（旧值已留注释）')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ply', default=str(DEFAULT_PLY))
    ap.add_argument('--max-tris', type=int, default=3_000_000)
    ap.add_argument('--align', default=None, help='泼溅 scene.ply 路径，做坐标体检')
    ap.add_argument('--update-config', action='store_true')
    ap.add_argument('--test', action='store_true', help='合成测试网格自测管线')
    args = ap.parse_args()

    if args.test:
        m = o3d.geometry.TriangleMesh.create_sphere(radius=1.0, resolution=40)
        m.paint_uniform_color([0.3, 0.7, 0.5])
        m.compute_vertex_normals()
        tmp = Path(r'E:\葛镜桥高斯\2DGS重训\_test_mesh.ply')
        o3d.io.write_triangle_mesh(str(tmp), m)
        args.ply = str(tmp)

    print(f'[1/4] 读取 {args.ply}')
    mesh = o3d.io.read_triangle_mesh(args.ply)
    nv, nt = len(mesh.vertices), len(mesh.triangles)
    if nv == 0:
        sys.exit('网格为空——确认用的是 fuse_unbounded_post.ply 且训练已完成')
    has_col = mesh.has_vertex_colors()
    print(f'      顶点 {nv:,}  面 {nt:,}  顶点色: {has_col}')
    if not has_col:
        print('[!!] 无顶点色！fuse_unbounded.ply 才带色，post 版应保留。仍继续（会显示灰白）')

    if nt > args.max_tris:
        print(f'[2/4] 简化 {nt:,} → {args.max_tris:,} 面（quadric 坍缩）')
        mesh = mesh.simplify_quadric_decimation(args.max_tris)
        print(f'      简化后: 顶点 {len(mesh.vertices):,}  面 {len(mesh.triangles):,}')
    else:
        print(f'[2/4] 面数 {nt:,} ≤ 上限，不简化')

    if args.align:
        check_align(mesh, Path(args.align))

    print('[3/4] 写 GLB（顶点色 + KHR_unlit）')
    pos = np.asarray(mesh.vertices)
    col = np.asarray(mesh.vertex_colors) if mesh.has_vertex_colors() else np.full((len(pos), 3), 0.8)
    idx = np.asarray(mesh.triangles)
    size = write_glb_vertex_color(OUT_GLB, pos, col, idx)
    print(f'      {OUT_GLB}  ({size / 1e6:.1f} MB)')

    if args.test:
        # 结构自检：解析自己写的 GLB，核对 accessor 计数
        raw = OUT_GLB.read_bytes()
        magic, ver, total = struct.unpack_from('<III', raw, 0)
        jlen, jtype = struct.unpack_from('<II', raw, 12)
        gltf = json.loads(raw[20:20 + jlen])
        prims = gltf['meshes'][0]['primitives'][0]
        acc = gltf['accessors']
        n_idx = acc[prims['indices']]['count']
        n_pos = acc[prims['attributes']['POSITION']]['count']
        assert magic == 0x46546C67 and jtype == 0x4E4F534A
        assert n_idx == nt * 3, f'索引数 {n_idx} != 面数x3 {nt * 3}'
        assert 'COLOR_0' in prims['attributes']
        print(f'[自检] GLB 结构通过: 索引 {n_idx:,} = 面x3, COLOR_0 存在, '
              f'total={total} = 12+8+{jlen}+8+{len(raw) - 28 - jlen}')

    if args.update_config:
        print('[4/4] 更新 config.js')
        update_config()
    else:
        print('[4/4] 跳过 config（加 --update-config 启用）')

    if args.test:
        OUT_GLB.unlink()          # 测试产物不留
        Path(args.ply).unlink()
        print('[cleanup] 测试文件已清理')

    print('\n完成。刷新网页按 M 即可看到 2DGS 重训网格。')


if __name__ == '__main__':
    main()
