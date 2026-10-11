# 项目长期记忆 —— 葛镜桥三维场景（web）

## 坐标系链条（2026-10-01 多轮实证，勿再重推）
- **模型1（Spirula 导出 sparse/0）= 2DGS重训/model1 = model1_undistort**：
  三者 COLMAP 世界系逐位一致（points3D、345 台相机中心偏差全 0；
  undistort 只重写内参 PINHOLE，位姿原样复制）。
- **web/models/scene.ply（泼溅资产系）= 模型1 系经 (x, -z, y) 纯轴置换**：
  同尺度同原点。因此 2DGS 网格 → 泼溅系只需置换 (x,-z,y)，**无需缩放/ICP**。
- 查看器 viewer.js 的 loadMesh 只对网格施加 modelOrientation(180°X)，不居中不缩放，
  所以 GLB 必须预先落在泼溅资产系。
- 竖直轴：SfM 系 +Z 朝上 → 泼溅系竖直为 -Y（config.js orientationDeg=[180,0,0] 修正）。
- 尺度标定：约 115 米/单位（metersPerUnit，见 config.js roaming 注释）。
- 坑：tools/sfm_io.py 所记「Spirula images.bin 12 字节前导、字段重排」是误读——
  影像名恰 11 字符时官方 COLMAP 布局与误读布局总长相等，末尾断言会骗过人。
  images.bin 就是官方布局（iid4+qvec32+tvec24+camid4+name\0+n2d8+2D点×24B）。

## 2DGS 网格产物现状（2026-10-01 上线）
- web/models/scene_mesh_2dgs.glb：35.7MB，218,720 顶点 / 2,535,451 面，顶点色+KHR_unlit。
  来源 fuse_unbounded.ply（13.7M 顶点/31.7M 面）→ 两阶段简化 → 泼溅包围盒裁剪
  （去 TSDF 竖直幕帘浮块，面数减半）→ 最大连通域 → 轴置换。
- 工具：fast_integrate_2dgs.py（75s 快线，3100 万面直接 quadric 要 1h+）；
  final_fix_2dgs_glb.py（裁剪+去浮块+置换，幂等可重跑，读当前 GLB 前先跑 fast_integrate 还原）。
- WSL 内 TSDF 后处理（最大连通域那步）在 345 相机下稳定 OOM（vmmem→9.3GB 被 kill），
  Windows 侧接管即可，fuse_unbounded.ply 本体完整（PLY 头字节数可校验完整性）。
- integrate_2dgs_mesh.py 的 update_config() 已修：只改 mesh 小节的 url（曾误改泼溅 URL）。
- 旧网格 scene_mesh_tex.glb（40 机位烘焙贴图版）仍在，可随时切回。

## 运维备忘
- WSL 内存上限 10GB；2DGS 相关大内存步骤（全量载图/TSDF）容易 OOM kill，
  判活以 nvidia-smi 为准（日志有 Python 块缓冲滞后 10-20 分钟）。
- 网页服务：tools/serve.py 8123 端口；验证连通用 Python http.client 直连 127.0.0.1
  （curl 会被沙箱代理拦截出假响应）。
- 泼溅 side：按 M 键切换泼溅/网格对比。

## 网页形态变更（2026-10-06）
- 网页已改为「天空+反射水面+无人机航拍」形态：人物漫游与 M 键网格模式已删除
  （terrain.js/character.js 不再被引用，scene_mesh_2dgs.glb 留在 models 备用）。
- 新模块：js/environment.js（three r170 Sky+Water）、js/drone.js（SkyPath 式运镜）。
- **Water.js 坑**：distortionScale 是尺度参数（偏移=normal·(1/距离)·值），小场景
  （相机到水面 <1 单位）必须用 ~0.015，否则 ClampToEdge 让倒影变灰白一片；
  天空反射过亮用 water.reflectionDim(0.72) 在 shader 里压 reflectionSample。
- e2e 用真 GPU 无头（勿加 swiftshader 参数，否则反射整场景软渲两遍会冻结 rAF）。
- mjs 里 Windows 路径必须双反斜杠或正斜杠：`\w` 会被吞（`最新模型\web`→`最新模型web`）。
