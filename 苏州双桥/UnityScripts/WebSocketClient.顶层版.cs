using NativeWebSocket;
using UnityEngine;
using System;
using System.Collections;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

/// <summary>
/// WebSocket 客户端 - 与网页端通信
/// 端口统一：8082
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

    [Header("机器人出场控制")]
    [SerializeField] private GameObject robotRoot;
    [SerializeField] private Animator robotAnimator;
    [SerializeField] private string entranceStateName = "RobotJumpingDown";

    [Header("说话动画设置")]
    [SerializeField] private float talkAnimationInterval = 3f;
    [SerializeField] private string[] talkAnimationTriggers = new string[] { "Talk1", "Talk2" };
    [SerializeField] private bool useBoolParameters = false;
    [SerializeField] private string boolParameterName = "IsTalking";

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
        public float volume;
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

            if (robotAnimator == null)
            {
                Debug.LogError("[WebSocketClient] 严重错误：未能找到机器人 Animator！");
                Debug.LogError("[WebSocketClient] 请在 Inspector 中手动设置 robotRoot 或 robotAnimator 字段");
            }
            else
            {
                Debug.Log("[WebSocketClient] 机器人 Animator 已确认: " + robotAnimator.name);
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

        if (robotRoot == null || robotAnimator == null)
        {
            GameObject robotObj = GameObject.Find("(新2) 机器人模型文件");
            if (robotObj == null) robotObj = GameObject.FindWithTag("Robot");

            if (robotObj != null)
            {
                if (robotRoot == null) robotRoot = robotObj;
                if (robotAnimator == null)
                {
                    robotAnimator = robotObj.GetComponentInChildren<Animator>(true);
                    if (robotAnimator == null) robotAnimator = robotObj.GetComponent<Animator>();
                }
            }
        }

        Debug.Log("[WebSocketClient] 目标对象状态:");
        Debug.Log("  - Robot Animator: " + (robotAnimator != null ? robotAnimator.name : "null"));
    }

    string NormalizeSeasonKey(string season)
    {
        if (string.IsNullOrWhiteSpace(season)) return "";
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
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return "";
        string pattern = "\"" + key + "\"\\s*:\\s*\"(.*?)\"";
        Match match = Regex.Match(json, pattern);
        return match.Success && match.Groups.Count > 1 ? match.Groups[1].Value : "";
    }

    bool ExtractJsonBool(string json, string key)
    {
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return false;
        string pattern = "\"" + key + "\"\\s*:\\s*(true|false)";
        Match match = Regex.Match(json, pattern, RegexOptions.IgnoreCase);
        return match.Success && match.Groups.Count > 1 && string.Equals(match.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
    }

    float ExtractJsonFloat(string json, string key)
    {
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return 0f;
        string pattern = "\"" + key + "\"\\s*:\\s*([+-]?\\d*\\.?\\d+)";
        Match match = Regex.Match(json, pattern);
        if (match.Success && match.Groups.Count > 1 && float.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float result))
            return result;
        return 0f;
    }

    public void StartConnection()
    {
        if (isConnected || isConnecting) return;
        if (reconnectCoroutine != null) StopCoroutine(reconnectCoroutine);
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
        Exception createException = null;
        try { webSocket = new WebSocket(serverUrl); }
        catch (Exception ex) { createException = ex; }

        if (createException != null)
        {
            Debug.LogError("[WebSocketClient] 创建 WebSocket 失败: " + createException.Message);
            yield break;
        }
        if (webSocket == null)
        {
            Debug.LogError("[WebSocketClient] WebSocket 对象为空");
            yield break;
        }

        bool openReceived = false;
        bool errorOccurred = false;

        webSocket.OnOpen += () =>
        {
            Debug.Log("[WebSocketClient] WebSocket 已连接!");
            isConnected = true;
            openReceived = true;
            isConnecting = false;
            SendJson(new OutgoingMessage { type = "register", client = "unity", from = "unity", time = DateTime.Now.ToString("o") });
            if (heartbeatCoroutine != null) StopCoroutine(heartbeatCoroutine);
            heartbeatCoroutine = StartCoroutine(HeartbeatLoop());
        };

        webSocket.OnMessage += (bytes) =>
        {
            string json = System.Text.Encoding.UTF8.GetString(bytes);
            UnityMainThreadDispatcher.Enqueue(() => HandleMessageSafe(json));
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
            if (heartbeatCoroutine != null) { StopCoroutine(heartbeatCoroutine); heartbeatCoroutine = null; }
            LockDrone(false);
        };

        Task connectTask = null;
        Exception connectException = null;
        try { connectTask = webSocket.Connect(); }
        catch (Exception ex) { connectException = ex; }

        if (connectException != null)
        {
            Debug.LogError("[WebSocketClient] Connect() 调用失败: " + connectException.Message);
            errorOccurred = true;
        }

        if (connectException == null && connectTask != null)
        {
            float timeout = 5f;
            while (!connectTask.IsCompleted && timeout > 0f)
            {
                yield return new WaitForSeconds(0.1f);
                timeout -= 0.1f;
            }
            if (connectTask.IsFaulted)
            {
                Debug.LogError("[WebSocketClient] 连接任务失败: " + connectTask.Exception);
                errorOccurred = true;
            }
        }

        float eventTimeout = 5f;
        while (!openReceived && !errorOccurred && eventTimeout > 0f)
        {
            yield return new WaitForSeconds(0.1f);
            eventTimeout -= 0.1f;
        }

        if (openReceived) Debug.Log("[WebSocketClient] 连接成功完成");
        else if (errorOccurred) Debug.LogWarning("[WebSocketClient] 连接过程中发生错误");
        else
        {
            Debug.LogWarning("[WebSocketClient] 连接超时");
            if (webSocket != null) webSocket.Close();
        }
    }

    IEnumerator HeartbeatLoop()
    {
        while (isConnected)
        {
            yield return new WaitForSeconds(heartbeatInterval);
            if (isConnected) SendJson(new OutgoingMessage { type = "ping", from = "unity", time = DateTime.Now.ToString("o") });
        }
    }

    IncomingMessage ParseIncomingMessage(string json)
    {
        IncomingMessage msg = null;
        try { msg = JsonUtility.FromJson<IncomingMessage>(json); } catch { msg = new IncomingMessage(); }
        if (msg == null) msg = new IncomingMessage();

        if (string.IsNullOrEmpty(msg.type)) msg.type = ExtractJsonValue(json, "type");
        if (string.IsNullOrEmpty(msg.cmd)) msg.cmd = ExtractJsonValue(json, "cmd");
        if (string.IsNullOrEmpty(msg.data)) msg.data = ExtractJsonValue(json, "data");
        if (string.IsNullOrEmpty(msg.text)) msg.text = ExtractJsonValue(json, "text");
        if (string.IsNullOrEmpty(msg.message)) msg.message = ExtractJsonValue(json, "message");
        if (string.IsNullOrEmpty(msg.season)) msg.season = ExtractJsonValue(json, "season");
        if (string.IsNullOrEmpty(msg.from)) msg.from = ExtractJsonValue(json, "from");
        if (!msg.droneUnlocked) msg.droneUnlocked = ExtractJsonBool(json, "droneUnlocked");
        if (msg.volume == 0f) msg.volume = ExtractJsonFloat(json, "volume");
        if (string.IsNullOrEmpty(msg.data) && !string.IsNullOrEmpty(msg.season)) msg.data = msg.season;
        if (string.IsNullOrEmpty(msg.type) && !string.IsNullOrEmpty(msg.cmd)) msg.type = msg.cmd;

        return msg;
    }

    void HandleMessageSafe(string json)
    {
        Debug.Log("[WebSocketClient] HandleMessageSafe 被调用");
        IncomingMessage msg = ParseIncomingMessage(json);
        string type = msg.type;
        string data = msg.data;
        bool droneUnlocked = msg.droneUnlocked;

        Debug.Log("[WebSocketClient] 解析结果 -> type=" + type + ", data=" + data + ", from=" + msg.from);
        if (string.IsNullOrEmpty(type)) return;

        if (type == "ping")
        {
            SendJson(new OutgoingMessage { type = "pong", from = "unity", time = DateTime.Now.ToString("o") });
            return;
        }
        if (type == "pong") return;

        if (type == "missionProgress")
        {
            if (droneUnlocked) UnlockDrone(false);
            else LockDrone(false);
            return;
        }

        if (type == "season" || type == "seasonChanged" || type == "season_changed")
        {
            if (msg.from == "unity") return;
            if (string.IsNullOrEmpty(data)) return;
            string normalized = NormalizeSeasonKey(data);
            if (string.IsNullOrEmpty(normalized)) return;
            float now = Time.time;
            if (normalized == lastProcessedSeason && (now - lastSeasonProcessTime) < SEASON_DEBOUNCE_TIME) return;
            lastProcessedSeason = normalized;
            lastSeasonProcessTime = now;
            CallSeasonChange(normalized);
            return;
        }

        if (type == "playRobotEntrance")
        {
            PlayRobotEntrance();
            return;
        }

        if (type == "hideRobot" || type == "closeRobot")
        {
            HideRobot();
            return;
        }

        if (type == "robotReset" || type == "resetRobotAnimation" || type == "resetRobot")
        {
            ResetRobotAnimation();
            return;
        }

        if (type == "viewModel" || type == "toggleModelPanel")
        {
            bool show = msg.show || data?.ToLower() == "true" || data == "open" || data == "1";
            ModelViewerController panelController = FindObjectOfType<ModelViewerController>();
            if (panelController != null)
            {
                if (show) panelController.OpenViewer();
                else panelController.CloseViewer();
            }
            return;
        }

        if (type == "droneUnlock" || type == "unlockDrone" || type == "droneUnlocked")
        {
            UnlockDrone(false);
            return;
        }

        if (type == "droneVolume")
        {
            if (droneController == null) RefreshTargets();
            if (droneController != null)
            {
                droneController.SetVolume(msg.volume);
                Debug.Log("[WebSocketClient] 设置无人机音量: " + msg.volume);
            }
            else
            {
                Debug.LogWarning("[WebSocketClient] 收到 droneVolume 消息但找不到 DroneController");
            }
            return;
        }

        // ========== 机器人语音对话动画 ==========
        if (type == "robotUserTextPartial" || type == "userSpeaking" || type == "robotUserSpeaking")
        {
            TriggerAnimator("ListenNod");
            Debug.Log("[RobotAnimation] 触发倾听点头动画 ListenNod");
            return;
        }

        if (type == "robotUserTextFinal" || type == "userSpoke" || type == "robotUserStopped")
        {
            TriggerAnimator("AfterUserNod");
            Debug.Log("[RobotAnimation] 触发回应点头动画 AfterUserNod");
            return;
        }

        if (type == "robotReplyStarted" || type == "robotStartSpeaking" ||
            type == "robotSpeaking" || type == "robotTalkStart")
        {
            Debug.Log("[RobotAnimation] 机器人开始说话 -> 触发Talk动画");
            StartTalkingAnimation();
            return;
        }

        if (type == "robotReplyEnded" || type == "robotStopSpeaking" ||
            type == "robotTtsEnded" || type == "robotStopped" || type == "robotTalkEnd")
        {
            Debug.Log("[RobotAnimation] 机器人停止说话 -> 停止动画");
            StopTalkingAnimation();
            return;
        }

        Debug.Log("[WebSocketClient] 忽略未处理消息: " + type);
    }

    void PlayRobotEntrance()
    {
        RefreshTargets();
        if (robotRoot != null && !robotRoot.activeSelf) robotRoot.SetActive(true);
        if (robotAnimator != null)
        {
            try
            {
                robotAnimator.Rebind();
                robotAnimator.Update(0f);
                if (!string.IsNullOrWhiteSpace(entranceStateName)) robotAnimator.Play(entranceStateName, 0, 0f);
                SendMessageToServer("robotEntranceStarted", "true");
                SendMessageToServer("robotAppeared", "true");
            }
            catch (Exception ex) { Debug.LogError("播放机器人出场动画失败: " + ex.Message); }
        }
    }

    void HideRobot()
    {
        RefreshTargets();
        if (robotRoot != null && robotRoot.activeSelf)
        {
            robotRoot.SetActive(false);
            SendMessageToServer("robotHidden", "true");
        }
    }

    void ResetRobotAnimation()
    {
        RefreshTargets();
        if (robotAnimator != null)
        {
            robotAnimator.Rebind();
            robotAnimator.Update(0f);
            robotAnimator.Play("Empty", 0, 0f);
        }
        if (robotRoot != null && robotRoot.activeSelf) StartCoroutine(DelayedHideRobot());
        SendMessageToServer("robotAnimationReset", "true");
    }

    IEnumerator DelayedHideRobot()
    {
        yield return null;
        if (robotRoot != null) robotRoot.SetActive(false);
    }

    void CallSeasonChange(string season)
    {
        if (string.IsNullOrWhiteSpace(season)) return;
        string normalized = NormalizeSeasonKey(season);
        if (string.IsNullOrEmpty(normalized)) return;
        if (seasonManager == null) RefreshTargets();
        if (seasonManager != null)
        {
            seasonManager.ChangeSeason(normalized);
            SendJson(new OutgoingMessage { type = "seasonChanged", data = normalized, from = "unity", time = DateTime.Now.ToString("o") });
        }
    }

    public void LockDrone(bool notifyWeb)
    {
        isDroneLocked = true;
        if (notifyWeb) SendMessageToServer("droneLocked", "true");
    }

    public void UnlockDrone(bool notifyWeb)
    {
        isDroneLocked = false;
        if (notifyWeb) SendMessageToServer("droneUnlocked", "true");
    }

    public bool CheckDroneLocked() { return isDroneLocked; }

    public void SendJson(OutgoingMessage data)
    {
        if (!isConnected || webSocket == null) return;
        string json = JsonUtility.ToJson(data);
        webSocket.SendText(json);
        Debug.Log("发送: " + json);
    }

    public void SendRawMessage(string json)
    {
        if (!isConnected || webSocket == null) return;
        webSocket.SendText(json);
        Debug.Log("发送原始消息: " + json);
    }

    public void SendMessageToServer(string type, string data)
    {
        SendJson(new OutgoingMessage { type = type, data = data, from = "unity", time = DateTime.Now.ToString("o") });
    }

    void Update()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        if (webSocket != null) webSocket.DispatchMessageQueue();
#endif
        if (!isConnected && !isConnecting && reconnectCoroutine == null) StartConnection();
    }

    #region 语音对话动画控制

    void StartTalkingAnimation()
    {
        Debug.Log("[RobotAnimation] StartTalkingAnimation() 被调用");

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

        StopTalkingAnimation();

        isRobotTalking = true;
        PlayTalkAnimationImmediate();

        talkingAnimationCoroutine = StartCoroutine(TalkingAnimationLoop());
        Debug.Log("[RobotAnimation] 开始说话动画循环，间隔: " + talkAnimationInterval + "秒");
    }

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

        if (useBoolParameters)
        {
            robotAnimator.SetBool(boolParameterName, false);
            Debug.Log("[RobotAnimation] 设置 Bool 参数 " + boolParameterName + " = false");
        }

        if (talkAnimationTriggers != null)
        {
            foreach (var trigger in talkAnimationTriggers)
            {
                if (!string.IsNullOrEmpty(trigger))
                    robotAnimator.ResetTrigger(trigger);
            }
        }

        robotAnimator.ResetTrigger("AfterUse");
        Debug.Log("[RobotAnimation] 动画已重置");
    }

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
            PlayTalkAnimationImmediate();
        }
    }

    void PlayTalkAnimationImmediate()
    {
        if (robotAnimator == null || talkAnimationTriggers == null || talkAnimationTriggers.Length == 0) return;

        string triggerName = talkAnimationTriggers[currentTalkIndex % talkAnimationTriggers.Length];
        currentTalkIndex++;

        Debug.Log("[RobotAnimation] 准备播放动画: " + triggerName + " (使用Bool模式: " + useBoolParameters + ")");

        if (useBoolParameters)
        {
            robotAnimator.SetBool(boolParameterName, false);
            robotAnimator.Update(0);
            robotAnimator.SetBool(boolParameterName, true);
            Debug.Log("[RobotAnimation] 设置 Bool " + boolParameterName + " = true");
        }
        else
        {
            foreach (var t in talkAnimationTriggers)
            {
                if (!string.IsNullOrEmpty(t))
                    robotAnimator.ResetTrigger(t);
            }

            robotAnimator.Update(0);
            robotAnimator.SetTrigger(triggerName);
            Debug.Log("[RobotAnimation] 触发 Trigger: " + triggerName);
        }
    }

    void TriggerAnimator(string triggerName)
    {
        if (robotAnimator == null)
        {
            RefreshTargets();
        }

        if (robotAnimator != null && !string.IsNullOrEmpty(triggerName))
        {
            robotAnimator.SetTrigger(triggerName);
            Debug.Log("[RobotAnimation] 触发: " + triggerName);
        }
    }

    #endregion

    void OnDestroy()
    {
        if (talkingAnimationCoroutine != null) StopCoroutine(talkingAnimationCoroutine);
        if (heartbeatCoroutine != null) StopCoroutine(heartbeatCoroutine);
        if (reconnectCoroutine != null) StopCoroutine(reconnectCoroutine);
        if (webSocket != null) { webSocket.Close(); webSocket = null; }
    }
}
