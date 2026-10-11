# Unity WebSocket 设置说明

## 必备脚本

你只需要这一个脚本：

- **WebSocketClient.cs** - WebSocket 客户端，处理与网页端的通信

## ⚠️ 重要设置步骤

### 步骤 1: 创建 WebSocket 管理器物体

1. 在 Unity Hierarchy 窗口中，右键点击空白处
2. 选择 `Create Empty`（创建空物体）
3. 命名为 `WebSocketManager`

### 步骤 2: 添加 WebSocketClient 脚本

1. 选中 `WebSocketManager` 物体
2. 将 `WebSocketClient.cs` 脚本拖到 Inspector 窗口
3. 确保脚本已启用（勾选框已勾选）

### 步骤 3: 配置参数（可选，使用默认值即可）

在 Inspector 窗口中检查：

| 参数 | 值 | 说明 |
|------|-----|------|
| Server Url | `ws://127.0.0.1:8082/ws` | WebSocket 服务器地址 |
| Reconnect Delay | 5 | 重连延迟（秒） |
| Heartbeat Interval | 30 | 心跳间隔（秒） |

### 步骤 4: 运行测试

1. 确保服务器已启动：`node server.js`
2. 在 Unity 中点击 Play 按钮运行
3. 打开 Console 窗口（Ctrl+Shift+C）
4. 应该看到以下日志：

```
[WebSocketClient] ========================================
[WebSocketClient] WebSocketClient Start() 被调用！
[WebSocketClient] 服务器地址: ws://127.0.0.1:8082/ws
[WebSocketClient] ========================================
WebSocket 已连接!
收到原始消息: {"type":"season","data":"spring",...}
```

## 故障排查

### 如果 Unity Console 没有任何 WebSocket 日志

**问题**：WebSocketClient 脚本没有被挂载或激活

**解决方法**：
1. 确认场景中有名为 `WebSocketManager` 的物体
2. 确认该物体上挂载了 `WebSocketClient` 脚本
3. 确认脚本左侧的勾选框已勾选（enabled）
4. 确认物体在 Inspector 顶部是激活状态（前面有 ✓）

### 如果显示 "WebSocket 错误"

**问题**：无法连接到服务器

**解决方法**：
1. 确认 CMD 中服务器已启动（`node server.js`）
2. 确认服务器显示 "服务器已启动，端口 8082"
3. 检查防火墙是否阻止了 8082 端口

### 如果连接成功但收不到消息

**问题**：消息转发失败

**解决方法**：
1. 检查 CMD 中是否显示 "✅ 注册为: unity"
2. 检查点击按钮时是否显示 "✅ 已转发给 unity"
3. 如果没有，说明 Unity 没有正确注册，重启 Unity 试试

## 完整测试流程

1. **启动服务器**
   ```bash
   cd 网站部分
   node server.js
   ```

2. **运行 Unity**
   - 点击 Play 按钮
   - 查看 Console 是否有 "WebSocket 已连接!"

3. **打开网页**
   - 访问 `http://127.0.0.1:8082`
   - 查看 Console 是否显示 "✅ 注册为: web"

4. **点击季节按钮**
   - 点击网页上的"春"
   - 查看 CMD 是否显示 "✅ 已转发给 unity"
   - 查看 Unity Console 是否显示 "收到原始消息"

## 联系支持

如果以上步骤无法解决问题，请提供：
1. Unity Console 的完整截图
2. CMD 窗口的完整截图
3. Hierarchy 窗口的截图（显示 WebSocketManager）
4. Inspector 窗口的截图（显示 WebSocketClient 配置）
