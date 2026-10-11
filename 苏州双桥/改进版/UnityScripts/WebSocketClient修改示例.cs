// 如果消息是在 WebSocketClient.cs 中接收的，这样修改：

using UnityEngine;

public class WebSocketClient : MonoBehaviour
{
    // ... 你现有的代码 ...
    
    // 新增：引用动画控制器
    private RobotConversationAnimator robotAnimator;
    
    void Start()
    {
        // ... 你现有的代码 ...
        
        // 查找动画控制器
        var robotManager = GameObject.Find("RobotEntranceManager");
        if (robotManager != null)
        {
            robotAnimator = robotManager.GetComponent<RobotConversationAnimator>();
        }
    }
    
    // 你的消息接收回调方法（可能是这个方法，名字可能不同）
    void OnMessage(string message)
    {
        Debug.Log($"[WebSocketClient] 收到消息: {message}");
        
        // 转发给动画控制器
        if (robotAnimator != null)
        {
            robotAnimator.OnWebMessage(message);
        }
        
        // ... 你现有的其他处理 ...
    }
}
