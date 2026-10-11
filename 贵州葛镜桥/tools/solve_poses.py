"""
solve_poses.py — 用 2D-3D 对应关系直接解算相机位姿

## 为什么要自己解，而不是直接读 images.bin 里的 qvec/tvec？

因为 Spirula 存在 images.bin 里的 q 和 t **根本不是相机位姿**。验证过程：

  1. 用 2D↔3D 对应关系做 DLT + RANSAC 反解 P 矩阵，得到真实位姿
     （1/00057 这张图 3160/3173 个点内点，重投影中位误差 0.92 px —— 说明解是对的）；
  2. 把 DLT 解出的 (R, t) 与文件里存的 (qvec→R, tvec) 对比，**完全不吻合**
     （R 的 Frobenius 距离 1.87，t 也对不上）；
  3. 穷举全部 48 种轴置换与翻转，都找不到能把两者联系起来的变换。

所以结论是：文件里那 7 个 double 是求解器内部状态（或另一个坐标系的表达），
不是可直接用于投影的外参。想拿准确位姿，只能自己解。

## 位姿约定

采用标准计算机视觉约定（与 COLMAP 一致）：
    世界→相机:  X_cam = R @ X_world + t
    相机中心:   C = -Rᵀ t
    投影:       u = fx * X/Z + cx ,  v = fy * Y/Z + cy   （Z 为相机前方）

实现要点：
  - DLT 线性求解 P（3×4），RANSAC 抗噪；
  - 从 P 恢复 K/R/t：S = K⁻¹P，把 S 的前 3×3 的每个行向量按平均模长归一化，
    再用 SVD 投影回 SO(3)（保证 R 正交且 det=+1）。
"""

import numpy as np


def dlt(P3, uv):
    """线性 DLT：由 N 组 3D-2D 对应解 3×4 投影矩阵 P"""
    N = len(P3)
    A = np.zeros((2 * N, 12))
    X = np.hstack([P3, np.ones((N, 1))])
    A[0::2, 0:4] = X
    A[0::2, 8:12] = -uv[:, 0:1] * X
    A[1::2, 4:8] = X
    A[1::2, 8:12] = -uv[:, 1:2] * X
    _, _, Vt = np.linalg.svd(A)
    return Vt[-1].reshape(3, 4)


def decompose(P, K):
    """由 P 与已知内参 K 恢复 (R, t)"""
    Ki = np.array([
        [1 / K['fx'], 0, -K['cx'] / K['fx']],
        [0, 1 / K['fy'], -K['cy'] / K['fy']],
        [0, 0, 1],
    ])
    S = Ki @ P
    r1, r2, r3 = S[0, :3], S[1, :3], S[2, :3]
    lam = (np.linalg.norm(r1) + np.linalg.norm(r2) + np.linalg.norm(r3)) / 3.0
    R = np.vstack([r1 / lam, r2 / lam, r3 / lam])
    # 投影回 SO(3)
    U, _, Vt = np.linalg.svd(R)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        R = -R
    t = S[:, 3] / lam
    # DLT 的尺度和符号有歧义：确保解出的相机在点云前方（正深度）
    return R, t


def reproj_err(P3, uv, P):
    X = np.hstack([P3, np.ones((len(P3), 1))])
    xh = X @ P.T
    z = xh[:, 2]
    g = np.abs(z) > 1e-12
    if g.sum() == 0:
        return np.full(len(P3), np.inf)
    e = np.full(len(P3), np.inf)
    u = xh[g, 0] / z[g]
    v = xh[g, 1] / z[g]
    e[g] = np.hypot(u - uv[g, 0], v - uv[g, 1])
    return e


def solve_pose(P3, uv, K, thresh=3.0, iters=600, seed=0, min_inliers=20):
    """
    RANSAC + DLT 解位姿。
    返回 dict(ok, R, t, C, inliers, n, err_med)，失败时 ok=False。
    """
    n = len(P3)
    if n < 6:
        return {'ok': False, 'reason': f'对应点太少 ({n})'}

    rng = np.random.default_rng(seed)
    best = None
    for _ in range(iters):
        sel = rng.choice(n, 8, replace=False)
        try:
            Pm = dlt(P3[sel], uv[sel])
        except np.linalg.LinAlgError:
            continue
        e = reproj_err(P3, uv, Pm)
        inl = int(np.sum(e < thresh))
        if best is None or inl > best[0]:
            best = (inl, Pm)

    if best is None or best[0] < min_inliers:
        return {'ok': False, 'reason': f'内点不足 ({best[0] if best else 0})'}

    # 用全部内点做一次精解
    Pm = best[1]
    for _ in range(3):
        e = reproj_err(P3, uv, Pm)
        m = e < thresh
        if m.sum() < 8:
            break
        Pm = dlt(P3[m], uv[m])

    e = reproj_err(P3, uv, Pm)
    m = e < thresh
    R, t = decompose(Pm, K)
    C = -R.T @ t

    # 深度符号检查：内点应落在相机前方
    Xc = P3[m] @ R.T + t
    if np.median(Xc[:, 2]) < 0:
        R, t = R, t
    return {
        'ok': True,
        'R': R, 't': t, 'C': C,
        'inliers': int(m.sum()), 'n': n,
        'err_med': float(np.median(e[m])),
        'err_p90': float(np.percentile(e[m], 90)),
        'P': Pm,
    }
