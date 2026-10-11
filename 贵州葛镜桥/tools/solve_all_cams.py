"""批量解算全部相机位姿（约 1378 张，需数分钟）"""
import sys, struct, numpy as np, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sfm_io, solve_poses

B = r'E:/葛镜桥高斯/模型1/sparse/0'
OUT = r'E:/葛镜桥高斯/最新模型/web/models'

P = np.load(os.path.join(OUT, '_sfm_points.npy'))
d = open(os.path.join(B, 'points3D.bin'), 'rb').read()
n = struct.unpack_from('<Q', d, 0)[0]
off = 8; ids = np.empty(n, dtype=np.uint64)
for i in range(n):
    ids[i] = struct.unpack_from('<Q', d, off)[0]; off += 8 + 24 + 3 + 8
    tl, = struct.unpack_from('<Q', d, off); off += 8 + tl * 8
srt = np.argsort(ids); sid = ids[srt]

def lookup(a):
    i = np.clip(np.searchsorted(sid, a), 0, len(sid) - 1)
    return srt[i], sid[i] == a

imgs = sfm_io.read_images(os.path.join(B, 'images.bin'), with_points=True)
K = sfm_io.read_cameras(os.path.join(B, 'cameras.bin'))[1]

N = len(imgs)
C = np.full((N, 3), np.nan); Rall = np.full((N, 3, 3), np.nan)
ok_ = np.zeros(N, bool); errs = np.full(N, np.nan); inl = np.zeros(N, int)
t0 = time.time()
for i, im in enumerate(imgs):
    raw = im['points2D']; n2 = len(raw)
    uv = np.frombuffer(raw[:, :16].tobytes(), dtype='<f8').reshape(n2, 2)
    pids = np.frombuffer(raw[:, 16:].tobytes(), dtype='<u8')
    m = pids != 0xFFFFFFFFFFFFFFFF
    idx, okk = lookup(pids[m])
    P3 = P[idx[okk]]; UV = uv[m][okk]
    r = solve_poses.solve_pose(P3, UV, K, iters=250)
    if r['ok']:
        C[i] = r['C']; Rall[i] = r['R']
        ok_[i] = True; errs[i] = r['err_med']; inl[i] = r['inliers']
    if (i + 1) % 100 == 0:
        print(f'  {i+1}/{N}  {time.time()-t0:.0f}s  成功 {ok_.sum()}', flush=True)

print(f'完成 {ok_.sum()}/{N}，用时 {time.time()-t0:.0f}s', flush=True)
print('重投影中位误差分位:', np.nanpercentile(errs[ok_], [50, 90, 99]).round(3))
np.save(os.path.join(OUT, '_cam_centers_sfm.npy'), C)
np.save(os.path.join(OUT, '_cam_R.npy'), Rall)
np.save(os.path.join(OUT, '_cam_ok.npy'), ok_)
np.save(os.path.join(OUT, '_cam_names.npy'), np.array([im['name'] for im in imgs]))
print('已保存')
