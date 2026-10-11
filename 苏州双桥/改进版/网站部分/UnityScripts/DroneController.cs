using UnityEngine;

public class DroneController : MonoBehaviour
{
    [Header("根物体（有 Rigidbody）")]
    public Transform droneRoot;

    [Header("模型（只负责倾斜）")]
    public Transform droneModel;

    [Header("螺旋桨")]
    public Transform[] propellers;
    public float propellerRotateSpeed = 800f;

    [Header("移动速度")]
    public float moveSpeed = 5f;
    public float yawSpeed = 90f;
    public float turnSpeed = 60f;
    public float ascendSpeed = 2f;
    public float descendSpeed = 2f;

    [Header("倾斜角度")]
    public float forwardTilt = 12f;
    public float sideTilt = 15f;
    public float descendExtraTilt = 10f;

    [Header("倾斜平滑")]
    public float tiltSmooth = 6f;

    [Header("高度限制")]
    public float minHeight = 0.5f;
    public float maxHeight = 100f;

    private float targetTiltX;
    private float targetTiltZ;
    private float currentTiltX;
    private float currentTiltZ;

    // 锁定提示相关
    private float lockHintCooldown = 3f;
    private float lastLockHintTime = -10f;

    // 无人机飞行状态
    private bool isFlying = false;
    private bool wasFlying = false;

    // 无人机锁定状态
    private bool isDroneLocked = true;

    // 起飞高度阈值
    private float takeoffThreshold = 1.5f;

    void Update()
    {
        isDroneLocked = true;

        if (WebSocketClient.Instance != null)
        {
            isDroneLocked = WebSocketClient.Instance.CheckDroneLocked();
        }

        if (isDroneLocked)
        {
            RotatePropellers();
            ShowLockHintIfNeeded();
            ResetTiltSmoothly();

            if (isFlying)
            {
                isFlying = false;
                SendDroneLandMessage();
            }

            return;
        }

        RotatePropellers();
        HandleYaw();
        HandleTurn();
        HandleMove();
        HandleHeight();
        HandleTilt();

        CheckFlyingState();
    }

    void CheckFlyingState()
    {
        if (droneRoot == null) return;

        float currentHeight = droneRoot.position.y;

        bool currentlyFlying = false;

        if (currentHeight > minHeight + takeoffThreshold)
        {
            currentlyFlying = true;
        }
        else if (Input.GetKey(KeyCode.Space) && currentHeight > minHeight + 0.5f)
        {
            currentlyFlying = true;
        }
        else if (isFlying && currentHeight > minHeight + 0.3f)
        {
            currentlyFlying = true;
        }

        if (currentlyFlying && !wasFlying)
        {
            isFlying = true;
            SendDroneTakeoffMessage();
            Debug.Log($"🚁 无人机已起飞！当前高度: {currentHeight:F2}");
        }
        else if (!currentlyFlying && wasFlying && isFlying)
        {
            if (currentHeight <= minHeight + 0.2f)
            {
                isFlying = false;
                SendDroneLandMessage();
                Debug.Log($"🛬 无人机已降落！当前高度: {currentHeight:F2}");
            }
        }

        wasFlying = currentlyFlying;
    }

    void SendDroneTakeoffMessage()
    {
        if (WebSocketClient.Instance != null && WebSocketClient.Instance.isConnected)
        {
            string json = "{\"type\":\"droneTakeoff\",\"data\":\"无人机已起飞\",\"from\":\"unity\"}";
            WebSocketClient.Instance.SendRawMessage(json);
            Debug.Log("📤 发送起飞消息: " + json);

            Invoke(nameof(SendFlyingMessage), 0.3f);
        }
    }

    void SendFlyingMessage()
    {
        if (WebSocketClient.Instance != null && WebSocketClient.Instance.isConnected)
        {
            string json = "{\"type\":\"droneFlying\",\"data\":\"无人机飞行中\",\"from\":\"unity\"}";
            WebSocketClient.Instance.SendRawMessage(json);
        }
    }

    void SendDroneLandMessage()
    {
        if (WebSocketClient.Instance != null && WebSocketClient.Instance.isConnected)
        {
            string json = "{\"type\":\"droneLand\",\"data\":\"无人机已降落\",\"from\":\"unity\"}";
            WebSocketClient.Instance.SendRawMessage(json);
            Debug.Log("📤 发送降落消息: " + json);
        }
    }

    void ShowLockHintIfNeeded()
    {
        bool hasInput =
            Input.GetKey(KeyCode.Space) ||
            Input.GetKey(KeyCode.L) ||
            Input.GetAxisRaw("Vertical") != 0 ||
            Input.GetAxisRaw("Horizontal") != 0 ||
            Input.GetKey(KeyCode.Q) ||
            Input.GetKey(KeyCode.E) ||
            Input.GetKey(KeyCode.W) ||
            Input.GetKey(KeyCode.S) ||
            Input.GetKey(KeyCode.A) ||
            Input.GetKey(KeyCode.D);

        if (hasInput)
        {
            float currentTime = Time.time;

            if (currentTime - lastLockHintTime > lockHintCooldown)
            {
                lastLockHintTime = currentTime;
                SendLockHintToWeb();
                Debug.Log("🔒 无人机已锁定 - 请先完成网站上的查看模型和四季切换任务");
            }
        }
    }

    void SendLockHintToWeb()
    {
        if (WebSocketClient.Instance != null && WebSocketClient.Instance.isConnected)
        {
            string json = "{\"type\":\"droneLocked\",\"data\":\"无人机已锁定，请先完成网站上的交互任务\",\"from\":\"unity\"}";
            WebSocketClient.Instance.SendRawMessage(json);
        }
    }

    void RotatePropellers()
    {
        if (propellers == null) return;

        foreach (var p in propellers)
        {
            if (p)
                p.Rotate(Vector3.up, propellerRotateSpeed * Time.deltaTime);
        }
    }

    void HandleYaw()
    {
        if (droneRoot == null) return;

        float yaw = Input.GetAxisRaw("Horizontal");
        droneRoot.Rotate(0f, yaw * yawSpeed * Time.deltaTime, 0f);

        targetTiltZ = yaw * sideTilt;
    }

    void HandleTurn()
    {
        if (droneRoot == null) return;

        float turn = 0f;

        if (Input.GetKey(KeyCode.Q))
            turn = -1f;
        else if (Input.GetKey(KeyCode.E))
            turn = 1f;

        droneRoot.Rotate(0f, turn * turnSpeed * Time.deltaTime, 0f);
    }

    void HandleMove()
    {
        if (droneRoot == null) return;

        float forward = Input.GetAxisRaw("Vertical");

        droneRoot.position -=
            droneRoot.forward *
            forward *
            moveSpeed *
            Time.deltaTime;

        targetTiltX = -forward * forwardTilt;
    }

    void HandleHeight()
    {
        if (droneRoot == null) return;

        Vector3 pos = droneRoot.position;

        if (Input.GetKey(KeyCode.Space))
        {
            pos.y += ascendSpeed * Time.deltaTime;
        }
        else if (Input.GetKey(KeyCode.L))
        {
            pos.y -= descendSpeed * Time.deltaTime;
            targetTiltX -= descendExtraTilt;
        }

        pos.y = Mathf.Clamp(pos.y, minHeight, maxHeight);
        droneRoot.position = pos;
    }

    void HandleTilt()
    {
        if (droneModel == null) return;

        currentTiltX = Mathf.Lerp(currentTiltX, targetTiltX, Time.deltaTime * tiltSmooth);
        currentTiltZ = Mathf.Lerp(currentTiltZ, targetTiltZ, Time.deltaTime * tiltSmooth);

        droneModel.localRotation = Quaternion.Euler(currentTiltX, 0f, currentTiltZ);

        targetTiltX = 0f;
        targetTiltZ = 0f;
    }

    void ResetTiltSmoothly()
    {
        if (droneModel == null) return;

        currentTiltX = Mathf.Lerp(currentTiltX, 0f, Time.deltaTime * tiltSmooth);
        currentTiltZ = Mathf.Lerp(currentTiltZ, 0f, Time.deltaTime * tiltSmooth);
        droneModel.localRotation = Quaternion.Euler(currentTiltX, 0f, currentTiltZ);

        targetTiltX = 0f;
        targetTiltZ = 0f;
    }
}