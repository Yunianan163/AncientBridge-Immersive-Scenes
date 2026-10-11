using NativeWebSocket;
using UnityEngine;
using System;
using System.Collections;
using System.Text.RegularExpressions;

/// <summary>
/// WebSocket 客户端 - 与网页端通信并控制机器人
/// </summary>
public class WebSocketClient : MonoBehaviour
{
    private WebSocket webSocket;
    public static WebSocketClient Instance;

    [Header("连接配置")]
    [SerializeField] private string serverUrl = "ws://127.0.0.1:8082/ws";
    [SerializeField] private float reconnectDelay = 5f;
    [SerializeField] private float heartbeatInterval = 30f;

    [Header("季节管理器（自动查找）")]
    [SerializeField] private SeasonManager seasonManager;

    [Header("无人机控制器（自动查找）")]
    [SerializeField] private DroneController droneController;

    [Header("机器人控制器（自动查找）")]
    [SerializeField] private RobotController robotController;

    [Header("机器人出场控制")]
    [SerializeField] private GameObject robotRoot;
    [SerializeField] private Animator robotAnimator;
    [SerializeField] private string entranceStateName = "RobotJumpingDown";

    // ====== 新增：机器人对话动画控制器 ======
    [Header("机器人对话动画控制器")]
    [SerializeField] private RobotConversationAnimator robotConversationAnimator;
    // =========================================

    public bool isConnected = false;
    private bool isConnecting = false;
    private Coroutine heartbeatCoroutine;
    private Coroutine reconnectCoroutine;

    // 无人机锁定状态：默认锁定
    private bool isDroneLocked = true;
    public bool IsDroneLocked { get { return isDroneLocked; } }

    // 防循环保护：记录最后处理的季节和时间
    private string lastProcessedSeason = "";
    private float lastSeasonProcessTime = 0f;
    private const float SEASON_DEBOUNCE_TIME = 0.5f;

    [Serializable]
    public class OutgoingMessage
    {
        public string type;
        public string client;
        public string data;
        public string text;
        public string message;
        public string from;
        public string time;
    }

    [Serializable]
    public class IncomingMessage
    {
        public string type;
        public string cmd;
        public string data;
        public string text;
        public string message;
        public bool show;
        public string season;
        public string from;
        public string time;
        public string client;
        public bool droneUnlocked;
    }

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }

        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    void Start()
    {
        try
        {
            Debug.Log("[WebSocketClient] ========================================");
            Debug.Log("[WebSocketClient] WebSocketClient Start() 被调用！");
            Debug.Log("[WebSocketClient] 服务器地址: " + serverUrl);
            Debug.Log("[WebSocketClient] 游戏物体名称: " + gameObject.name);
            Debug.Log("[WebSocketClient] 平台: " + Application.platform);
            Debug.Log("[WebSocketClient] ========================================");
            
            RefreshTargets();
            LockDrone(false);
            StartConnection();

            // 初始隐藏机器人，等待视频播放后再出场
            if (robotRoot != null)
            {
                robotRoot.SetActive(false);
                Debug.Log("[WebSocketClient] 机器人已初始隐藏，等待视频播放后出场");
            }
        }
        catch (Exception ex)
        {
            Debug.LogError("[WebSocketClient] Start() 异常: " + ex.Message);
            Debug.LogError("[WebSocketClient] 堆栈: " + ex.StackTrace);
        }
    }

    void RefreshTargets()
    {
        // 使用 FindObjectOfType 兼容旧版本 Unity
        seasonManager = FindObjectOfType<SeasonManager>();
        droneController = FindObjectOfType<DroneController>();

        // 查找机器人控制器
        if (robotController == null)
        {
            GameObject robotObj = GameObject.Find("(新2) 机器人模型文件");
            if (robotObj != null)
            {
                robotController = robotObj.GetComponent<RobotController>();
                if (robotRoot == null) robotRoot = robotObj;
                if (robotAnimator == null) robotAnimator = robotObj.GetComponentInChildren<Animator>(true);
            }
        }

        // ====== 新增：查找 RobotConversationAnimator ======
        if (robotConversationAnimator == null)
        {
            GameObject robotEntranceManager = GameObject.Find("RobotEntranceManager");
            if (robotEntranceManager != null)
            {
                robotConversationAnimator = robotEntranceManager.GetComponent<RobotConversationAnimator>();
                Debug.Log("[WebSocketClient] 找到 RobotConversationAnimator: " + (robotConversationAnimator != null ? "成功" : "失败"));
            }
        }
        // ==================================================

        Debug.Log("[WebSocketClient] 找到 SeasonManager: " + (seasonManager != null ? seasonManager.name : "null"));
        Debug.Log("[WebSocketClient] 找到 DroneController: " + (droneController != null ? droneController.name : "null"));
        Debug.Log("[WebSocketClient] 找到 RobotController: " + (robotController != null ? robotController.name : "null"));
        Debug.Log("[WebSocketClient] 找到 Robot Animator: " + (robotAnimator != null ? robotAnimator.name : "null"));
        Debug.Log("[WebSocketClient] 找到 RobotConversationAnimator: " + (robotConversationAnimator != null ? "成功" : "null"));
    }

    string NormalizeSeasonKey(string season)
    {
        if (string.IsNullOrWhiteSpace(season))
            return "";

        string s = season.Trim().ToLower();

        switch (s)
        {
            case "spring":
            case "春":
            case "春天":
                return "spring";
            case "summer":
            case "夏":
            case "夏天":
                return "summer";
            case "autumn":
            case "fall":
            case "秋":
            case "秋天":
                return "autumn";
            case "winter":
            case "冬":
            case "冬天":
                return "winter";
            default:
                return "";
        }
    }

    // 提取 JSON 值的方法
    string ExtractJsonValue(string json, string key)
    {
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key))
            return "";

        string pattern = "\"" + key + "\"\\s*:\\s*\"(.*?)\"";
        Match match = Regex.Match(json, pattern);

        if (match.Success && match.Groups.Count > 1)
            return match.Groups[1].Value;

        return "";
    }

    // 提取 JSON 布尔值的方法
    bool ExtractJsonBool(string json, string key)
    {
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key))
            return false;

        string pattern = "\"" + key + "\"\\s*:\\s*(true|false)";
        Match match = Regex.Match(json, pattern, RegexOptions.IgnoreCase);

        if (match.Success && match.Groups.Count > 1)
            return string.Equals(match.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);

        return false;
    }

    public void StartConnection()
    {
        if (isConnected || isConnecting) return;

        if (reconnectCoroutine != null)
            StopCoroutine(reconnectCoroutine);

        reconnectCoroutine = StartCoroutine(ConnectionLoop());
    }

    IEnumerator ConnectionLoop()
    {
        Debug.Log("[WebSocketClient] ConnectionLoop() 开始");
        
        while (!isConnected)
        {
            isConnecting = true;
            Debug.Log("[WebSocketClient] 正在连接: " + serverUrl);

            yield return StartCoroutine(ConnectOnce());

            if (!isConnected)
            {
                Debug.Log("[WebSocketClient] " + reconnectDelay + " 秒后重试...");
                yield return new WaitForSeconds(reconnectDelay);
            }

            isConnecting = false;
        }

        Debug.Log("[WebSocketClient] ConnectionLoop() 结束，已连接");
        reconnectCoroutine = null;
    }

    IEnumerator ConnectOnce()
    {
        Debug.Log("[WebSocketClient] ConnectOnce() 开始执行");
        Debug.Log("[WebSocketClient] 创建 WebSocket 连接: " + serverUrl);
        
        try
        {
            webSocket = new WebSocket(serverUrl);
        }
        catch (Exception ex)
        {
            Debug.LogError("[WebSocketClient] 创建 WebSocket 失败: " + ex.Message);
            yield break;
        }

        if (webSocket == null)
        {
            Debug.LogError("[WebSocketClient] WebSocket 对象为空");
            yield break;
        }

        Debug.Log("[WebSocketClient] WebSocket 对象创建成功");

        bool openReceived = false;
        bool errorOccurred = false;

        webSocket.OnOpen += () =>
        {
            Debug.Log("[WebSocketClient] WebSocket 已连接!");
            isConnected = true;
            openReceived = true;
            isConnecting = false;

            SendJson(new OutgoingMessage
            {
                type = "register",
                client = "unity",
                from = "unity",
                time = DateTime.Now.ToString("o")
            });

            if (heartbeatCoroutine != null)
                StopCoroutine(heartbeatCoroutine);

            heartbeatCoroutine = StartCoroutine(HeartbeatLoop());
        };

        webSocket.OnMessage += (bytes) =>
        {
            string json = System.Text.Encoding.UTF8.GetString(bytes);
            Debug.Log("[WebSocket] 收到原始消息: " + json);

            // 在主线程处理消息
            UnityMainThreadDispatcher.Enqueue(() => {
                Debug.Log("[WebSocket] 开始处理消息在主线程");
                HandleMessageSafe(json);
            });
        };

        webSocket.OnError += (e) =>
        {
            Debug.LogError("[WebSocketClient] WebSocket 错误: " + e);
            errorOccurred = true;
            isConnected = false;
        };

        webSocket.OnClose += (e) =>
        {
            Debug.Log("[WebSocketClient] WebSocket 关闭: " + e);
            isConnected = false;
            isConnecting = false;

            if (heartbeatCoroutine != null)
            {
                StopCoroutine(heartbeatCoroutine);
                heartbeatCoroutine = null;
            }

            LockDrone(false);
        };

        Debug.Log("[WebSocketClient] 正在调用 webSocket.Connect()...");
        
        try
        {
            webSocket.Connect();
        }
        catch (Exception ex)
        {
            Debug.LogError("[WebSocketClient] Connect() 调用失败: " + ex.Message);
            errorOccurred = true;
        }

        Debug.Log("[WebSocketClient] 等待连接响应，超时时间: 5秒");
        
        float timeout = 5f;
        while (!openReceived && !errorOccurred && timeout > 0f)
        {
            yield return new WaitForSeconds(0.1f);
            timeout -= 0.1f;
        }

        if (openReceived)
        {
            Debug.Log("[WebSocketClient] 连接成功完成");
        }
        else if (errorOccurred)
        {
            Debug.LogWarning("[WebSocketClient] 连接过程中发生错误");
        }
        else
        {
            Debug.LogWarning("[WebSocketClient] 连接超时");
            if (webSocket != null)
                webSocket.Close();
        }
    }

    IEnumerator HeartbeatLoop()
    {
        while (isConnected)
        {
            yield return new WaitForSeconds(heartbeatInterval);

            if (isConnected)
            {
                SendJson(new OutgoingMessage
                {
                    type = "ping",
                    from = "unity",
                    time = DateTime.Now.ToString("o")
                });
            }
        }
    }

    IncomingMessage ParseIncomingMessage(string json)
    {
        IncomingMessage msg = null;

        try
        {
            msg = JsonUtility.FromJson<IncomingMessage>(json);
        }
        catch
        {
            msg = new IncomingMessage();
        }

        if (msg == null)
            msg = new IncomingMessage();

        if (string.IsNullOrEmpty(msg.type))
            msg.type = ExtractJsonValue(json, "type");

        if (string.IsNullOrEmpty(msg.cmd))
            msg.cmd = ExtractJsonValue(json, "cmd");

        if (string.IsNullOrEmpty(msg.data))
            msg.data = ExtractJsonValue(json, "data");

        if (string.IsNullOrEmpty(msg.text))
            msg.text = ExtractJsonValue(json, "text");

        if (string.IsNullOrEmpty(msg.message))
            msg.message = ExtractJsonValue(json, "message");

        if (string.IsNullOrEmpty(msg.season))
            msg.season = ExtractJsonValue(json, "season");

        if (string.IsNullOrEmpty(msg.from))
            msg.from = ExtractJsonValue(json, "from");

        if (!msg.droneUnlocked)
            msg.droneUnlocked = ExtractJsonBool(json, "droneUnlocked");

        if (string.IsNullOrEmpty(msg.data) && !string.IsNullOrEmpty(msg.season))
            msg.data = msg.season;

        if (string.IsNullOrEmpty(msg.type) && !string.IsNullOrEmpty(msg.cmd))
            msg.type = msg.cmd;

        return msg;
    }

    void HandleMessageSafe(string json)
    {
        Debug.Log("[WebSocketClient] HandleMessageSafe 被调用");
        
        // ====== 机器人对话动画控制 ======
        HandleRobotAnimation(json);
        // =================================
        
        IncomingMessage msg = ParseIncomingMessage(json);

        string type = msg.type;
        string data = msg.data;
        string text = msg.text;
        bool droneUnlocked = msg.droneUnlocked;

        Debug.Log("[WebSocketClient] 解析结果 -> type=" + type + ", data=" + data + ", from=" + msg.from + ", season=" + msg.season);
        
        if (string.IsNullOrEmpty(type))
        {
            Debug.LogWarning("[WebSocketClient] type 为空，原始 JSON: " + json);
            return;
        }

        // 心跳处理
        if (type == "ping")
        {
            SendJson(new OutgoingMessage
            {
                type = "pong",
                from = "unity",
                time = DateTime.Now.ToString("o")
            });
            return;
        }

        if (type == "pong")
        {
            return;
        }

        // 任务进度（无人机锁定）
        if (type == "missionProgress")
        {
            Debug.Log("[WebSocketClient] 收到任务进度 - droneUnlocked: " + droneUnlocked);

            if (droneUnlocked)
                UnlockDrone(false);
            else
                LockDrone(false);
            return;
        }

        // 季节切换（防循环）
        if (type == "season" || type == "seasonChanged" || type == "season_changed")
        {
            Debug.Log("[WebSocketClient] 收到季节消息，from=" + msg.from + ", data=" + data);
            
            if (msg.from == "unity")
            {
                Debug.Log("[WebSocketClient] 忽略自己发送的季节消息，防止循环");
                return;
            }

            if (string.IsNullOrEmpty(data))
            {
                Debug.LogWarning("[WebSocketClient] season 消息没有 data");
                return;
            }

            string normalized = NormalizeSeasonKey(data);
            Debug.Log("[WebSocketClient] 标准化季节: " + data + " -> " + normalized);
            
            if (string.IsNullOrEmpty(normalized))
            {
                Debug.Log("[WebSocketClient] 无法识别的季节值: " + data);
                return;
            }

            float now = Time.time;
            if (normalized == lastProcessedSeason && (now - lastSeasonProcessTime) < SEASON_DEBOUNCE_TIME)
            {
                Debug.Log("[WebSocketClient] 季节 " + normalized + " 在 " + SEASON_DEBOUNCE_TIME + " 秒内已处理过，忽略重复消息");
                return;
            }

            lastProcessedSeason = normalized;
            lastSeasonProcessTime = now;

            Debug.Log("[WebSocketClient] 准备调用季节切换: " + normalized);
            CallSeasonChange(normalized);
            return;
        }

        // ========== 机器人语音对话核心逻辑 ==========

        // 1. 对话就绪（视频播放完成后）
        // 注意：robotConversationReady 现在只用于通知，不触发入场动画
        // 入场动画只在收到 playRobotEntrance 消息时触发
        if (type == "robotConversationReady" || type == "startRobotConversation")
        {
            Debug.Log("[WebSocket] 收到对话就绪信号，仅作通知，不播放入场动画");
            // PlayRobotEntrance(); // 已移除：入场动画只在视频播放完成后触发
            return;
        }

        // 2. 用户开始说话（ASR识别中）
        if (type == "robotUserTextPartial" || type == "userSpeaking" || type == "robotUserSpeaking")
        {
            if (robotController != null)
                robotController.OnUserStartSpeaking("");
            else
                RefreshTargets();

            Debug.Log("用户实时内容: " + text);
            return;
        }

        // 3. 用户说完话（ASR识别结束）
        if (type == "robotUserTextFinal" || type == "userSpoke" || type == "robotUserStopped")
        {
            if (robotController != null)
                robotController.OnUserStopSpeaking("");
            else
                RefreshTargets();

            Debug.Log("用户最终内容: " + text);
            return;
        }

        // 4. 机器人开始回复
        if (type == "robotReplyStarted" || type == "robotStartSpeaking" || type == "robotSpeaking")
        {
            if (robotController != null)
                robotController.OnRobotStartSpeaking("");
            else
                RefreshTargets();

            Debug.Log("机器人开始回复");
            return;
        }

        // 5. 机器人回复结束
        if (type == "robotReplyEnded" || type == "robotStopSpeaking" || type == "robotTtsEnded" || type == "robotStopped")
        {
            if (robotController != null)
                robotController.OnRobotStopSpeaking("");
            else
                RefreshTargets();

            Debug.Log("机器人回复结束");
            return;
        }

        // 6. 机器人播放出场动画（视频结束后）
        if (type == "playRobotEntrance")
        {
            PlayRobotEntrance();
            return;
        }

        // 7. 隐藏机器人（关闭语音对话时）
        if (type == "hideRobot" || type == "closeRobot")
        {
            HideRobot();
            return;
        }

        // 8. 重置机器人动画状态（关闭语音对话时）
        if (type == "robotReset" || type == "resetRobotAnimation" || type == "resetRobot")
        {
            ResetRobotAnimation();
            return;
        }

        // 模型面板控制
        if (type == "viewModel" || type == "toggleModelPanel")
        {
            bool show = (type == "viewModel");

            if (msg.show)
            {
                show = true;
            }
            else if (!string.IsNullOrEmpty(data))
            {
                string lowerData = data.ToLower().Trim();

                if (lowerData == "true" || lowerData == "open" || lowerData == "1" || lowerData == "main")
                    show = true;
                else if (lowerData == "false" || lowerData == "close" || lowerData == "0")
                    show = false;
            }

            ModelViewerController panelController = FindObjectOfType<ModelViewerController>();

            if (panelController != null)
            {
                if (show)
                    panelController.OpenViewer();
                else
                    panelController.CloseViewer();

                Debug.Log("已" + (show ? "打开" : "关闭") + "模型面板");
            }
            else
            {
                Debug.LogError("没有找到 ModelViewerController，请确保场景中有挂载该脚本的物体");
            }

            return;
        }

        // 无人机控制
        if (type == "droneUnlock" || type == "unlockDrone" || type == "droneUnlocked")
        {
            UnlockDrone(false);
            return;
        }

        if (type == "drone")
        {
            string cmd = string.IsNullOrEmpty(msg.cmd) ? "" : msg.cmd.ToLower().Trim();
            string lowerData = string.IsNullOrEmpty(data) ? "" : data.ToLower().Trim();

            if (cmd == "unlock" || lowerData == "unlock" || lowerData == "true" || lowerData == "1")
            {
                UnlockDrone(false);
                return;
            }
        }

        Debug.Log("[WebSocketClient] 忽略未处理消息: " + type);
    }

    // ====== 新增：处理机器人动画消息 ======
    void HandleRobotAnimation(string json)
    {
        string type = ExtractJsonValue(json, "type");
        string from = ExtractJsonValue(json, "from");
        
        // 只处理来自 web 的消息
        if (from != "web") return;
        
        // 如果找到了 RobotConversationAnimator，使用它
        if (robotConversationAnimator != null)
        {
            // 通过反射调用方法，避免编译错误
            var method = robotConversationAnimator.GetType().GetMethod("OnWebMessage");
            if (method != null)
            {
                method.Invoke(robotConversationAnimator, new object[] { json });
                return;
            }
        }
        
        // 如果没有 RobotConversationAnimator 或没有 OnWebMessage 方法，直接处理
        switch (type)
        {
            case "robotListenNod":
                TriggerAnimator("ListenNod");
                Debug.Log("[RobotAnimation] 触发倾听点头");
                break;
                
            case "robotAfterUserNod":
                TriggerAnimator("AfterUserNod");
                Debug.Log("[RobotAnimation] 触发回应点头");
                break;
                
            case "robotTalkStart":
                string trigger = ExtractJsonValue(json, "trigger");
                if (string.IsNullOrEmpty(trigger))
                    trigger = UnityEngine.Random.value > 0.5f ? "Talk1" : "Talk2";
                TriggerAnimator(trigger);
                Debug.Log("[RobotAnimation] 触发说话动画: " + trigger);
                break;
                
            case "robotTalkEnd":
                Debug.Log("[RobotAnimation] AI 停止说话");
                break;
        }
    }
    
    void TriggerAnimator(string triggerName)
    {
        if (robotAnimator != null && !string.IsNullOrEmpty(triggerName))
        {
            robotAnimator.SetTrigger(triggerName);
        }
    }
    // =====================================

    void PlayRobotEntrance()
    {
        RefreshTargets();

        if (robotRoot != null && !robotRoot.activeSelf)
        {
            robotRoot.SetActive(true);
        }

        if (robotAnimator != null)
        {
            try
            {
                robotAnimator.Rebind();
                robotAnimator.Update(0f);

                if (!string.IsNullOrWhiteSpace(entranceStateName))
                {
                    robotAnimator.Play(entranceStateName, 0, 0f);
                }

                Debug.Log("已触发机器人出场动画");
                SendMessageToServer("robotEntranceStarted", "true");
                
                // 通知网页端机器人已出现，可以隐藏位置提示
                SendMessageToServer("robotAppeared", "true");
            }
            catch (Exception ex)
            {
                Debug.LogError("播放机器人出场动画失败: " + ex.Message);
            }
        }
        else
        {
            Debug.LogError("没有找到 Robot Animator，请在 Inspector 里拖拽 robotRoot 或 robotAnimator");
        }
    }

    void HideRobot()
    {
        RefreshTargets();

        if (robotRoot != null && robotRoot.activeSelf)
        {
            robotRoot.SetActive(false);
            Debug.Log("[WebSocketClient] 机器人已隐藏");
            SendMessageToServer("robotHidden", "true");
        }
        else
        {
            Debug.Log("[WebSocketClient] 机器人已经是隐藏状态");
        }
    }

    void ResetRobotAnimation()
    {
        RefreshTargets();
        
        // 重置 RobotController 状态
        if (robotController != null)
        {
            robotController.ResetState();
            Debug.Log("[WebSocketClient] RobotController 状态已重置");
        }
        
        // 重置 RobotConversationAnimator 动画
        if (robotConversationAnimator != null)
        {
            var method = robotConversationAnimator.GetType().GetMethod("ResetAnimation");
            if (method != null)
            {
                method.Invoke(robotConversationAnimator, null);
                Debug.Log("[WebSocketClient] RobotConversationAnimator 动画已重置");
            }
        }
        
        // 重置入场动画状态 - 确保下次可以从头播放
        if (robotAnimator != null)
        {
            // 停止当前动画并回到默认状态
            robotAnimator.Rebind();
            robotAnimator.Update(0f);
            
            // 播放默认空状态，确保入场动画下次能从头播放
            robotAnimator.Play("Empty", 0, 0f);
            
            Debug.Log("[WebSocketClient] 入场动画已重置");
        }
        
        // 先重置动画再隐藏，确保下次出场动画正常
        if (robotRoot != null && robotRoot.activeSelf)
        {
            // 稍微延迟隐藏，确保动画重置生效
            StartCoroutine(DelayedHideRobot());
        }
        
        SendMessageToServer("robotAnimationReset", "true");
    }

    System.Collections.IEnumerator DelayedHideRobot()
    {
        // 等待一帧确保动画重置生效
        yield return null;
        
        if (robotRoot != null)
        {
            robotRoot.SetActive(false);
            Debug.Log("[WebSocketClient] 机器人已延迟隐藏");
        }
    }

    void CallSeasonChange(string season)
    {
        if (string.IsNullOrWhiteSpace(season))
            return;

        string normalized = NormalizeSeasonKey(season);

        if (string.IsNullOrEmpty(normalized))
        {
            Debug.Log("[WebSocketClient] 无法识别的季节值: " + season);
            return;
        }

        Debug.Log("调用季节切换: " + normalized);

        if (seasonManager == null)
            RefreshTargets();

        if (seasonManager != null)
        {
            seasonManager.ChangeSeason(normalized);
            Debug.Log("已调用 SeasonManager.ChangeSeason(" + normalized + ")");

            SendJson(new OutgoingMessage
            {
                type = "seasonChanged",
                data = normalized,
                from = "unity",
                time = DateTime.Now.ToString("o")
            });
        }
        else
        {
            Debug.LogError("没有找到 SeasonManager");
        }
    }

    // 无人机锁定/解锁功能
    public void LockDrone()
    {
        LockDrone(false);
    }

    public void LockDrone(bool notifyWeb)
    {
        isDroneLocked = true;
        Debug.Log("无人机已锁定 - 请先完成网站上的交互任务");

        if (notifyWeb)
        {
            SendMessageToServer("droneLocked", "true");
        }
    }

    public void UnlockDrone()
    {
        UnlockDrone(false);
    }

    public void UnlockDrone(bool notifyWeb)
    {
        isDroneLocked = false;
        Debug.Log("无人机已解锁！可以开始探索了");

        if (notifyWeb)
        {
            SendMessageToServer("droneUnlocked", "true");
        }
    }

    public bool CheckDroneLocked()
    {
        return isDroneLocked;
    }

    // 发送消息方法
    public void SendJson(OutgoingMessage data)
    {
        if (!isConnected || webSocket == null) return;

        string json = JsonUtility.ToJson(data);
        webSocket.SendText(json);
        Debug.Log("发送: " + json);
    }

    public void SendRawMessage(string json)
    {
        if (!isConnected || webSocket == null)
        {
            Debug.LogWarning("WebSocket 未连接，无法发送消息");
            return;
        }

        webSocket.SendText(json);
        Debug.Log("发送原始消息: " + json);
    }

    public void SendMessageToServer(string type, string data)
    {
        SendJson(new OutgoingMessage
        {
            type = type,
            data = data,
            from = "unity",
            time = DateTime.Now.ToString("o")
        });
    }

    void Update()
    {
        // 所有平台都需要调用 DispatchMessageQueue 来处理 WebSocket 消息
        if (webSocket != null)
        {
            webSocket.DispatchMessageQueue();
        }

        if (!isConnected && !isConnecting && reconnectCoroutine == null)
        {
            Debug.Log("[WebSocketClient] 检测到断开，启动重连...");
            StartConnection();
        }
    }

    void OnDestroy()
    {
        if (heartbeatCoroutine != null)
            StopCoroutine(heartbeatCoroutine);

        if (reconnectCoroutine != null)
            StopCoroutine(reconnectCoroutine);

        if (webSocket != null)
        {
            webSocket.Close();
            webSocket = null;
        }
    }

    void OnApplicationQuit()
    {
        if (webSocket != null)
        {
            webSocket.Close();
            webSocket = null;
        }
    }
}
