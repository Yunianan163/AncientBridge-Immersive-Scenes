using System;
using UnityEngine;
using Newtonsoft.Json.Linq;

/// <summary>
/// 机器人对话动画控制器
/// 接收来自网页语音对话的 WebSocket 消息，控制机器人 Animator 的动画状态
/// </summary>
[RequireComponent(typeof(Animator))]
public class RobotAnimationController : MonoBehaviour
{
    [Header("Animator 引用")]
    [Tooltip("机器人的 Animator 组件")]
    public Animator robotAnimator;

    [Header("Animator Trigger 名称")]
    [Tooltip("倾听时点头的 Trigger 名称")]
    public string listenNodTrigger = "ListenNod";
    
    [Tooltip("用户说完后回应点头的 Trigger 名称")]
    public string afterUserNodTrigger = "AfterUserNod";
    
    [Tooltip("说话动画 1 的 Trigger 名称")]
    public string talk1Trigger = "Talk1";
    
    [Tooltip("说话动画 2 的 Trigger 名称")]
    public string talk2Trigger = "Talk2";

    [Header("节流设置")]
    [Tooltip("倾听点头的冷却时间（秒）")]
    public float listenNodCooldown = 1.2f;
    
    [Tooltip("说话动画的冷却时间（秒）")]
    public float talkGestureCooldown = 1.0f;

    // 冷却时间记录
    private float lastListenNodTime = -999f;
    private float lastTalkTime = -999f;

    void Start()
    {
        if (robotAnimator == null)
        {
            robotAnimator = GetComponent<Animator>();
            if (robotAnimator == null)
            {
                Debug.LogError("[RobotAnimation] 未找到 Animator 组件！");
            }
        }

        // 订阅 WebSocket 消息事件
        // 注意：这里假设你有一个 WebSocketManager 类来管理连接和消息
        // 根据你的实际项目结构调整这里的代码
        WebSocketClient.OnMessageReceived += OnWebSocketMessage;
    }

    void OnDestroy()
    {
        WebSocketClient.OnMessageReceived -= OnWebSocketMessage;
    }

    /// <summary>
    /// 处理收到的 WebSocket 消息
    /// </summary>
    private void OnWebSocketMessage(string message)
    {
        try
        {
            JObject msg = JObject.Parse(message);
            string msgType = msg["type"]?.ToString();
            string from = msg["from"]?.ToString();

            // 只处理来自网页的消息
            if (from != "web") return;

            switch (msgType)
            {
                case "robotListenNod":
                    HandleListenNod();
                    break;

                case "robotAfterUserNod":
                    HandleAfterUserNod();
                    break;

                case "robotTalkStart":
                    string trigger = msg["trigger"]?.ToString();
                    HandleTalkStart(trigger);
                    break;

                case "robotTalkEnd":
                    HandleTalkEnd();
                    break;

                case "robotConversationReady":
                    Debug.Log("[RobotAnimation] 语音对话已就绪");
                    break;
            }
        }
        catch (Exception e)
        {
            Debug.LogError($"[RobotAnimation] 处理消息失败: {e.Message}");
        }
    }

    /// <summary>
    /// 处理倾听点头动画
    /// 当用户开始说话时触发
    /// </summary>
    private void HandleListenNod()
    {
        // 检查冷却时间
        if (Time.time - lastListenNodTime < listenNodCooldown)
        {
            return;
        }

        lastListenNodTime = Time.time;
        
        if (robotAnimator != null)
        {
            robotAnimator.SetTrigger(listenNodTrigger);
            Debug.Log($"[RobotAnimation] 触发倾听点头: {listenNodTrigger}");
        }
    }

    /// <summary>
    /// 处理用户说完后的回应点头
    /// 当用户说完话后触发
    /// </summary>
    private void HandleAfterUserNod()
    {
        if (robotAnimator != null)
        {
            robotAnimator.SetTrigger(afterUserNodTrigger);
            Debug.Log($"[RobotAnimation] 触发回应点头: {afterUserNodTrigger}");
        }
    }

    /// <summary>
    /// 处理开始说话动画
    /// 当 AI 开始说话（TTS）时触发
    /// </summary>
    private void HandleTalkStart(string trigger)
    {
        // 检查冷却时间
        if (Time.time - lastTalkTime < talkGestureCooldown)
        {
            return;
        }

        lastTalkTime = Time.time;

        if (robotAnimator != null)
        {
            string actualTrigger = string.IsNullOrEmpty(trigger) ? talk1Trigger : trigger;
            robotAnimator.SetTrigger(actualTrigger);
            Debug.Log($"[RobotAnimation] 触发说话动画: {actualTrigger}");
        }
    }

    /// <summary>
    /// 处理停止说话
    /// 当 AI 停止说话时，动画会自动返回到 Empty 状态
    /// </summary>
    private void HandleTalkEnd()
    {
        // 注意：根据你的 Animator 设置，可能需要重置某些 Bool 参数
        // 或者让动画通过 Transition 自动返回到 Empty 状态
        Debug.Log("[RobotAnimation] AI 停止说话");
    }
}
