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

    [Header("机器人对话动画控制器")]
    [SerializeField] private RobotConversationAnimator robotConversationAnimator;

    [Header("说话动画设置")]
    [SerializeField] private float talkAnimationInterval = 3f;
    [SerializeField] private string[] talkAnimationTriggers = new string[] { "Talk1", "Talk2" };
    [SerializeField] private bool useBoolParameters = false; // 如果Trigger无效，设为true使用Bool参数
    [SerializeField] private string boolParameterName = "IsTalking"; // Bool参数名（如果使用Bool模式）

    private Coroutine talkingAnimationCoroutine;
    private bool isRobotTalking = false;
    private int currentTalkIndex = 0;

    public bool isConnected = false;
    private bool isConnecting = false;
    private Coroutine heartbeatCoroutine;
    private Coroutine reconnectCoroutine;

    private bool isDroneLocked = true;
    public bool IsDroneLocked { get { return isDroneLocked; } }

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

            // 确保机器人动画组件已找到
            if (robotAnimator == null)
            {
                Debug.LogError("[WebSocketClient] 严重错误：未能找到机器人 Animator！");
                Debug.LogError("[WebSocketClient] 请在 Inspector 中手动设置 robotRoot 或 robotAnimator 字段");
            }
            else
            {
                Debug.Log("[WebSocketClient] 机器人 Animator 已确认: " + robotAnimator.name);
                ValidateAnimatorController();
            }

            LockDrone(false);
            StartConnection();

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
        if (seasonManager == null)
            seasonManager = FindObjectOfType<SeasonManager>();

        if (droneController == null)
            droneController = FindObjectOfType<DroneController>();

        // 查找机器人控制器
        if (robotController == null || robotRoot == null || robotAnimator == null)
        {
            GameObject robotObj = GameObject.Find("(新2) 机器人模型文件");

            if (robotObj == null)
            {
                robotObj = GameObject.FindWithTag("Robot");
            }

            if (robotObj == null && robotController != null)
            {
                robotObj = robotController.gameObject;
            }

            if (robotObj != null)
            {
                if (robotController == null)
                    robotController = robotObj.GetComponent<RobotController>();

                if (robotRoot == null)
                    robotRoot = robotObj;

                if (robotAnimator == null)
                {
                    // 优先获取子对象上的 Animator
                    robotAnimator = robotObj.GetComponentInChildren<Animator>(true);

                    if (robotAnimator == null)
                        robotAnimator = robotObj.GetComponent<Animator>();
                }
            }
        }

        if (robotConversationAnimator == null)
        {
            GameObject robotEntranceManager = GameObject.Find("RobotEntranceManager");
            if (robotEntranceManager != null)
            {
                robotConversationAnimator = robotEntranceManager.GetComponent<RobotConversationAnimator>();
            }
        }

        Debug.Log("[WebSocketClient] 目标对象状态:");
        Debug.Log("  - Robot Animator: " + (robotAnimator != null ? robotAnimator.name + " (Controller: " + (robotAnimator.runtimeAnimatorController != null ? robotAnimator.runtimeAnimatorController.name : "null") + ")" : "null"));
    }

    // 验证Animator Controller设置
    void ValidateAnimatorController()
    {
        if (robotAnimator == null || robotAnimator.runtimeAnimatorController == null)
        {
            Debug.LogError("[AnimatorValidation] Animator 或 Controller 为 null！");
            return;
        }

        Debug.Log("[AnimatorValidation] === 检查 Animator Controller 参数 ===");
        Debug.Log("[AnimatorValidation] Controller名称: " + robotAnimator.runtimeAnimatorController.name);

        var parameters = robotAnimator.parameters;

        bool hasTalk1 = false;
        bool hasTalk2 = false;
        bool hasIsTalking = false;

        foreach (var param in parameters)
        {
            string typeStr = param.type.ToString();
            Debug.Log($"  - {param.name} (类型: {typeStr})");

            if (param.name == "Talk1") hasTalk1 = true;
            if (param.name == "Talk2") hasTalk2 = true;
            if (param.name == boolParameterName) hasIsTalking = true;
        }

        if (!hasTalk1) Debug.LogError("[AnimatorValidation] 缺少参数: Talk1 (Trigger)");
        if (!hasTalk2) Debug.LogError("[AnimatorValidation] 缺少参数: Talk2 (Trigger)");
        if (useBoolParameters && !hasIsTalking) Debug.LogError("[AnimatorValidation] 缺少参数: " + boolParameterName + " (Bool)");

        Debug.Log("[AnimatorValidation] ==================================");
    }

    string NormalizeSeasonKey(string season)
    {
        if (string.IsNullOrWhiteSpace(season))
            return "";

        string s = season.Trim().ToLower();

        switch (s)
        {
            case "spring": case "春": case "春天": return "spring";
            case "summer": case "夏": case "夏天": return "summer";
            case "autumn": case "fall": case "秋": case "秋天": return "autumn";
            case "winter": case "冬": case "冬天": return "winter";
            default: return "";
        }
    }

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

        HandleRobotAnimation(json);

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

        // 1. 对话就绪
        if (type == "robotConversationReady" || type == "startRobotConversation")
        {
            Debug.Log("[WebSocket] 收到对话就绪信号，仅作通知，不播放入场动画");
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

        // 4. 机器人开始回复 - 关键逻辑：触发说话动画（循环Talk1/Talk2）
        // 【关键修改】添加了 robotTalkStart 类型，匹配截图中的实际消息类型
        if (type == "robotReplyStarted" || type == "robotStartSpeaking" ||
            type == "robotSpeaking" || type == "robotTalkStart")
        {
            Debug.Log("[RobotAnimation] 收到机器人开始说话消息，类型: " + type);

            if (robotController != null)
                robotController.OnRobotStartSpeaking("");
            else
                RefreshTargets();

            // 启动说话动画（循环播放Talk1/Talk2）
            StartTalkingAnimation();

            Debug.Log("机器人开始回复");
            return;
        }

        // 5. 机器人回复结束 - 关键逻辑：停止说话动画
        // 【关键修改】添加了 robotTalkEnd 类型，匹配截图中的实际消息类型
        if (type == "robotReplyEnded" || type == "robotStopSpeaking" ||
            type == "robotTtsEnded" || type == "robotStopped" ||
            type == "robotTalkEnd")
        {
            Debug.Log("[RobotAnimation] 收到机器人停止说话消息，类型: " + type);

            if (robotController != null)
                robotController.OnRobotStopSpeaking("");
            else
                RefreshTargets();

            // 停止说话动画
            StopTalkingAnimation();

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

    // ====== 说话动画控制方法（修复版）======

    /// <summary>
    /// 开始说话动画循环 - AI说话期间持续播放手势动画（Talk1/Talk2交替）
    /// </summary>
    void StartTalkingAnimation()
    {
        Debug.Log("[RobotAnimation] StartTalkingAnimation() 被调用");

        // 如果 Animator 为空，尝试重新获取
        if (robotAnimator == null)
        {
            Debug.LogWarning("[RobotAnimation] robotAnimator 为空，尝试重新获取...");
            RefreshTargets();

            if (robotAnimator == null)
            {
                Debug.LogError("[RobotAnimation] 无法获取 robotAnimator，说话动画无法播放！");
                return;
            }
        }

        // 停止之前的动画协程（如果有）
        StopTalkingAnimation();

        isRobotTalking = true;

        // 立即播放第一个动画
        PlayTalkAnimationImmediate();

        // 启动循环协程（每隔talkAnimationInterval秒切换一次手势）
        talkingAnimationCoroutine = StartCoroutine(TalkingAnimationLoop());
        Debug.Log("[RobotAnimation] 开始说话动画循环，间隔: " + talkAnimationInterval + "秒");
    }

    /// <summary>
    /// 立即停止当前说话动画并回到空闲状态
    /// </summary>
    void StopTalkingAnimation()
    {
        Debug.Log("[RobotAnimation] StopTalkingAnimation() 被调用");
        isRobotTalking = false;

        if (talkingAnimationCoroutine != null)
        {
            StopCoroutine(talkingAnimationCoroutine);
            talkingAnimationCoroutine = null;
        }

        if (robotAnimator == null)
        {
            Debug.LogWarning("[RobotAnimation] 无法重置动画，robotAnimator 为 null");
            return;
        }

        // 如果使用Bool参数，设置为false
        if (useBoolParameters)
        {
            robotAnimator.SetBool(boolParameterName, false);
            Debug.Log("[RobotAnimation] 设置 Bool 参数 " + boolParameterName + " = false");
        }

        // 重置所有Trigger，避免堆积
        if (talkAnimationTriggers != null)
        {
            foreach (var trigger in talkAnimationTriggers)
            {
                if (!string.IsNullOrEmpty(trigger))
                {
                    robotAnimator.ResetTrigger(trigger);
                }
            }
        }

        // 重置AfterUse（如果存在）
        robotAnimator.ResetTrigger("AfterUse");

        Debug.Log("[RobotAnimation] 动画已重置");
    }

    /// <summary>
    /// 说话动画循环 - 每隔一段时间切换手势（Talk1/Talk2交替）
    /// </summary>
    IEnumerator TalkingAnimationLoop()
    {
        while (isRobotTalking)
        {
            yield return new WaitForSeconds(talkAnimationInterval);

            if (!isRobotTalking)
            {
                Debug.Log("[RobotAnimation] 说话状态已停止，退出动画循环");
                yield break;
            }

            // 播放下一个动画
            PlayTalkAnimationImmediate();
        }
    }

    /// <summary>
    /// 立即播放一次说话动画（强制模式）
    /// </summary>
    void PlayTalkAnimationImmediate()
    {
        if (robotAnimator == null)
        {
            Debug.LogWarning("[RobotAnimation] Animator 为空，无法播放动画");
            return;
        }

        if (talkAnimationTriggers == null || talkAnimationTriggers.Length == 0)
        {
            Debug.LogWarning("[RobotAnimation] talkAnimationTriggers 数组为空");
            return;
        }

        // 轮询选择触发器（避免随机，方便调试）
        string triggerName = talkAnimationTriggers[currentTalkIndex % talkAnimationTriggers.Length];
        currentTalkIndex++;

        Debug.Log("[RobotAnimation] 准备播放动画: " + triggerName + " (使用Bool模式: " + useBoolParameters + ")");

        if (useBoolParameters)
        {
            // 使用Bool参数模式（更可靠，但需要修改Animator Controller）
            // 先设置false再设置true，确保触发过渡
            robotAnimator.SetBool(boolParameterName, false);
            robotAnimator.Update(0); // 强制刷新
            robotAnimator.SetBool(boolParameterName, true);
            Debug.Log("[RobotAnimation] 设置 Bool " + boolParameterName + " = true");
        }
        else
        {
            // 使用Trigger模式（标准方式）
            // 先重置所有相关触发器，避免冲突
            foreach (var t in talkAnimationTriggers)
            {
                if (!string.IsNullOrEmpty(t))
                    robotAnimator.ResetTrigger(t);
            }

            // 强制刷新Animator状态
            robotAnimator.Update(0);

            // 设置触发器
            robotAnimator.SetTrigger(triggerName);
            Debug.Log("[RobotAnimation] 触发 Trigger: " + triggerName);
        }
    }

    // ====== 处理机器人动画消息 ======
    void HandleRobotAnimation(string json)
    {
        string type = ExtractJsonValue(json, "type");
        string from = ExtractJsonValue(json, "from");

        // 只处理来自 web 的消息
        if (from != "web") return;

        // 如果找到了 RobotConversationAnimator，使用它
        if (robotConversationAnimator != null)
        {
            var method = robotConversationAnimator.GetType().GetMethod("OnWebMessage");
            if (method != null)
            {
                method.Invoke(robotConversationAnimator, new object[] { json });
                return;
            }
        }

        // 直接处理
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
                Debug.Log("[RobotAnimation] 收到 robotTalkStart，由主逻辑处理");
                break;

            case "robotTalkEnd":
                StopTalkingAnimation();
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
        
        // 重置说话动画状态
        isRobotTalking = false;
        StopTalkingAnimation();
        
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
        // 停止所有协程
        if (talkingAnimationCoroutine != null)
            StopCoroutine(talkingAnimationCoroutine);

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

    // ====== 调试用公共方法（在Inspector中右键脚本组件可见）======
    [ContextMenu("测试说话动画")]
    public void TestTalkingAnimation()
    {
        Debug.Log("[Debug] 手动测试说话动画...");
        StartTalkingAnimation();

        // 10秒后自动停止
        Invoke("TestStopTalking", 10f);
    }

    [ContextMenu("测试停止说话")]
    public void TestStopTalking()
    {
        Debug.Log("[Debug] 手动停止说话动画...");
        StopTalkingAnimation();
    }

    [ContextMenu("检查Animator参数")]
    public void DebugCheckAnimator()
    {
        ValidateAnimatorController();
    }

    [ContextMenu("强制播放Talk1")]
    public void DebugPlayTalk1()
    {
        if (robotAnimator != null)
        {
            robotAnimator.ResetTrigger("Talk1");
            robotAnimator.SetTrigger("Talk1");
            Debug.Log("已强制触发 Talk1");
        }
        else
        {
            Debug.LogError("robotAnimator 为 null");
        }
    }
}