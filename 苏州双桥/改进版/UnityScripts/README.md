# 机器人语音对话动画集成指南

## 概述

本文档说明如何将语音对话功能与 Unity 场景中机器人的动画进行对接，实现：
- 用户开始说话时：机器人点头倾听
- 用户说完话后：机器人回应点头
- AI 开始说话时：机器人播放说话动画
- AI 停止说话时：动画自动返回待机状态

## 消息类型

Web 端会发送以下消息给 Unity：

| 消息类型 | 触发时机 | 说明 |
|---------|---------|------|
| `robotListenNod` | 用户开始说话（ASR识别到临时结果） | 触发倾听点头动画 |
| `robotAfterUserNod` | 用户说完话（ASR识别到最终结果） | 触发回应点头动画 |
| `robotTalkStart` | AI开始说话（TTS开始） | 触发说话动画，带 `trigger` 参数（Talk1/Talk2） |
| `robotTalkEnd` | AI停止说话（TTS结束） | 说话动画结束 |
| `robotConversationReady` | 语音对话连接成功 | 可用来显示提示信息 |

## 消息格式

```json
{
    "type": "robotListenNod",
    "trigger": "ListenNod",
    "from": "web",
    "time": "2026-04-06T12:00:00.000Z"
}
```

## Unity 集成步骤

### 方法一：使用 RobotConversationAnimator 脚本（推荐）

1. 将 `RobotConversationAnimator.cs` 添加到 `RobotEntranceManager` 游戏对象上

2. 在 Inspector 中配置：
   - **Robot Animator**: 拖拽机器人的 Animator 组件
   - **Listen Nod Trigger**: 输入倾听点点的 Trigger 名称（默认：ListenNod）
   - **After User Nod Trigger**: 输入回应点头的 Trigger 名称（默认：AfterUserNod）
   - **Talk 1 Trigger**: 输入说话动画1的 Trigger 名称（默认：Talk1）
   - **Talk 2 Trigger**: 输入说话动画2的 Trigger 名称（默认：Talk2）

3. 修改你的 WebSocketManager，在收到消息时调用 `RobotConversationAnimator.OnWebMessage()`:

```csharp
public class WebSocketManager : MonoBehaviour
{
    public RobotConversationAnimator robotAnimator;
    
    void OnMessage(string message)
    {
        // ... 你的其他消息处理逻辑 ...
        
        // 将消息传递给动画控制器
        if (robotAnimator != null)
        {
            robotAnimator.OnWebMessage(message);
        }
    }
}
```

### 方法二：在现有 WebSocket 脚本中直接处理

如果你已经有 WebSocket 接收脚本，可以直接添加以下代码：

```csharp
void OnWebSocketMessage(string message)
{
    // 解析 JSON
    var msg = JsonUtility.FromJson<WebMessage>(message);
    
    if (msg.from != "web") return;
    
    switch (msg.type)
    {
        case "robotListenNod":
            animator.SetTrigger("ListenNod");
            break;
        case "robotAfterUserNod":
            animator.SetTrigger("AfterUserNod");
            break;
        case "robotTalkStart":
            animator.SetTrigger(msg.trigger); // "Talk1" 或 "Talk2"
            break;
        case "robotTalkEnd":
            // 动画会自动返回 Empty 状态
            break;
    }
}
```

## Animator Controller 配置

确保你的 Animator Controller 有以下配置：

### TalkLayer（说话动画层）
- **TalkEmpty**: 默认空状态
- **Talking1**: 说话动画1，由 `Talk1` Trigger 触发
- **Talking2**: 说话动画2，由 `Talk2` Trigger 触发

### HeadLayer（头部动画层）
- **HeadEmpty**: 默认空状态
- **Lengthy Head Nod**: 长时间点头，可由 `ListenNod` 触发
- **Thoughtful Head Nod**: 思考点头，可由 `AfterUserNod` 触发

### 参数设置
创建以下 Trigger 参数：
- `ListenNod`
- `AfterUserNod`
- `Talk1`
- `Talk2`

## 测试

1. 启动 Web 服务器：`node 网站部分/server.js`
2. 在 Unity 中运行场景
3. 打开网页，完成前置任务进入语音对话
4. 点击"开始对话"按钮
5. 观察机器人动画是否随语音状态变化：
   - 你说话时 -> 机器人倾听点头
   - 你说完后 -> 机器人回应点头
   - 机器人说话时 -> 机器人播放说话动画

## 故障排除

### 动画不触发
1. 检查浏览器控制台是否有消息发送
2. 检查 Unity 控制台是否收到消息
3. 确认 Animator 的 Trigger 名称拼写正确
4. 确认 RobotConversationAnimator 的引用已设置

### 消息收不到
1. 检查 WebSocket 连接是否正常
2. 检查 `from` 字段是否为 "web"
3. 检查消息类型是否匹配

### 动画播放不流畅
1. 调整 `listenNodCooldown` 和 `talkGestureCooldown` 参数
2. 检查 Animator 的 Transition 是否有 Exit Time
