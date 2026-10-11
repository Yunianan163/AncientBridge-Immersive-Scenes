"""批量解算全部相机位姿 —— 快速版

相比 solve_all_cams.py 的两处关键提速：
1) 点 id -> 点数组下标 用「一次性构建的稠密/哈希映射」，不再每个点做一次 searchsorted。
2) RANSAC 用固定最小样本集（6 点 DLT），并在一次批量最小二乘里评估全部候选假设，
   避免逐点 SVD 分解。

输出：_cam_centers_sfm.npy / _cam_R.npy / _cam_ok.npy / _cam_names.npy / _cam_err.npy
"""
import sys, os, struct, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sfm_io

B = r'E:\葛镜桥高斯\模型1\sparse\0'
OUT = r'E:\葛镜桥高斯\最新模型\web\models'

# ----------------------------------------------------------------------------
# 1. 读取 3D 点，并建立 id -> 行号 的映射
# ----------------------------------------------------------------------------
P = np.load(os.path.join(OUT, '_sfm_points.npy'))          # (N,3)
d = open(os.path.join(B, 'points3D.bin'), 'rb').read()
n_pts = struct.unpack_from('<Q', d, 0)[0]
assert n_pts == len(P), f'点数不一致 {n_pts} vs {len(P)}'

ids = np.empty(n_pts, dtype=np.uint64)
off = 8
for i in range(n_pts):
    ids[i] = struct.unpack_from('<Q', d, off)[0]
    off += 8 + 24 + 3 + 8
    tl, = struct.unpack_from('<Q', d, off)
    off += 8 + tl * 8

# id 为连续整数时用稠密数组；否则回退到排序+searchsorted（但仍只做一次）
if ids.max() < 40_000_000:
    dense = np.full(int(ids.max()) + 1, -1, dtype=np.int32)
    dense[ids] = np.arange(n_pts, dtype=np.int32)
    def id_to_row(a):
        a = a.astype(np.int64)
        ok = (a < len(dense)) & (dense[a] >= 0)
        return dense[np.clip(a, 0, len(dense) - 1)], ok
else:
    srt = np.argsort(ids)
    sid = ids[srt]
    def id_to_row(a):
        pos = np.clip(np.searchsorted(sid, a), 0, len(sid) - 1)
        return srt[pos], sid[pos] == a

# ----------------------------------------------------------------------------
# 2. 相机内参
# ----------------------------------------------------------------------------
_cams = sfm_io.read_cameras(os.path.join(B, 'cameras.bin'))
_c0 = _cams[min(_cams)]                    # 主相机（model=4 OPENCV）
fx, fy, cx, cy = _c0['fx'], _c0['fy'], _c0['cx'], _c0['cy'], 
print(f'内参 fx={fx:.2f} fy={fy:.2f} cx={cx} cy={cy}  {_c0["w"]}x{_c0["h"]}', flush=True)

# ----------------------------------------------------------------------------
# 3. 批量 DLT + RANSAC（向量化）
# ----------------------------------------------------------------------------
def solve_frame(P3, uv, fx, fy, cx, cy, iters=400, thresh=3.0, min_inliers=20, seed=0):
    """单帧 DLT+RANSAC，向量化打分。"""
    rng = np.random.default_rng(seed)
    n = len(P3)
    if n < 8:
        return None
    u = uv[:, 0]; v = uv[:, 1]
    X, Y, Z = P3[:, 0], P3[:, 1], P3[:, 2]

    # 预组装每个点的 2x12 行（不含常数项位置，直接算）
    # 行1: [X,Y,Z,1, 0,0,0,0, -uX,-uY,-uZ,-u]
    # 行2: [0,0,0,0, X,Y,Z,1, -vX,-vY,-vZ,-v]
    best_mask = None; best_cnt = -1; best_P = None

    for _ in range(iters):
        idx = rng.choice(n, size=6, replace=False)
        Xs = P3[idx]; us = u[idx]; vs = v[idx]
        A = np.zeros((12, 12))
        A[0::2, 0:3] = Xs
        A[0::2, 3] = 1.0
        A[0::2, 8] = -us * Xs[:, 0]
        A[0::2, 9] = -us * Xs[:, 1]
        A[0::2, 10] = -us * Xs[:, 2]
        A[0::2, 11] = -us
        A[1::2, 4:7] = Xs
        A[1::2, 7] = 1.0
        A[1::2, 8] = -vs * Xs[:, 0]
        A[1::2, 9] = -vs * Xs[:, 1]
        A[1::2, 10] = -vs * Xs[:, 2]
        A[1::2, 11] = -vs
        try:
            _, _, vt = np.linalg.svd(A)
        except np.linalg.LinAlgError:
            continue
        p = vt[-1]
        # 打分（向量化）
        num_u = p[0] * X + p[1] * Y + p[2] * Z + p[3]
        num_v = p[4] * X + p[5] * Y + p[6] * Z + p[7]
        den = p[8] * X + p[9] * Y + p[10] * Z + p[11]
        good = np.abs(den) > 1e-9
        uh = np.where(good, num_u / np.where(good, den, 1.0), np.inf)
        vh = np.where(good, num_v / np.where(good, den, 1.0), np.inf)
        err = np.hypot(uh - u, vh - v)     # DLT 的 p 已是像素坐标系，误差直接是像素
        mask = err < thresh
        cnt = int(mask.sum())
        if cnt > best_cnt:
            best_cnt = cnt; best_mask = mask; best_P = p

    if best_cnt < min_inliers:
        return None
    # 用全部内点重解一次
    m = best_mask
    Xs = P3[m]; us = u[m]; vs = v[m]
    N = m.sum()
    A = np.zeros((2 * N, 12))
    A[0::2, 0:3] = Xs
    A[0::2, 3] = 1.0
    A[0::2, 8] = -us * Xs[:, 0]
    A[0::2, 9] = -us * Xs[:, 1]
    A[0::2, 10] = -us * Xs[:, 2]
    A[0::2, 11] = -us
    A[1::2, 4:7] = Xs
    A[1::2, 7] = 1.0
    A[1::2, 8] = -vs * Xs[:, 0]
    A[1::2, 9] = -vs * Xs[:, 1]
    A[1::2, 10] = -vs * Xs[:, 2]
    A[1::2, 11] = -vs
    _, _, vt = np.linalg.svd(A)
    p = vt[-1]
    Pmat = p.reshape(3, 4)

    # 分解 P = K[R|t]
    Kinv = np.array([[1 / fx, 0, -cx / fx], [0, 1 / fy, -cy / fy], [0, 0, 1.0]])
    S = Kinv @ Pmat
    nr = np.linalg.norm(S[:, :3], axis=1)
    S = S / nr[:, None]
    R = S[:, :3]; t = S[:, 3]
    U, _, Vt = np.linalg.svd(R)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        R = -R; t = -t
    C = -R.T @ t

    num_u = p[0] * X + p[1] * Y + p[2] * Z + p[3]
    num_v = p[4] * X + p[5] * Y + p[6] * Z + p[7]
    den = p[8] * X + p[9] * Y + p[10] * Z + p[11]
    good = np.abs(den) > 1e-9
    uh = np.where(good, num_u / np.where(good, den, 1.0), np.inf)
    vh = np.where(good, num_v / np.where(good, den, 1.0), np.inf)
    err = np.hypot(uh - u, vh - v)
    inl = err < thresh
    return dict(ok=True, R=R, t=t, C=C, err_med=float(np.median(err[inl])),
                inliers=int(inl.sum()), n=n)


# ----------------------------------------------------------------------------
# 4. 逐帧解算
# ----------------------------------------------------------------------------
imgs = sfm_io.read_images(os.path.join(B, 'images.bin'), with_points=True)
N = len(imgs)
C = np.full((N, 3), np.nan); Rall = np.full((N, 3, 3), np.nan)
ok_ = np.zeros(N, bool); errs = np.full(N, np.nan); inl = np.zeros(N, int)

t0 = time.time()
for i, im in enumerate(imgs):
    raw = im['points2D']; n2 = len(raw)
    uv = np.frombuffer(raw[:, :16].tobytes(), dtype='<f8').reshape(n2, 2)
    pids = np.frombuffer(raw[:, 16:].tobytes(), dtype='<u8')
    m = pids != 0xFFFFFFFFFFFFFFFF
    rows, okk = id_to_row(pids[m])
    P3 = P[rows[okk]]; UV = uv[m][okk]
    r = solve_frame(P3.astype(np.float64), UV.astype(np.float64), fx, fy, cx, cy,
                    iters=300, thresh=4.0, seed=i)
    if r:
        C[i] = r['C']; Rall[i] = r['R']
        ok_[i] = True; errs[i] = r['err_med']; inl[i] = r['inliers']
    if (i + 1) % 100 == 0:
        print(f'  {i+1}/{N}  {time.time()-t0:.0f}s  成功 {ok_.sum()}', flush=True)

print(f'完成 {ok_.sum()}/{N}，用时 {time.time()-t0:.0f}s', flush=True)
if ok_.sum():
    print('重投影中位误差分位 px:', np.nanpercentile(errs[ok_], [50, 90, 99]).round(3))
np.save(os.path.join(OUT, '_cam_centers_sfm.npy'), C)
np.save(os.path.join(OUT, '_cam_R.npy'), Rall)
np.save(os.path.join(OUT, '_cam_ok.npy'), ok_)
np.save(os.path.join(OUT, '_cam_err.npy'), errs)
np.save(os.path.join(OUT, '_cam_names.npy'), np.array([im['name'] for im in imgs]))
print('已保存')
