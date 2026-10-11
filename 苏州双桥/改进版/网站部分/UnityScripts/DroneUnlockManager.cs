using UnityEngine;

public class DroneUnlockManager : MonoBehaviour
{
    [Header("自动查找 WebSocketClient")]
    [SerializeField] private WebSocketClient wsClient;

    [Header("调试状态")]
    [SerializeField] private bool isDroneUnlocked = false;

    public bool IsDroneUnlocked => isDroneUnlocked;

    void Awake()
    {
        FindClient();
    }

    void Start()
    {
        SyncFromClient();
    }

    void FindClient()
    {
        if (wsClient == null)
        {
            wsClient = FindFirstObjectByType<WebSocketClient>(FindObjectsInactive.Include);
        }
    }

    void SyncFromClient()
    {
        FindClient();

        if (wsClient != null)
        {
            isDroneUnlocked = !wsClient.CheckDroneLocked();
        }
    }

    public void UnlockDrone()
    {
        FindClient();

        if (wsClient == null)
        {
            Debug.LogWarning("? DroneUnlockManager 没有找到 WebSocketClient");
            return;
        }

        wsClient.UnlockDrone(false);
        wsClient.SendMessageToServer("droneUnlocked", "true");

        isDroneUnlocked = true;
        Debug.Log("? DroneUnlockManager: 无人机已解锁");
    }

    public void LockDrone()
    {
        FindClient();

        if (wsClient == null)
        {
            Debug.LogWarning("? DroneUnlockManager 没有找到 WebSocketClient");
            return;
        }

        wsClient.LockDrone(false);
        wsClient.SendMessageToServer("droneLocked", "true");

        isDroneUnlocked = false;
        Debug.Log("?? DroneUnlockManager: 无人机已锁定");
    }

    public void SetUnlocked(bool unlocked)
    {
        if (unlocked)
            UnlockDrone();
        else
            LockDrone();
    }

    public void NotifyBridgeUnlocked()
    {
        FindClient();

        if (wsClient == null)
        {
            Debug.LogWarning("? DroneUnlockManager 没有找到 WebSocketClient");
            return;
        }

        wsClient.SendMessageToServer("bridgeUnlocked", "true");
        Debug.Log("?? 已通知网页：桥边交互已解锁");
    }
}