using UnityEngine;
using System.Runtime.InteropServices;

/// <summary>
/// WebGL 桥接脚本 - 处理网页与 Unity 之间的通信
/// 将此脚本挂载到场景中的一个 GameObject 上（建议命名为 WebGLBridge）
/// </summary>
public class WebGLBridge : MonoBehaviour
{
    // 单例模式
    public static WebGLBridge Instance { get; private set; }
    
    // 是否在编辑器中模拟 WebGL 模式
    [Header("调试设置")]
    [Tooltip("在编辑器中模拟 WebGL 消息接收")]
    public bool simulateInEditor = true;
    
    // 季节管理器引用（需要在 Inspector 中设置）
    [Header("功能引用")]
    [Tooltip("季节切换管理器")]
    public SeasonManager seasonManager;
    
    [Tooltip("无人机控制器")]
    public DroneController droneController;
    
    [Tooltip("机器人动画控制器")]
    public RobotConversationAnimator robotAnimator;

    private void Awake()
    {
        // 单例模式设置
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
            Debug.Log("[WebGLBridge] 初始化完成");
        }
        else
        {
            Destroy(gameObject);
        }
    }

    private void Start()
    {
        // 自动查找引用（如果未设置）
        if (seasonManager == null)
            seasonManager = FindObjectOfType<SeasonManager>();
        if (droneController == null)
            droneController = FindObjectOfType<DroneController>();
        if (robotAnimator == null)
            robotAnimator = FindObjectOfType<RobotConversationAnimator>();
    }

    #region 接收来自网页的消息

    /// <summary>
    /// 接收来自网页的 JSON 消息
    /// 这是网页调用的入口函数
    /// </summary>
    public void OnMessageFromWeb(string jsonMessage)
    {
        Debug.Log("[WebGLBridge] 收到网页消息: " + jsonMessage);
        
        try
        {
            WebMessage message = JsonUtility.FromJson<WebMessage>(jsonMessage);
            
            switch (message.type)
            {
                case "changeSeason":
                    HandleChangeSeason(message);
                    break;
                    
                case "viewModel":
                    HandleViewModel(message);
                    break;
                    
                case "droneCommand":
                    HandleDroneCommand(message);
                    break;
                    
                case "robotTalkStart":
                    HandleRobotTalkStart(message);
                    break;
                    
                case "robotTalkEnd":
                    HandleRobotTalkEnd(message);
                    break;
                    
                case "robotListenNod":
                    HandleRobotListenNod(message);
                    break;
                    
                case "robotAfterUserNod":
                    HandleRobotAfterUserNod(message);
                    break;
                    
                case "hideRobot":
                    HandleHideRobot(message);
                    break;
                    
                case "showRobot":
                    HandleShowRobot(message);
                    break;
                    
                default:
                    Debug.LogWarning("[WebGLBridge] 未知消息类型: " + message.type);
                    break;
            }
        }
        catch (System.Exception e)
        {
            Debug.LogError("[WebGLBridge] 解析消息失败: " + e.Message);
        }
    }

    /// <summary>
    /// 网页就绪通知
    /// </summary>
    public void OnWebReady(string status)
    {
        Debug.Log("[WebGLBridge] 网页已就绪: " + status);
        // 可以在这里发送初始数据给网页
        SendToWeb("{\"type\":\"unityReady\",\"status\":\"ok\"}");
    }

    /// <summary>
    /// 浏览器窗口大小变化
    /// </summary>
    public void OnBrowserResize(string size)
    {
        Debug.Log("[WebGLBridge] 浏览器大小变化: " + size);
        // 格式: "width,height"
        string[] dimensions = size.Split(',');
        if (dimensions.Length == 2)
        {
            int width = int.Parse(dimensions[0]);
            int height = int.Parse(dimensions[1]);
            // 根据需要调整渲染分辨率等
        }
    }

    #endregion

    #region 消息处理函数

    private void HandleChangeSeason(WebMessage message)
    {
        string season = message.data?.season ?? message.season;
        Debug.Log("[WebGLBridge] 切换季节: " + season);
        
        if (seasonManager != null)
        {
            seasonManager.ChangeSeason(season);
        }
    }

    private void HandleViewModel(WebMessage message)
    {
        Debug.Log("[WebGLBridge] 查看模型");
        // 触发查看模型逻辑
    }

    private void HandleDroneCommand(WebMessage message)
    {
        string command = message.data?.command ?? message.command;
        Debug.Log("[WebGLBridge] 无人机指令: " + command);
        
        if (droneController != null)
        {
            switch (command)
            {
                case "takeoff":
                    droneController.TakeOff();
                    break;
                case "land":
                    droneController.Land();
                    break;
                case "move":
                    Vector3 direction = new Vector3(
                        message.data?.x ?? 0,
                        message.data?.y ?? 0,
                        message.data?.z ?? 0
                    );
                    droneController.Move(direction);
                    break;
            }
        }
    }

    private void HandleRobotTalkStart(WebMessage message)
    {
        string trigger = message.data?.trigger ?? message.trigger ?? "Talk1";
        Debug.Log("[WebGLBridge] 机器人开始说话: " + trigger);
        
        if (robotAnimator != null)
        {
            robotAnimator.SetTalking(true, trigger);
        }
    }

    private void HandleRobotTalkEnd(WebMessage message)
    {
        Debug.Log("[WebGLBridge] 机器人停止说话");
        
        if (robotAnimator != null)
        {
            robotAnimator.SetTalking(false);
        }
    }

    private void HandleRobotListenNod(WebMessage message)
    {
        Debug.Log("[WebGLBridge] 机器人倾听点头");
        
        if (robotAnimator != null)
        {
            robotAnimator.PlayNodAnimation("ListenNod");
        }
    }

    private void HandleRobotAfterUserNod(WebMessage message)
    {
        Debug.Log("[WebGLBridge] 机器人回应点头");
        
        if (robotAnimator != null)
        {
            robotAnimator.PlayNodAnimation("AfterUserNod");
        }
    }

    private void HandleHideRobot(WebMessage message)
    {
        Debug.Log("[WebGLBridge] 隐藏机器人");
        
        if (robotAnimator != null)
        {
            robotAnimator.HideRobot();
        }
    }

    private void HandleShowRobot(WebMessage message)
    {
        Debug.Log("[WebGLBridge] 显示机器人");
        
        if (robotAnimator != null)
        {
            robotAnimator.ShowRobot();
        }
    }

    #endregion

    #region 发送消息到网页

    /// <summary>
    /// 发送消息到网页
    /// </summary>
    public void SendToWeb(string message)
    {
        Debug.Log("[WebGLBridge] 发送到网页: " + message);
        
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendMessageToWeb(message);
        #else
        if (simulateInEditor)
        {
            Debug.Log("[WebGLBridge] 编辑器模式模拟发送: " + message);
        }
        #endif
    }

    /// <summary>
    /// 发送 JSON 对象到网页
    /// </summary>
    public void SendToWeb(object data)
    {
        string json = JsonUtility.ToJson(data);
        SendToWeb(json);
    }

    // JavaScript 插件接口
    #if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void SendMessageToWeb(string message);
    #endif

    #endregion

    #region 编辑器测试

    #if UNITY_EDITOR
    [ContextMenu("测试：切换春季")]
    private void TestChangeSpring()
    {
        OnMessageFromWeb("{\"type\":\"changeSeason\",\"season\":\"spring\"}");
    }

    [ContextMenu("测试：机器人说话")]
    private void TestRobotTalk()
    {
        OnMessageFromWeb("{\"type\":\"robotTalkStart\",\"trigger\":\"Talk1\"}");
    }
    #endif

    #endregion
}

/// <summary>
/// 消息数据结构
/// </summary>
[System.Serializable]
public class WebMessage
{
    public string type;
    public string time;
    public string from;
    
    // 通用数据字段
    public string season;
    public string command;
    public string trigger;
    public string status;
    
    // 复杂数据对象
    public WebMessageData data;
}

[System.Serializable]
public class WebMessageData
{
    public string season;
    public string command;
    public string trigger;
    public float x;
    public float y;
    public float z;
}
