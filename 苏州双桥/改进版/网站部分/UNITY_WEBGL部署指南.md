# Unity WebGL 部署指南

## 快速开始

### 第一步：在 Unity 中构建 WebGL

1. 打开 Unity 项目 `(新1)苏州双桥Unity`
2. 选择菜单 `File` -> `Build Settings`
3. 选择 `WebGL` 平台，点击 `Switch Platform`
4. 点击 `Build` 按钮
5. 选择输出目录为 `网站部分/Build/`

### 第二步：配置 Unity 项目

#### 1. 创建 WebGLBridge 脚本

在 Unity 项目中：
1. 创建文件夹 `Assets/Scripts/WebGL/`
2. 将 `网站部分/UnityScripts/WebGLBridge.cs` 复制到该文件夹
3. 将 `网站部分/UnityScripts/Plugins/WebGL/WebGLPlugin.jslib` 复制到 `Assets/Plugins/WebGL/`

#### 2. 创建空物体并挂载脚本

1. 在场景中创建一个空 GameObject，命名为 `WebGLBridge`
2. 挂载 `WebGLBridge.cs` 脚本
3. 设置引用（如果有相关脚本）：
   - SeasonManager: 季节管理器
   - DroneController: 无人机控制器
   - RobotConversationAnimator: 机器人动画控制器

#### 3. 构建设置调整

在 `Build Settings` -> `Player Settings` 中：
- **Resolution and Presentation**: 
  - Template: Default
  - Resolution: 1280x720 (或根据需要)
- **Publishing Settings**:
  - Compression Format: Gzip (推荐)
  - WebAssembly Arithmetic: 勾选
- **Other Settings**:
  - WebGL Memory Size: 256-512 MB (根据场景复杂度)

### 第三步：测试运行

1. 构建完成后，确保文件在 `网站部分/Build/` 目录
2. 打开 `网站部分/index.html`
3. 应该看到：
   - Unity 加载进度条
   - 加载完成后 Unity 场景作为背景
   - 所有网页面板（语音对话、任务进度等）浮在上方

## 文件结构

```
网站部分/
├── index.html              # 主页面（已配置好 Unity 加载）
├── style.css               # 样式（已配置好层级关系）
├── main.js                 # 主脚本（已配置好通信）
├── voice-dialog.js         # 语音对话模块
├── Build/                  # Unity WebGL 构建输出
│   ├── Build.data.gz       # (或 .unityweb)
│   ├── Build.framework.js.gz
│   ├── Build.wasm.gz
│   └── Build.loader.js
├── StreamingAssets/        # 流式资源（如果有）
└── UnityScripts/           # Unity 脚本示例
    ├── WebGLBridge.cs
    └── Plugins/WebGL/WebGLPlugin.jslib
```

## 通信协议

### 网页 -> Unity

网页发送消息到 Unity 通过 `sendToServer(data)` 函数：

```javascript
// 切换季节
sendToServer({
    type: 'changeSeason',
    season: 'spring'  // spring, summer, autumn, winter
});

// 控制无人机
sendToServer({
    type: 'droneCommand',
    command: 'takeoff'  // takeoff, land, move
});

// 机器人动画
sendToServer({
    type: 'robotTalkStart',
    trigger: 'Talk1'  // Talk1, Talk2
});

sendToServer({
    type: 'robotTalkEnd'
});
```

Unity 端接收（WebGLBridge.cs）：
```csharp
public void OnMessageFromWeb(string jsonMessage)
{
    // 自动解析并分发到对应处理函数
}
```

### Unity -> 网页

Unity 发送消息到网页：

```csharp
WebGLBridge.Instance.SendToWeb("{\"type\":\"modelClicked\",\"modelType\":\"shide\"}");
```

网页接收（main.js 中已配置）：
```javascript
window.unityMessageReceiver = function(message) {
    // 处理 Unity 消息
};
```

## 样式说明

### 层级关系

- **Unity**: `z-index: 1` (背景)
- **HUD 面板**: `z-index: 10` (浮在 Unity 上方)
- **消息提示**: `z-index: 20`
- **视频覆盖层**: `z-index: 999` (最顶层)

### 面板位置

所有面板位置已配置为不遮挡重要内容：
- 语音对话面板：右侧 `right: 20px; top: 380px`
- 任务进度面板：右上角
- 指令面板：左上角
- 底部控制按钮：底部中央

## 故障排除

### Unity 无法加载

1. **检查文件路径**
   - 确保 `Build/` 文件夹中有正确的文件
   - 文件名需要与 `index.html` 中的 `unityConfig` 配置匹配

2. **浏览器控制台错误**
   - 打开 F12 -> Console 查看具体错误
   - 常见的跨域问题需要启动本地服务器

3. **启动本地服务器测试**
   ```bash
   # 使用 Python
   cd 网站部分
   python -m http.server 8000
   
   # 或使用 Node.js
   npx serve .
   ```
   然后访问 `http://localhost:8000`

### 通信失败

1. **检查 WebGLBridge 是否正确挂载**
   - 确保场景中有 WebGLBridge 物体
   - 检查物体名称是否为 `WebGLBridge`

2. **检查 JavaScript 插件**
   - 确保 `WebGLPlugin.jslib` 在 `Assets/Plugins/WebGL/` 文件夹

3. **查看浏览器控制台**
   - Unity 和网页都会输出通信日志

## 浏览器兼容性

- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+

需要支持：
- WebGL 2.0
- WebAssembly

## 性能优化建议

1. **纹理压缩**：使用 Crunch 压缩纹理
2. **模型优化**：减少多边形数量，使用 LOD
3. **代码剥离**：启用 Managed Stripping Level: High
4. **异步加载**：大资源使用 Addressables 异步加载
5. **分辨率自适应**：根据设备性能调整渲染分辨率

## 注意事项

1. **文件大小**：WebGL 构建文件较大，建议使用 Gzip 压缩
2. **首次加载**：可能需要 10-30 秒加载时间，建议添加加载提示
3. **内存限制**：WebGL 有内存限制，注意控制场景复杂度
4. **输入处理**：Unity 需要焦点才能接收输入，点击 Unity 区域获取焦点
