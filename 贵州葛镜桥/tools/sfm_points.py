"""复用工具：加载 points3D.bin 的点 id 列表，并建立 id -> 行号 映射。"""
import os
import struct
import numpy as np

B_DEFAULT = r'E:\葛镜桥高斯\模型1\sparse\0'
OUT_DEFAULT = r'E:\葛镜桥高斯\最新模型\web\models'


def load_point_ids(path, verbose=False):
    """返回 (ids, offsets)，ids 为 points3D.bin 中每个点的 id。"""
    d = open(path, 'rb').read()
    n, = struct.unpack_from('<Q', d, 0)
    ids = np.empty(n, dtype=np.uint64)
    off = 8
    for i in range(n):
        ids[i], = struct.unpack_from('<Q', d, off)
        off += 8 + 24 + 3 + 8          # id + xyz(3f8) + rgb(3u1) + error(f8)
        tl, = struct.unpack_from('<Q', d, off)
        off += 8 + tl * 8
    if verbose:
        print(f'points3D: {n} 个点, 解析结束偏移 {off} / 文件 {len(d)}')
    return ids


def id_to_row_map(ids):
    """构建 id -> 行号 的查表函数。"""
    if ids.max() < 40_000_000:
        dense = np.full(int(ids.max()) + 1, -1, dtype=np.int32)
        dense[ids] = np.arange(len(ids), dtype=np.int32)

        def f(a):
            a = a.astype(np.int64)
            cl = np.clip(a, 0, len(dense) - 1)
            return dense[cl], (a < len(dense)) & (dense[cl] >= 0)
        return f
    srt = np.argsort(ids)
    sid = ids[srt]

    def f(a):
        pos = np.clip(np.searchsorted(sid, a), 0, len(sid) - 1)
        return srt[pos], sid[pos] == a
    return f


def frame_observations(im, id_to_row, P):
    """从一帧的 points2D 里取出 (3D点, 像素uv)。"""
    raw = im['points2D']
    if raw is None or len(raw) == 0:
        return np.zeros((0, 3)), np.zeros((0, 2))
    uv = np.frombuffer(raw[:, :16].tobytes(), dtype='<f8').reshape(len(raw), 2)
    pids = np.frombuffer(raw[:, 16:].tobytes(), dtype='<u8')
    m = pids != 0xFFFFFFFFFFFFFFFF
    rows, ok = id_to_row(pids[m])
    return P[rows[ok]].astype(np.float64), uv[m][ok].astype(np.float64)


def load_all(base=B_DEFAULT, out=OUT_DEFAULT):
    """一次性加载点云、相机、图像索引。"""
    P = np.load(os.path.join(out, '_sfm_points.npy')).astype(np.float64)
    ids = load_point_ids(os.path.join(base, 'points3D.bin'))
    return P, id_to_row_map(ids)
