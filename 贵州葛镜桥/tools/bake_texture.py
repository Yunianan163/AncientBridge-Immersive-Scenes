# -*- coding: utf-8 -*-
"""
bake_texture.py —— 纹理级烘焙：把泼溅渲染效果烙成 GLB 网格的真贴图

与 bake_vertex_colors.py（顶点色）的区别：
  顶点色只有 ~150 万个采样点（顶点数限制），近景细节被顶点密度卡死；
  纹理烘焙把颜色写到独立的 2D 纹理上，分辨率由纹素数决定，与网格密度解耦。

管线：
  1) 盒式六面展开（box unwrap）：纹理图集分 6 条带（3 轴 × 正负两侧）。
     每个纹素发一条沿 -轴 的射线，与网格求交取首个命中点 —— 即该纹素
     对应的表面采样点（天然自带遮挡剔除：被挡住的表面由对侧条带负责）。
  2) 对每个表面采样点，从全部机位（远景16 + 近景16）的泼溅渲染图采样颜色：
     视口内 + 朝向相机 + 射线无遮挡 → 双线性采样，按 (法向·视线)^1.5 加权。
  3) 未被任何机位覆盖的采样点，回退到已烘焙顶点色（barycentric 插值）。
  4) 顶点 UV 按法向主轴选条带（与烘焙射线的可见性一致），位置定 u,v。
  5) 手写 GLB 容器（KHR_materials_unlit + 内嵌 PNG 纹理），无额外依赖。

坐标系约定（与 bake_vertex_colors.py 一致）：
  网格 PLY 存的是「资产坐标」；查看器 world = Euler(180°,0,0) · 资产坐标，
  等价于 diag(1,-1,-1) 翻转。相机矩阵都在 world 系，故投影前先翻到 world。
导出的 GLB 顶点保持资产坐标（查看器 loadMesh 统一加 rotation）。

用法（在 tools/ 下）:
  python bake_texture.py                    # 默认参数，读 bake_views + bake_views_near
  python bake_texture.py --texels 8000000   # 提高纹理采样密度
"""
import argparse
import json
import struct
import time
from pathlib import Path

import numpy as np
import open3d as o3d
from PIL import Image

FLIP = np.diag([1.0, -1.0, -1.0])          # 资产 → world


def read_mesh(ply):
    m = o3d.io.read_triangle_mesh(str(ply))
    V = np.asarray(m.vertices).astype(np.float32)
    T = np.asarray(m.triangles).astype(np.uint32)
    N = np.asarray(m.vertex_normals).astype(np.float32)
    C = np.asarray(m.vertex_colors).astype(np.float32)
    if len(N) == 0:
        m.compute_vertex_normals()
        N = np.asarray(m.vertex_normals).astype(np.float32)
    return V, T, N, C


def erode_mask(m, r):
    """二值腐蚀 r 像素：泼溅渲染的前景剪影有暗色光晕，边缘像素不可采样"""
    out = m.copy()
    for _ in range(r):
        out = (out & np.roll(out, 1, 0) & np.roll(out, -1, 0)
               & np.roll(out, 1, 1) & np.roll(out, -1, 1))
    return out


def load_views(dirs):
    """读入所有机位：截图、相机矩阵、模型像素掩码"""
    views = []
    for d in dirs:
        vj = Path(d) / 'views.json'
        if not vj.exists():
            print(f"  [跳过] {d} 无 views.json")
            continue
        for v in json.loads(vj.read_text(encoding='utf-8')):
            img = np.asarray(Image.open(v['image']).convert('RGB'))
            views.append({'dir': d, 'img': img,
                         'W': v['cam']['width'], 'H': v['cam']['height'],
                         'M': np.array(v['cam']['viewMatrix'], np.float32).reshape(4, 4).T,
                         'P': np.array(v['cam']['projMatrix'], np.float32).reshape(4, 4).T,
                         'pos': np.array(v['cam']['pos'], np.float32)})
    for v in views:
        bg = np.array([10, 13, 19], np.int32)
        v['mask'] = erode_mask(np.abs(v['img'].astype(np.int32) - bg).sum(-1) > 45, 3)
    return views


def bilinear(img, px, py):
    """img HxWx3；px,py float 像素坐标 → 颜色 float。越界由调用方保证。"""
    H, W = img.shape[:2]
    x0 = np.floor(px).astype(np.int32)
    y0 = np.floor(py).astype(np.int32)
    x1 = np.minimum(x0 + 1, W - 1)
    y1 = np.minimum(y0 + 1, H - 1)
    fx = (px - x0)[:, None]
    fy = (py - y0)[:, None]
    im = img.astype(np.float32)
    return (im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x1] * fx * (1 - fy)
            + im[y1, x0] * (1 - fx) * fy + im[y1, x1] * fx * fy)


# ---------------------------------------------------------------- GLB 导出
def write_glb(path, pos, uv, idx, png_bytes):
    """手写 glTF 2.0 GLB：KHR_materials_unlit 保证无光照顶点色直出观感。"""
    pos = np.ascontiguousarray(pos, np.float32)
    uv = np.ascontiguousarray(uv, np.float32)
    idx = np.ascontiguousarray(idx, np.uint32).reshape(-1)   # 关键：摊平，
    # len(二维数组) 是行数（面数）不是元素数——索引 accessor 会少 2/3，只画 1/3 的面

    def pad4(b):
        return b + b'\x00' * ((4 - len(b) % 4) % 4)

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
                      'min': np.round(pos.min(0), 6).tolist(),
                      'max': np.round(pos.max(0), 6).tolist()})
    v_uv = add_view(uv.tobytes(), 34962)
    a_uv = len(accessors)
    accessors.append({'bufferView': v_uv, 'componentType': 5126,
                      'count': len(uv), 'type': 'VEC2'})
    v_idx = add_view(idx.tobytes(), 34963)
    a_idx = len(accessors)
    accessors.append({'bufferView': v_idx, 'componentType': 5125,
                      'count': len(idx), 'type': 'SCALAR'})
    v_png = add_view(png_bytes)

    gltf = {
        'asset': {'version': '2.0', 'generator': 'bake_texture.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'GeJingQiao_tex'}],
        'meshes': [{'name': 'mesh', 'primitives': [{
            'attributes': {'POSITION': a_pos, 'TEXCOORD_0': a_uv},
            'indices': a_idx, 'material': 0, 'mode': 4}]}],
        'materials': [{
            'pbrMetallicRoughness': {
                'baseColorTexture': {'index': 0},
                'metallicFactor': 0.0, 'roughnessFactor': 1.0},
            'doubleSided': True,
            'extensions': {'KHR_materials_unlit': {}}}],
        'extensionsUsed': ['KHR_materials_unlit'],
        'textures': [{'sampler': 0, 'source': 0}],
        'images': [{'bufferView': v_png, 'mimeType': 'image/png'}],
        'samplers': [{'magFilter': 9409, 'minFilter': 9987,
                      'wrapS': 33071, 'wrapT': 33071}],   # CLAMP：防条带渗色
        'buffers': [{'byteLength': 0}],
        'bufferViews': views,
        'accessors': accessors,
    }

    bin_data = pad4(b''.join(blobs))
    gltf['buffers'][0]['byteLength'] = len(bin_data)
    # 注意：JSON 块按规范必须用「空格」补齐 4 字节对齐（\x00 会让 JSON.parse 报错）
    jb = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes = jb + b' ' * ((4 - len(jb) % 4) % 4)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_data)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(json_bytes), 0x4E4F534A))  # 'JSON'
        f.write(json_bytes)
        f.write(struct.pack('<II', len(bin_data), 0x004E4942))    # 'BIN\0'
        f.write(bin_data)


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mesh', default='../models/scene_mesh_hd.ply')
    ap.add_argument('--fallback', default='../models/scene_mesh_hd_baked.ply',
                    help='回退顶点色来源（与 --mesh 同拓扑）')
    ap.add_argument('--out', default='../models/scene_mesh_tex.glb')
    ap.add_argument('--tex', default='../models/scene_mesh_tex.png')
    ap.add_argument('--views', nargs='+', default=['bake_views', 'bake_views_near'])
    ap.add_argument('--texels', type=int, default=6_000_000,
                    help='目标纹素总数（自动换算成各条带尺寸）')
    args = ap.parse_args()

    t0 = time.time()
    print("[1/6] 读网格 …", flush=True)
    V, T, N, _ = read_mesh(args.mesh)                     # 资产坐标
    Vw = (FLIP @ V.T).T.astype(np.float32)                # world 坐标
    _, _, _, Cb = read_mesh(args.fallback)                # 回退色（顶点级烘焙结果）
    print(f"      {len(V):,} 顶点 / {len(T):,} 面")

    print("[2/6] 读机位 …", flush=True)
    views = load_views(args.views)
    print(f"      {len(views)} 机位")

    # ---- 盒式六面展开布局
    c = (Vw.max(0) + Vw.min(0)) / 2.0
    h = (Vw.max(0) - Vw.min(0)) / 2.0
    pad = 1.03
    areas = [h[(a + 1) % 3] * h[(a + 2) % 3] for a in range(3)]
    texel = float(np.sqrt(2.0 * sum(areas) / args.texels))
    bands = []          # (axis, side, Wb, Hb, y_off)
    y_off = 0
    for a in range(3):
        for side in (1, -1):
            a1, a2 = (a + 1) % 3, (a + 2) % 3
            Wb = max(8, int(round(2 * h[a1] / texel)))
            Hb = max(8, int(round(2 * h[a2] / texel)))
            bands.append((a, side, Wb, Hb, y_off))
            y_off += Hb
    AW = max(b[2] for b in bands)
    AH = y_off
    n_texel = sum(b[2] * b[3] for b in bands)
    print(f"      图集 {AW}x{AH}（{n_texel:,} 纹素，texel≈{texel:.5f} 单位）")

    # ---- 每纹素一条射线，求首个命中（分块防内存爆）
    print("[3/6] 逐纹素射线求交 …", flush=True)
    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.core.Tensor(Vw.astype(np.float32)),
                        o3d.core.Tensor(T.astype(np.uint32)))
    tri_v = Vw[T]                                        # (Nt,3,3)
    fn = np.cross(tri_v[:, 1] - tri_v[:, 0], tri_v[:, 2] - tri_v[:, 0])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)

    tex_pos = np.zeros((n_texel, 3), np.float32)         # 命中点 world
    tex_prim = np.full(n_texel, -1, np.int64)
    tex_bc = np.zeros((n_texel, 2), np.float32)          # barycentric (u,v)
    tex_live = np.zeros(n_texel, bool)

    CH = 1 << 20                                          # 1M 射线/块
    base = 0
    for (a, side, Wb, Hb, yo) in bands:
        u = (np.arange(Wb) + 0.5) / Wb
        v = (np.arange(Hb) + 0.5) / Hb
        # 图像第 0 行 ↔ a2 = max（自然「上=北」取向）
        a1, a2 = (a + 1) % 3, (a + 2) % 3
        a1v = (c[a1] - h[a1] * pad) + u * (2 * h[a1] * pad)
        a2v = (c[a2] + h[a2] * pad) - v * (2 * h[a2] * pad)
        gx, gy = np.meshgrid(a1v, a2v)
        flat_x, flat_y = gx.ravel(), gy.ravel()
        n_b = Wb * Hb
        n_hit_b = 0
        for s in range(0, n_b, CH):
            e = min(s + CH, n_b)
            orig = np.zeros((e - s, 3), np.float32)
            orig[:, a1] = flat_x[s:e]
            orig[:, a2] = flat_y[s:e]
            orig[:, a] = c[a] + side * h[a] * pad
            d = np.zeros((e - s, 3), np.float32)
            d[:, a] = -side
            rays = np.ascontiguousarray(np.hstack([orig, d]))
            r = scene.cast_rays(o3d.core.Tensor(rays))
            th = r['t_hit'].numpy()
            ok = np.isfinite(th)
            sl = slice(base + s, base + e)
            tex_pos[sl][ok] = (orig + d * th[:, None])[ok]
            pids = r['primitive_ids'].numpy().astype(np.int64)
            tex_prim[sl][ok] = pids[ok]
            if 'primitive_uvs' in r:
                tex_bc[sl][ok] = r['primitive_uvs'].numpy()[ok]
            else:
                # 手动重心坐标：由命中点反解 (u,v)
                hp = tex_pos[sl][ok]
                tr = tri_v[pids[ok]]
                e1, e2 = tr[:, 1] - tr[:, 0], tr[:, 2] - tr[:, 0]
                vp = hp - tr[:, 0]
                d11 = np.einsum('ij,ij->i', e1, e1)
                d12 = np.einsum('ij,ij->i', e1, e2)
                d22 = np.einsum('ij,ij->i', e2, e2)
                dp1 = np.einsum('ij,ij->i', vp, e1)
                dp2 = np.einsum('ij,ij->i', vp, e2)
                den = d11 * d22 - d12 * d12
                uu = (dp1 * d22 - dp2 * d12) / np.maximum(den, 1e-12)
                vv = (dp2 * d11 - dp1 * d12) / np.maximum(den, 1e-12)
                tex_bc[sl][ok] = np.stack([uu, vv], 1)
            tex_live[sl] = ok
            n_hit_b += int(ok.sum())
        print(f"      轴{'XYZ'[a]}{'+' if side > 0 else '-'}: {Wb}x{Hb} "
              f"命中 {n_hit_b:,}", flush=True)
        base += n_b
    live = np.where(tex_live)[0]
    prim = tex_prim[live]
    print(f"      表面采样点合计 {len(live):,}（{100 * len(live) / n_texel:.1f}%）")

    # ---- 回退色：顶点级烘焙色 barycentric 插值
    print("[4/6] 回退色（顶点烘焙色插值）…", flush=True)
    u_, v_ = tex_bc[live][:, 0], tex_bc[live][:, 1]
    w0 = np.clip(1.0 - u_ - v_, 0, 1)[:, None]
    fb = (Cb[T[prim, 0]] * w0 + Cb[T[prim, 1]] * u_[:, None]
          + Cb[T[prim, 2]] * v_[:, None])
    nrm = fn[prim]                                       # 面法向（world）

    # ---- 机位采样（两遍：第一遍求均值，第二遍剔除离群样本）
    print("[5/6] 机位颜色采样 …", flush=True)
    P = tex_pos[live]                                    # (M,3)
    M_ = len(P)
    EPS = 1e-3                                           # 自遮挡 ε（≈11 cm）
    hh = np.hstack([P, np.ones((M_, 1))]).astype(np.float32)

    def view_samples(vw):
        """单机位采样：返回 (可见点全局索引, 颜色0-255, 权重)"""
        cam = vw['pos']
        clip = (hh @ vw['M'].T) @ vw['P'].T
        w_ = clip[:, 3]
        okw = w_ > 1e-6
        w_safe = np.where(okw, w_, 1.0)
        ndc = clip[:, :3] / w_safe[:, None]              # 非法处于 !okw 会被过滤
        W, H = vw['W'], vw['H']
        px = (ndc[:, 0] * 0.5 + 0.5) * (W - 1)
        py = (1 - (ndc[:, 1] * 0.5 + 0.5)) * (H - 1)
        inb = (okw & (px >= 0) & (px < W - 1) & (py >= 0) & (py < H - 1)
               & (ndc[:, 2] > -1) & (ndc[:, 2] < 1))
        idxs = np.where(inb)[0]
        if not len(idxs):
            return idxs, np.zeros((0, 3), np.float32), np.zeros(0)
        # 朝向 + 落在模型像素上（掩码已腐蚀 3px，避开剪影光晕）
        to_cam = cam[None, :] - P[idxs]
        dist = np.linalg.norm(to_cam, axis=1)
        to_cam /= dist[:, None]
        cosv = np.einsum('ij,ij->i', nrm[idxs], to_cam)
        pyi = np.round(py[idxs]).astype(np.int64)
        pxi = np.round(px[idxs]).astype(np.int64)
        msk = vw['mask'][pyi, pxi]
        cand = idxs[(cosv > 0.03) & msk]
        if not len(cand):
            return cand, np.zeros((0, 3), np.float32), np.zeros(0)
        # 遮挡检测：从表面点向相机发线，若提前命中网格则被挡
        tc = cam[None, :] - P[cand]
        d_ = np.linalg.norm(tc, axis=1)
        tc /= d_[:, None]
        occ = np.ones(len(cand), bool)
        for s in range(0, len(cand), CH):
            e = min(s + CH, len(cand))
            rays = np.ascontiguousarray(
                np.hstack([P[cand[s:e]] + tc[s:e] * EPS, tc[s:e]]))
            rr = scene.cast_rays(o3d.core.Tensor(rays))
            th = rr['t_hit'].numpy()
            occ[s:e] = ~np.isfinite(th) | (th >= d_[s:e] - 2 * EPS)
        vis = cand[occ]
        if not len(vis):
            return vis, np.zeros((0, 3), np.float32), np.zeros(0)
        col = bilinear(vw['img'], px[vis], py[vis])
        tcv = cam[None, :] - P[vis]
        tcv /= np.linalg.norm(tcv, axis=1)[:, None]
        wv = np.clip(np.einsum('ij,ij->i', nrm[vis], tcv), 0, 1) ** 1.5
        return vis, col, wv

    col_sum = np.zeros((M_, 3), np.float64)
    wgt_sum = np.zeros(M_, np.float64)
    for vi, vw in enumerate(views):
        vis, col, wv = view_samples(vw)
        np.add.at(col_sum, vis, col * wv[:, None])
        np.add.at(wgt_sum, vis, wv)
    cov = wgt_sum > 1e-4
    mean = np.where(cov[:, None], col_sum / np.maximum(wgt_sum, 1e-9)[:, None], 0) / 255.0
    print(f"      第一遍覆盖率 {100 * cov.mean():.1f}%，开始离群剔除 …")

    # 第二遍：泼溅前景树叶会把别处表面「盖」成叶色/光晕色，与均值偏差大的样本剔除
    col_sum2 = np.zeros((M_, 3), np.float64)
    wgt_sum2 = np.zeros(M_, np.float64)
    for vi, vw in enumerate(views):
        vis, col, wv = view_samples(vw)
        if not len(vis):
            continue
        dev = np.abs(col / 255.0 - mean[vis]).max(axis=1)
        keep = (dev < 0.22) | (~cov[vis])          # 未覆盖纹素不设阈值，尽量采
        vv = vis[keep]
        np.add.at(col_sum2, vv, col[keep] * wv[keep][:, None])
        np.add.at(wgt_sum2, vv, wv[keep])
    cov2 = wgt_sum2 > 1e-4
    print(f"      第二遍覆盖率 {100 * cov2.mean():.1f}%"
          f"（离群剔除率 {100 * (1 - wgt_sum2[cov2].sum() / max(wgt_sum[cov].sum(), 1e-9)):.1f}%）")

    # ---- 写纹理
    print("[6/6] 写纹理 + GLB …", flush=True)
    rgb = np.zeros((M_, 3), np.uint8)
    rgb[cov2] = np.clip(col_sum2[cov2] / wgt_sum2[cov2, None], 0, 255).astype(np.uint8)
    # 第二遍把样本剔光的纹素回退到第一遍均值（mean 是 0-1 域），再不行用顶点烘焙色
    only1 = cov & ~cov2
    rgb[only1] = np.clip(mean[only1] * 255, 0, 255).astype(np.uint8)
    rgb[~cov] = np.clip(fb[~cov] * 255, 0, 255).astype(np.uint8)

    tex_rgb = np.zeros((n_texel, 3), np.uint8)
    tex_rgb[live] = rgb
    atlas = np.zeros((AH, AW, 3), np.uint8)
    atlas_live = np.zeros((AH, AW), bool)
    base = 0
    band_rows = []
    for (a, side, Wb, Hb, yo) in bands:
        blk = tex_rgb[base:base + Wb * Hb].reshape(Hb, Wb, 3)
        atlas[yo:yo + Hb, :Wb] = blk
        atlas_live[yo:yo + Hb, :Wb] = tex_live[base:base + Wb * Hb].reshape(Hb, Wb)
        if Wb < AW:
            # 条带右侧空区用最后一列延拓：纯黑空区会在 mipmap 缩小时污染邻域
            ext = blk[:, -1:, :]
            atlas[yo:yo + Hb, Wb:] = ext
            atlas_live[yo:yo + Hb, Wb:] = True
        band_rows.append((yo, yo + Hb))
        base += Wb * Hb

    # ---- 黑洞填补：树叶间隙导致 ~30% 纹素未命中（纯黑），顶点 UV 会采到
    # 这些黑洞形成黑色等高线状伪影。迭代膨胀填色 + 条带均色兜底。
    print("      黑洞填补（迭代膨胀）…", flush=True)
    for it in range(32):
        black = ~atlas_live
        if not black.any():
            break
        csum = np.zeros(atlas.shape, np.uint16)
        cnt = np.zeros(atlas.shape[:2], np.uint8)
        for sh, ax in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
            src_l = np.roll(atlas_live, sh, ax)
            src_c = np.roll(atlas, sh, ax)
            take = src_l & black
            csum[take] += src_c[take]
            cnt[take] += 1
        fill = black & (cnt > 0)
        if not fill.any():
            break
        atlas[fill] = (csum[fill] // cnt[fill][:, None]).astype(np.uint8)
        atlas_live = atlas_live | fill
    # 仍为黑的（大块无表面区域）→ 所在条带的已覆盖均色
    for (y0, y1) in band_rows:
        rows = slice(y0, y1)
        dead = ~atlas_live[rows]
        if dead.any():
            live_rows = atlas_live[rows]
            if live_rows.any():
                atlas[rows][dead] = atlas[rows][live_rows].mean(0).astype(np.uint8)
            atlas_live[rows] = True
    Image.fromarray(atlas).save(args.tex)

    # ---- 顶点 UV（法向主轴选条带，位置定 u,v；world 系计算）
    Nw = (FLIP @ N.T).T
    dom = np.argmax(np.abs(Nw), axis=1)
    uv = np.zeros((len(V), 2), np.float32)
    for (a, side, Wb, Hb, yo) in bands:
        a1, a2 = (a + 1) % 3, (a + 2) % 3
        m = (dom == a) & ((Nw[:, a] * side) > 0)
        if not m.any():
            continue
        q = Vw[m]
        uu = (q[:, a1] - (c[a1] - h[a1] * pad)) / (2 * h[a1] * pad)
        vv_ = (q[:, a2] - (c[a2] - h[a2] * pad)) / (2 * h[a2] * pad)
        uv[m, 0] = (np.clip(uu, 0, 1) * (Wb - 1)) / AW
        uv[m, 1] = (yo + np.clip(1.0 - vv_, 0, 1) * (Hb - 1)) / AH

    write_glb(args.out, V, uv, T, Path(args.tex).read_bytes())
    print(f"完成：{args.out}（{Path(args.out).stat().st_size / 1e6:.1f} MB，"
          f"纹理 {AW}x{AH}）耗时 {time.time() - t0:.0f}s", flush=True)


if __name__ == '__main__':
    main()
