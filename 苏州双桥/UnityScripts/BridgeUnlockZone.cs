using UnityEngine;

[DisallowMultipleComponent]
[RequireComponent(typeof(BoxCollider))]
public class BridgeUnlockZone : MonoBehaviour
{
    [Header("触发设置")]
    [Tooltip("只有无人机进入/靠近时才触发")]
    [SerializeField] private bool onlyDroneCanTrigger = true;

    [Tooltip("无人机根节点。建议直接拖 DroneRoot")]
    [SerializeField] private Transform droneRoot;

    [Tooltip("无人机标签")]
    [SerializeField] private string droneTag = "Drone";

    [Header("检测方式")]
    [Tooltip("是否启用 Unity Trigger 事件")]
    [SerializeField] private bool useTriggerCallbacks = true;

    [Tooltip("是否启用 Bounds 轮询兜底")]
    [SerializeField] private bool useBoundsPolling = true;

    [Tooltip("轮询间隔（秒）")]
    [SerializeField] private float pollInterval = 0.1f;

    [Header("触发冷却")]
    [SerializeField] private float triggerCooldown = 2f;

    [Header("自动重置")]
    [Tooltip("当任务重新锁回去时，自动重置本触发区，便于下一轮重新触发")]
    [SerializeField] private bool resetWhenDroneLockedAgain = true;

    [Header("调试")]
    [SerializeField] private bool debugMode = true;

    private BoxCollider zoneCollider;
    private WebSocketClient wsClient;

    private float lastTriggerTime = -999f;
    private float nextPollTime = 0f;

    private bool unlockTriggered = false;
    private bool unlockMessageSent = false;
    private bool pendingSend = false;
    private bool lastKnownDroneLocked = true;

    private const string BridgeUnlockedMessage = "无人机已到达桥旁";

    private void Awake()
    {
        zoneCollider = GetComponent<BoxCollider>();
        EnsureZoneColliderValid();
        FindWebSocketClient();
        TryFindDroneRoot();
    }

    private void Start()
    {
        SyncDroneLockState();
        Log($"Start -> zone center={zoneCollider.center}, size={zoneCollider.size}, worldPos={transform.position}");
    }

    private void Update()
    {
        if (wsClient == null || (!wsClient.isConnected && Time.frameCount % 60 == 0))
        {
            FindWebSocketClient();
        }

        if (droneRoot == null && Time.frameCount % 60 == 0)
        {
            TryFindDroneRoot();
        }

        if (resetWhenDroneLockedAgain)
        {
            TryAutoResetByMissionState();
        }

        if (!unlockTriggered && useBoundsPolling && Time.time >= nextPollTime)
        {
            nextPollTime = Time.time + pollInterval;
            PollDronePosition();
        }

        if (pendingSend && !unlockMessageSent)
        {
            TrySendUnlockMessage("PendingRetry");
        }
    }

    private void SyncDroneLockState()
    {
        if (wsClient != null)
        {
            lastKnownDroneLocked = wsClient.CheckDroneLocked();
        }
    }

    private void TryAutoResetByMissionState()
    {
        if (wsClient == null) return;

        bool currentLocked = wsClient.CheckDroneLocked();

        // 只在“上一帧是解锁，这一帧重新锁定”时重置
        if (!lastKnownDroneLocked && currentLocked)
        {
            ResetUnlock();
        }

        lastKnownDroneLocked = currentLocked;
    }

    private void EnsureZoneColliderValid()
    {
        if (zoneCollider == null)
        {
            zoneCollider = gameObject.AddComponent<BoxCollider>();
            zoneCollider.size = new Vector3(5f, 3f, 5f);
            Log("未找到 BoxCollider，已自动添加默认 BoxCollider");
        }

        if (!zoneCollider.isTrigger)
        {
            zoneCollider.isTrigger = true;
            Log("BoxCollider 的 Is Trigger 未勾选，已自动改为 true");
        }
    }

    private void FindWebSocketClient()
    {
        if (WebSocketClient.Instance != null)
        {
            wsClient = WebSocketClient.Instance;
            return;
        }

        wsClient = FindFirstObjectByType<WebSocketClient>(FindObjectsInactive.Include);
    }

    private void TryFindDroneRoot()
    {
        if (droneRoot != null) return;

        DroneController droneController = FindFirstObjectByType<DroneController>(FindObjectsInactive.Include);
        if (droneController != null)
        {
            droneRoot = droneController.transform.root;
            Log($"自动找到无人机根节点（通过 DroneController）: {droneRoot.name}");
            return;
        }

        GameObject taggedDrone = null;
        if (!string.IsNullOrWhiteSpace(droneTag))
        {
            try
            {
                taggedDrone = GameObject.FindGameObjectWithTag(droneTag);
            }
            catch
            {
            }
        }

        if (taggedDrone != null)
        {
            droneRoot = taggedDrone.transform.root;
            Log($"自动找到无人机根节点（通过 Tag）: {droneRoot.name}");
            return;
        }

        Transform[] allTransforms = FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None);
        foreach (Transform t in allTransforms)
        {
            string n = t.name.ToLower();
            if (n.Contains("drone") || n.Contains("无人机"))
            {
                droneRoot = t.root;
                Log($"自动找到无人机根节点（通过名称）: {droneRoot.name}");
                return;
            }
        }
    }

    private void OnTriggerEnter(Collider other)
    {
        if (!useTriggerCallbacks || unlockTriggered) return;
        HandleTrigger(other, "OnTriggerEnter");
    }

    private void OnTriggerStay(Collider other)
    {
        if (!useTriggerCallbacks || unlockTriggered) return;
        HandleTrigger(other, "OnTriggerStay");
    }

    private void HandleTrigger(Collider other, string source)
    {
        if (other == null) return;

        Log($"{source} -> {other.name}, tag={other.tag}, layer={LayerMask.LayerToName(other.gameObject.layer)}");

        if (!CanTriggerNow()) return;

        if (onlyDroneCanTrigger && !IsDroneCollider(other))
        {
            Log($"{source} 被忽略：{other.name} 不是无人机相关碰撞体");
            return;
        }

        TriggerUnlock($"{source}:{other.name}");
    }

    private void PollDronePosition()
    {
        if (droneRoot == null || zoneCollider == null) return;
        if (!CanTriggerNow()) return;

        Bounds zoneBounds = GetWorldBounds(zoneCollider);

        // 1) 根节点位置进入区域
        if (zoneBounds.Contains(droneRoot.position))
        {
            TriggerUnlock("BoundsContains(droneRoot.position)");
            return;
        }

        // 2) 无人机任一子碰撞体与触发区相交
        Collider[] droneColliders = droneRoot.GetComponentsInChildren<Collider>(true);
        foreach (Collider col in droneColliders)
        {
            if (col == null || !col.enabled) continue;

            if (zoneBounds.Intersects(col.bounds))
            {
                TriggerUnlock($"BoundsIntersects({col.name})");
                return;
            }
        }
    }

    private bool CanTriggerNow()
    {
        if (unlockTriggered) return false;
        if (Time.time - lastTriggerTime < triggerCooldown) return false;
        return true;
    }

    private bool IsDroneCollider(Collider other)
    {
        if (other == null) return false;

        if (droneRoot != null)
        {
            Transform t = other.transform;
            if (t == droneRoot || t.IsChildOf(droneRoot) || droneRoot.IsChildOf(t))
                return true;

            if (other.attachedRigidbody != null)
            {
                Transform rbRoot = other.attachedRigidbody.transform.root;
                if (rbRoot == droneRoot || rbRoot.IsChildOf(droneRoot) || droneRoot.IsChildOf(rbRoot))
                    return true;
            }
        }

        if (!string.IsNullOrWhiteSpace(droneTag))
        {
            if (other.CompareTag(droneTag)) return true;
            if (other.transform.root.CompareTag(droneTag)) return true;
        }

        if (other.GetComponentInParent<DroneController>() != null) return true;
        if (other.GetComponentInChildren<DroneController>() != null) return true;

        string selfName = other.name.ToLower();
        string rootName = other.transform.root.name.ToLower();

        if (selfName.Contains("drone") || selfName.Contains("无人机")) return true;
        if (rootName.Contains("drone") || rootName.Contains("无人机")) return true;

        return false;
    }

    private void TriggerUnlock(string reason)
    {
        lastTriggerTime = Time.time;
        unlockTriggered = true;

        Log($"触发解锁成功，来源 = {reason}");

        bool sentNow = TrySendUnlockMessage(reason);
        if (!sentNow)
        {
            pendingSend = true;
            Log("已进入解锁区，但 WebSocket 当前未连接，等待重连后自动补发 bridgeUnlocked");
        }

        ShowUnlockEffect();
    }

    private bool TrySendUnlockMessage(string reason)
    {
        if (unlockMessageSent) return true;

        if (wsClient == null)
            FindWebSocketClient();

        if (wsClient == null)
        {
            Log("发送失败：未找到 WebSocketClient");
            return false;
        }

        if (!wsClient.isConnected)
        {
            Log("发送失败：WebSocket 未连接");
            return false;
        }

        // 只发送一次 bridgeUnlocked，避免重复触发网页逻辑
        wsClient.SendMessageToServer("bridgeUnlocked", BridgeUnlockedMessage);

        unlockMessageSent = true;
        pendingSend = false;
        Log($"bridgeUnlocked 已发送，来源 = {reason}");
        return true;
    }

    private static Bounds GetWorldBounds(BoxCollider box)
    {
        Vector3 worldCenter = box.transform.TransformPoint(box.center);
        Vector3 worldSize = Vector3.Scale(box.size, box.transform.lossyScale);
        return new Bounds(worldCenter, worldSize);
    }

    private void ShowUnlockEffect()
    {
        Renderer rend = GetComponent<Renderer>();
        if (rend != null && rend.material != null)
        {
            rend.material.color = Color.green;
        }
    }

    public void ResetUnlock()
    {
        unlockTriggered = false;
        unlockMessageSent = false;
        pendingSend = false;
        lastTriggerTime = -999f;

        Log("解锁状态已重置");

        Renderer rend = GetComponent<Renderer>();
        if (rend != null && rend.material != null)
        {
            rend.material.color = Color.yellow;
        }
    }

    public void ForceUnlock()
    {
        TriggerUnlock("ForceUnlock");
    }

    private void OnDrawGizmos()
    {
        BoxCollider box = GetComponent<BoxCollider>();
        if (box == null) return;

        Bounds b = GetWorldBounds(box);
        Gizmos.color = unlockTriggered ? Color.green : Color.yellow;
        Gizmos.DrawWireCube(b.center, b.size);

        Gizmos.color = unlockTriggered
            ? new Color(0f, 1f, 0f, 0.15f)
            : new Color(1f, 1f, 0f, 0.15f);

        Gizmos.DrawCube(b.center, b.size);
    }

    private void Log(string message)
    {
        if (!debugMode) return;
        Debug.Log($"[BridgeUnlockZone] {message}");
    }
}