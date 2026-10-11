using System;
using UnityEngine;

/// <summary>
/// 机器人对话动画控制器 - 简化版
/// 与 RobotEntranceManager 配合使用的动画控制脚本
/// </summary>
[RequireComponent(typeof(Animator))]
public class RobotConversationAnimator : MonoBehaviour
{
    [Header("机器人 Animator")]
    public Animator robotAnimator;

    [Header("Animator Trigger 名称")]
    public string listenNodTrigger = "ListenNod";
    public string afterUserNodTrigger = "AfterUserNod";
    public string talk1Trigger = "Talk1";
    public string talk2Trigger = "Talk2";

    [Header("节流设置")]
    public float listenNodCooldown = 1.2f;
    public float talkGestureCooldown = 1.0f;

    private float lastListenNodTime = -999f;
    private float lastTalkTime = -999f;
    private System.Random random = new System.Random();

    void Start()
    {
        if (robotAnimator == null)
        {
            robotAnimator = GetComponent<Animator>();
        }
    }

    /// <summary>
    /// 从 WebSocketManager 调用的消息处理入口
    /// </summary>
    public void OnWebMessage(string jsonMsg)
    {
        try
        {
            // 简单解析 JSON，提取 type 字段
            string type = ExtractJsonValue(jsonMsg, "type");
            string from = ExtractJsonValue(jsonMsg, "from");

            // 只处理来自 web 的消息
            if (from != "web") return;

            Debug.Log($"[RobotAnimator] 收到消息类型: {type}");

            switch (type)
            {
                case "robotListenNod":
                    TriggerListenNod();
                    break;

                case "robotAfterUserNod":
                    TriggerAfterUserNod();
                    break;

                case "robotTalkStart":
                    string trigger = ExtractJsonValue(jsonMsg, "trigger");
                    TriggerTalk(trigger);
                    break;

                case "robotTalkEnd":
                    // 说话结束，动画会自动返回 Empty 状态
                    Debug.Log("[RobotAnimator] AI 停止说话");
                    break;

                case "robotConversationReady":
                    Debug.Log("[RobotAnimator] 语音对话已就绪");
                    break;

                case "robotReset":
                case "resetRobotAnimation":
                    ResetAnimation();
                    break;
            }
        }
        catch (Exception e)
        {
            Debug.LogError($"[RobotAnimator] 处理消息失败: {e.Message}");
        }
    }

    /// <summary>
    /// 重置动画状态 - 关闭语音对话时调用
    /// </summary>
    public void ResetAnimation()
    {
        if (robotAnimator != null)
        {
            // 重置所有触发器参数
            robotAnimator.ResetTrigger(listenNodTrigger);
            robotAnimator.ResetTrigger(afterUserNodTrigger);
            robotAnimator.ResetTrigger(talk1Trigger);
            robotAnimator.ResetTrigger(talk2Trigger);
            
            // 播放默认空状态动画
            robotAnimator.Play("Empty", 0, 0f);
            
            Debug.Log("[RobotAnimator] 动画已重置到默认状态");
        }
        
        // 重置节流计时器
        lastListenNodTime = -999f;
        lastTalkTime = -999f;
    }

    /// <summary>
    /// 触发倾听点头动画（用户开始说话时）
    /// </summary>
    public void TriggerListenNod()
    {
        if (Time.time - lastListenNodTime < listenNodCooldown) return;
        
        lastListenNodTime = Time.time;
        
        if (robotAnimator != null)
        {
            robotAnimator.SetTrigger(listenNodTrigger);
            Debug.Log($"[RobotAnimator] 触发倾听点头: {listenNodTrigger}");
        }
    }

    /// <summary>
    /// 触发回应点头动画（用户说完话后）
    /// </summary>
    public void TriggerAfterUserNod()
    {
        if (robotAnimator != null)
        {
            robotAnimator.SetTrigger(afterUserNodTrigger);
            Debug.Log($"[RobotAnimator] 触发回应点头: {afterUserNodTrigger}");
        }
    }

    /// <summary>
    /// 触发说话动画（AI开始说话时）
    /// </summary>
    public void TriggerTalk(string triggerName = null)
    {
        if (Time.time - lastTalkTime < talkGestureCooldown) return;
        
        lastTalkTime = Time.time;

        if (robotAnimator != null)
        {
            // 如果没有指定 trigger，随机选择 Talk1 或 Talk2
            string actualTrigger = string.IsNullOrEmpty(triggerName) 
                ? (random.Next(2) == 0 ? talk1Trigger : talk2Trigger)
                : triggerName;

            robotAnimator.SetTrigger(actualTrigger);
            Debug.Log($"[RobotAnimator] 触发说话动画: {actualTrigger}");
        }
    }

    /// <summary>
    /// 简单的 JSON 值提取（不依赖 Newtonsoft.Json）
    /// </summary>
    private string ExtractJsonValue(string json, string key)
    {
        string pattern = $"\"{key}\"\\s*:\\s*\"";
        int startIndex = json.IndexOf(pattern);
        if (startIndex < 0) 
        {
            // 尝试查找不带引号的值
            pattern = $"\"{key}\"\\s*:\\s*";
            startIndex = json.IndexOf(pattern);
            if (startIndex < 0) return "";
            
            startIndex += pattern.Length;
            int endIndex = json.IndexOfAny(new char[] { ',', '}', ' ' }, startIndex);
            if (endIndex < 0) endIndex = json.Length;
            
            string value = json.Substring(startIndex, endIndex - startIndex).Trim();
            return value;
        }
        
        startIndex += pattern.Length;
        int endQuoteIndex = json.IndexOf("\"", startIndex);
        if (endQuoteIndex < 0) return "";
        
        return json.Substring(startIndex, endQuoteIndex - startIndex);
    }
}
