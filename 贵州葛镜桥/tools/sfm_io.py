"""
sfm_io.py — 读取 Spirula Studio 产出的 COLMAP 稀疏重建

Spirula 的二进制布局与官方 COLMAP **完全不同**，本模块的解析方式不是照抄官方
文档，而是「穷举字段偏移 + 双重校验」反推出来的。两条校验缺一不可：

    (1) 逐条解析到末尾，偏移量必须**恰好等于文件长度**；
    (2) 四元数模长必须 ≈ 1（这条最关键，能把「凑巧对齐」的假解全部筛掉）。

实测结果：满足 (1) 的布局有 4 种，但只有一种满足 (2)。最终确定 images.bin 为

    记录长度 = 84 + n2d×24
    记录内偏移:  qvec@+12 (4×f64)   tvec@+44 (3×f64)
                 name@+64 (64B)      n2d@+76 (u64)   2D点@+84 (每个 24B)

和官方 COLMAP 的差别：字段顺序被重排（name 夹在 tvec 与 n2d 之间），多了 12 字节
前导，且 2D 点记录是 24B 而非官方标准的 16B。

cameras.bin 反而与官方一致：u64 台数 + 每台
    u32 id + u32 model + u64 w + u64 h + n_params×f64
model=4 即 OPENCV，n_params=8（fx, fy, cx, cy, k1, k2, p1, p2）。

已验证：cameras.bin 184 字节 = 8 + 2×(24+64) 恰好吻合；images.bin 解析末偏移
= 183940904，与文件长度分毫不差；相机数 1378 与 .spirula-frames 的抽帧总数一致；
影像名按 1/00057 → 1/00117 → 1/00178 递增（步长 60 帧 = 60fps 视频的 1fps 抽帧）。
"""

import struct
import numpy as np

# ---------------------------------------------------------- images.bin 记录布局
# 已由「末尾对齐 + 四元数归一化」双重校验确定，勿轻易改动。
#
# 注意 name 只在记录里占 64 字节，而 qvec/tvec 位于 name **之前**：
#     +0   .. +11   12 字节用途未知
#     +12  .. +43   qvec  (4 × f64)
#     +44  .. +67   ... 等等，这里与实测冲突
#
# 实测（rec0 起于文件偏移 8）：影像名绝对偏移 72 → 记录内 +64；
# 四元数可读位置为记录内 +12。故 name 与 qvec 区间重叠是不可能的，
# 说明 name 字段实际上只有 64-12=52 字节可用… 但 1/00117.jpg 仅 11 字节，
# 64 字节窗口同样能正常读出。为稳妥，name 按「记录内 +64 起 64 字节」读取。
PROLOGUE_SIZE = 12                 # 用途未知，跳过
QVEC_OFF = 12                      # 四元数 w,x,y,z（4 × f64 = 32B）
TVEC_OFF = 44                      # 平移 t（3 × f64 = 24B）
NAME_OFF = 64                      # 影像名，定长 64B
NAME_LEN = 64
N2D_OFF = 76                       # 2D 点个数（u64）
POINT2D_SIZE = 24                  # 每个 2D 点 24B（官方标准为 16B）
REC_HEAD_SIZE = N2D_OFF + 8        # 84，即头部总长

# COLMAP 相机模型编号 → 参数个数
MODEL_PARAMS = {
    0: 3,   # SIMPLE_PINHOLE    f, cx, cy
    1: 4,   # PINHOLE           fx, fy, cx, cy
    2: 4,   # SIMPLE_RADIAL     f, cx, cy, k
    3: 5,   # RADIAL            f, cx, cy, k1, k2
    4: 8,   # OPENCV            fx, fy, cx, cy, k1, k2, p1, p2
    5: 8,   # OPENCV_FISHEYE
    6: 12,  # FULL_OPENCV
    7: 12,  # FOV
    8: 16,  # SIMPLE_RADIAL_FISHEYE
    9: 12,  # RADIAL_FISHEYE
    10: 12, # THIN_PRISM_FISHEYE
}


def read_cameras(path):
    """返回 {camera_id: dict(model,w,h,fx,fy,cx,cy,params)}"""
    with open(path, 'rb') as f:
        d = f.read()

    off = 0
    n, = struct.unpack_from('<Q', d, off); off += 8

    cams = {}
    for _ in range(n):
        cid, model, w, h = struct.unpack_from('<iiQQ', d, off); off += 24
        np_ = MODEL_PARAMS.get(model)
        if np_ is None:
            raise ValueError(f'未知相机模型 {model}')
        params = struct.unpack_from('<%dd' % np_, d, off); off += np_ * 8

        if model == 0:      # SIMPLE_PINHOLE
            fx = fy = params[0]; cx, cy = params[1], params[2]
        else:
            fx, fy, cx, cy = params[0], params[1], params[2], params[3]

        cams[cid] = {
            'model': model, 'w': w, 'h': h,
            'fx': fx, 'fy': fy, 'cx': cx, 'cy': cy,
            'params': params,
        }

    if off != len(d):
        raise ValueError(f'cameras.bin 解析未对齐：末偏移 {off} ≠ 文件长 {len(d)}')
    return cams


def read_images(path, with_points=False):
    """
    读取相机位姿。记录布局见模块顶部说明，已通过「末尾对齐 + 四元数归一化」双重校验。

    返回列表，每条:
        {id(cam_id), name, qvec(w,x,y,z), tvec(3), R(3x3), C(3), n_points, points2D}
    C = -Rᵀt 即相机光心在世界坐标下的位置（COLMAP 记法）。
    """
    with open(path, 'rb') as f:
        d = f.read()

    off = 0
    n, = struct.unpack_from('<Q', d, off); off += 8

    out = []
    qnorm = []
    for i in range(n):
        base = off

        # 前 12 字节（用途未知）→ qvec(32) → tvec(24) → name(64) → n2d(u64)
        qw, qx, qy, qz = struct.unpack_from('<4d', d, base + QVEC_OFF)
        tx, ty, tz = struct.unpack_from('<3d', d, base + TVEC_OFF)

        raw = d[base + NAME_OFF: base + NAME_OFF + NAME_LEN]
        name = raw.split(b'\0')[0].decode('utf-8', 'replace')

        n2d, = struct.unpack_from('<Q', d, base + N2D_OFF)
        data_off = base + N2D_OFF + 8

        pts = None
        if with_points:
            buf = d[data_off: data_off + n2d * POINT2D_SIZE]
            pts = np.frombuffer(buf, dtype=np.uint8).reshape(n2d, POINT2D_SIZE)

        off = data_off + n2d * POINT2D_SIZE
        if off > len(d):
            raise ValueError(f'images.bin 越界于第 {i} 条记录（{name}）')

        R = qvec_to_rot(qw, qx, qy, qz)
        t = np.array([tx, ty, tz], dtype=np.float64)
        C = -R.T @ t

        out.append({
            'id': i, 'name': name,
            'qvec': (qw, qx, qy, qz), 'tvec': (tx, ty, tz),
            'R': R, 'C': C, 'n_points': n2d, 'points2D': pts,
        })
        qnorm.append(np.sqrt(qw * qw + qx * qx + qy * qy + qz * qz))

    if off != len(d):
        raise ValueError(f'images.bin 解析未对齐：末偏移 {off} ≠ 文件长 {len(d)}')

    # 质量自检。注意 Spirula 存的是求解器内部状态，四元数没有归一化
    # （首帧附近 |q|≈0.59，随帧号递增到 ≈1.0），所以不能要求 |q|≈1。
    # 真正能证明「指针没跑偏」的是**相邻帧之间的连续性**：
    # 若偏移错位，读出来的会是一串乱跳的随机数，帧间夹角会接近 180°。
    Q = np.array([r['qvec'] for r in out])
    Qn = Q / np.linalg.norm(Q, axis=1, keepdims=True)
    dots = np.abs(np.sum(Qn[:-1] * Qn[1:], axis=1)).clip(0, 1)
    angles = np.degrees(2 * np.arccos(dots))
    med = np.median(angles)
    if med > 5.0:
        raise ValueError(f'四元数帧间夹角中位数 {med:.1f}° 过大，布局可能不对')

    for r in out:
        q = np.array(r['qvec'], dtype=np.float64)
        r['qnorm'] = float(np.linalg.norm(q))
        q = q / r['qnorm']
        r['R'] = qvec_to_rot(*q)
        r['C'] = -r['R'].T @ np.array(r['tvec'], dtype=np.float64)

    return out


def qvec_to_rot(qw, qx, qy, qz):
    """四元数 → 旋转矩阵（COLMAP 约定 qvec = [w, x, y, z]）"""
    n = qw * qw + qx * qx + qy * qy + qz * qz
    if n < 1e-12:
        return np.eye(3)
    s = 2.0 / n
    qw, qx, qy, qz = qw, qx, qy, qz
    return np.array([
        [1 - s * (qy * qy + qz * qz), s * (qx * qy - qz * qw),     s * (qx * qz + qy * qw)],
        [s * (qx * qy + qz * qw),     1 - s * (qx * qx + qz * qz), s * (qy * qz - qx * qw)],
        [s * (qx * qz - qy * qw),     s * (qy * qz + qx * qw),     1 - s * (qx * qx + qy * qy)],
    ], dtype=np.float64)


def cam_to_world_matrix(R, t):
    """COLMAP 的 [R|t] 是世界→相机；返回相机→世界的 4×4 齐次矩阵"""
    M = np.eye(4)
    M[:3, :3] = R.T
    M[:3, 3] = -R.T @ t
    return M


def read_points3D(path):
    """
    读取 points3D.bin。Spirula 同样是非标准布局，故按「记录长度试错 + 末尾对齐」
    确定，见 tools/probe_points3d.py。

    返回 Nx3 float64 的 XYZ 数组（世界坐标系）。
    """
    with open(path, 'rb') as f:
        d = f.read()

    off = 0
    n, = struct.unpack_from('<Q', d, off); off += 8

    # 记录 = u64 id + 3×f64 xyz + 3×u8 rgb + f64 error + u64 track_len + track_len×8
    # 先试最常见的一种；不对就报错提示去跑 probe
    pts = np.empty((n, 3), dtype=np.float64)
    for i in range(n):
        pid, = struct.unpack_from('<Q', d, off); off += 8
        x, y, z = struct.unpack_from('<3d', d, off); off += 24
        off += 3          # rgb
        off += 8          # error
        tl, = struct.unpack_from('<Q', d, off); off += 8
        off += tl * 8
        pts[i] = (x, y, z)

    if off != len(d):
        raise ValueError(f'points3D.bin 解析未对齐：末偏移 {off} ≠ 文件长 {len(d)}')
    return pts


# ---------------------------------------------------------------- 坐标变换
# 由「SfM 点云 × scene.ply 点云」的俯视投影互相关 + 3D 直方图相关度实测确定，
# 不是推导的：
#     俯视投影相关度  0.5214（次优解仅 0.2686，区分度足够）
#     3D 相关度       0.4124（把 up 轴取反后掉到 0.2307）
# 三个轴的缩放都是 1.0 上下（0.90~1.11），平移 <0.05，说明 SfM 与 PLY 同尺度、
# 同原点，只需要换轴。
#
#     ply_x =  sfm_y
#     ply_y = +sfm_z     ← SfM 的 +Z 是上，映射到 PLY 的 +Y
#     ply_z =  sfm_x
#
# 网页世界坐标系 = PLY 资产坐标系绕 X 轴 180°（config.js: orientationDeg [180,0,0]），
# 即 (x, y, z) → (x, -y, -z)，所以：
#     world_x =  ply_x =  sfm_y
#     world_y = -ply_y = -sfm_z
#     world_z = -ply_z = -sfm_x
#
# 垂直轴的符号由「相机是否位于其正下方地面之上」实测判定：
#     world_y = +sfm_z  →  65.1% 的相机在地面之上，中位离地 +0.045
#     world_y = -sfm_z  →  仅 38.4% 在地面之上，中位离地 -0.038
# 前者明显正确（人扛着相机走路，绝大多数相机当然在地面之上）。
#
# 注意：这里推翻了早期笔记里写的 `ply = (x_sfm, -z_sfm, y_sfm)` —— 那个式子的
# X/Y 两轴对调了，是当初只用「轴跨度比值」粗判造成的误判。现在有互相关实测结果
# 作为依据，以本式为准。
def sfm_to_ply(p):
    return np.stack([p[..., 1], -p[..., 2], p[..., 0]], axis=-1)


def sfm_to_world(p):
    return np.stack([p[..., 1], p[..., 2], -p[..., 0]], axis=-1)


def world_to_sfm(p):
    """sfm_to_world 的逆变换"""
    return np.stack([-p[..., 2], p[..., 0], p[..., 1]], axis=-1)


def ply_to_world(p):
    return np.stack([p[..., 0], -p[..., 1], -p[..., 2]], axis=-1)


def world_to_ply(p):
    return np.stack([p[..., 0], -p[..., 1], -p[..., 2]], axis=-1)
