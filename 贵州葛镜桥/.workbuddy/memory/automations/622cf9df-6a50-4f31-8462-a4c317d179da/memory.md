# 2DGS 训练自动监控 - 执行记录

自动化 ID: 622cf9df-6a50-4f31-8462-a4c317d179da

## 2026-10-01 05:36 巡检
- setup_finish.log：编译全部成功（diff-surfel-rasterization、simple-knn 均已装好并验证可导入）。第一次训练启动曾有 import 报错，但已被后续重启覆盖。
- train_latest.log：05:35:26 训练正式启动，689 相机全部加载，初始点云 1,108,426 点，目标 30000 迭代。
- 巡检时进度：约 50/30000 迭代，速度约 3 it/s，Loss 0.26~0.34，预计总时长约 2.5~3 小时。
- 状态：训练中，无报错，未到完成检测条件。输出网格目录尚未创建。
- 行动：仅简报，未干预。

## 2026-10-01 13:25~15:10 收官巡检（自动化已删除）
- 训练早已完成（30000 迭代存档）。两次 TSDF 融合均在后处理阶段 OOM（vmmem 9.3GB），
  但 fuse_unbounded.ply(781MB) 完整落盘（PLY 头字节数校验通过）。
- 未按预案降相机重训——直接 Windows 侧接管：fast_integrate_2dgs.py（两阶段简化 75s）
  + final_fix_2dgs_glb.py（泼溅包围盒裁剪+最大连通域+轴置换 (x,-z,y)）。
- 坐标系实证：2DGS/undistort/模型1 逐位同系；scene.ply=纯轴置换。详见今日日志。
- config.js：mesh.url→scene_mesh_2dgs.glb（35.7MB, 253 万面），model.url 已复原。
- 修复 integrate_2dgs_mesh.py update_config 误改泼溅 URL 的 bug。
- 监控任务已按完成流程删除；保活会话已停止；8123 服务器保留。
