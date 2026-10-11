// 这个文件展示如何修改你的 WebSocketManager 来支持机器人动画
// 找到你项目中的 WebSocketManager.cs 文件，参考以下内容修改

using UnityEngine;

public class WebSocketManager : MonoBehaviour
{
    // ====== 新增：引用 RobotConversationAnimator ======
    [Header("机器人动画控制")]
    public RobotConversationAnimator robotAnimator;
    // ================================================

    // ... 你现有的其他字段 ...
    
    // Web Socket Client 组件（你截图中显示的）
    public WebSocketClient webSocketClient;

    void Start()
    {
        // ... 你现有的代码 ...
        
        // 确保找到 RobotConversationAnimator（如果忘记在Inspector中赋值）
        if (robotAnimator == null)
        {
            // 尝试在 RobotEntranceManager 上查找
            var robotManager = GameObject.Find("RobotEntranceManager");
            if (robotManager != null)
            {
                robotAnimator = robotManager.GetComponent<RobotConversationAnimator>();
            }
        }
        
        // 订阅 WebSocket 消息事件
        // 注意：这里假设你的 WebSocketClient 有 OnMessageReceived 事件
        // 如果没有，需要看 WebSocketClient 的具体实现来调整
        if (webSocketClient != null)
        {
            webSocketClient.OnMessageReceived += OnWebSocketMessage;
        }
    }
    
    void OnDestroy()
    {
        // 取消订阅，防止内存泄漏
        if (webSocketClient != null)
        {
            webSocketClient.OnMessageReceived -= OnWebSocketMessage;
        }
    }

    // ====== 新增：处理收到的 WebSocket 消息 ======
    private void OnWebSocketMessage(string message)
    {
        Debug.Log($"[WebSocketManager] 收到消息: {message}");
        
        // 将消息传递给机器人动画控制器
        if (robotAnimator != null)
        {
            robotAnimator.OnWebMessage(message);
        }
        else
        {
            Debug.LogWarning("[WebSocketManager] robotAnimator 未设置，无法处理动画消息");
        }
        
        // ... 你现有的其他消息处理逻辑 ...
    }
    // =============================================
}
