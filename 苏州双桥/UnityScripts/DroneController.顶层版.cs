using UnityEngine;

public class DroneController : MonoBehaviour
{
    [Header("根物体（有 Rigidbody）")]
    public Transform droneRoot;

    [Header("螺旋桨")]
    public Transform[] propellers;
    public float propellerRotateSpeed = 800f;

    [Header("音效")]
    public AudioClip droneAudioClip;
    private AudioSource droneAudio;

    [Header("移动速度")]
    public float moveSpeed = 5f;
    public float yawSpeed = 90f;
    public float turnSpeed = 60f;
    public float ascendSpeed = 2f;
    public float descendSpeed = 2f;

    [Header("高度限制")]
    public float minHeight = 0.5f;
    public float maxHeight = 100f;

    // 锁定提示相关
    private float lockHintCooldown = 3f;
    private float lastLockHintTime = -10f;

    // 无人机飞行状态
    private bool isFlying = false;
    private bool wasFlying = false;

    // 无人机锁定状态
    private bool isDroneLocked = true;

    [Header("飞行判定阈值")]
    public float takeoffThreshold = 1.5f;
    public float flyingInputMinHeightOffset = 0.1f;
    public float flyingMaintainHeightOffset = 0.1f;
    public float landingHeightOffset = 0.05f;

    void Start()
    {
        InitializePropellers();
        InitializeAudio();
    }

    void InitializeAudio()
    {
        if (droneAudio == null)
        {
            if (droneRoot != null)
                droneAudio = droneRoot.GetComponent<AudioSource>();
            if (droneAudio == null)
                droneAudio = GetComponent<AudioSource>();
            if (droneAudio == null)
                droneAudio = gameObject.AddComponent<AudioSource>();
        }

        if (droneAudio != null)
        {
            if (droneAudioClip != null)
                droneAudio.clip = droneAudioClip;

            droneAudio.loop = true;
            droneAudio.volume = 0.8f;

            if (droneAudio.clip != null && !isDroneLocked && !droneAudio.isPlaying)
                droneAudio.Play();
        }
    }

    public void SetVolume(float volume)
    {
        if (droneAudio != null)
        {
            droneAudio.volume = Mathf.Clamp01(volume);
            Debug.Log($"[DroneController] 无人机音效音量已设置为 {droneAudio.volume:P0}");
        }
    }

    void InitializePropellers()
    {
        if (propellers != null && propellers.Length > 0 && propellers[0] != null)
            return;

        propellers = new Transform[4];
        propellers[0] = FindPropeller("Circle1_Propeller_parent");
        propellers[1] = FindPropeller("Circle2_Propeller_parent");
        propellers[2] = FindPropeller("Circle3_Propeller_parent");
        propellers[3] = FindPropeller("Circle4_Propeller_parent");

        int foundCount = 0;
        foreach (var p in propellers)
        {
            if (p != null) foundCount++;
        }

        Debug.Log($"[DroneController] 已找到 {foundCount}/4 个螺旋桨");
    }

    Transform FindPropeller(string name)
    {
        if (droneRoot != null)
        {
            Transform found = droneRoot.Find(name);
            if (found != null) return found;
        }

        GameObject go = GameObject.Find(name);
        if (go != null) return go.transform;

        return null;
    }

    void Update()
    {
        isDroneLocked = true;

        if (WebSocketClient.Instance != null)
        {
            isDroneLocked = WebSocketClient.Instance.CheckDroneLocked();
        }

        if (isDroneLocked)
        {
            ShowLockHintIfNeeded();

            if (droneAudio != null && droneAudio.isPlaying)
                droneAudio.Stop();

            if (isFlying)
            {
                isFlying = false;
                SendDroneLandMessage();
            }

            return;
        }

        if (droneAudio != null && !droneAudio.isPlaying)
            droneAudio.Play();

        RotatePropellers();
        HandleYaw();
        HandleTurn();
        HandleMove();
        HandleHeight();

        CheckFlyingState();
    }

    void CheckFlyingState()
    {
        if (droneRoot == null) return;

        float currentHeight = droneRoot.position.y;
        bool currentlyFlying = false;

        // 玩家正在主动操作升降时，始终保持飞行状态，避免被系统强制判定降落
        bool isControllingHeight = Input.GetKey(KeyCode.Space) || Input.GetKey(KeyCode.L);

        if (currentHeight > minHeight + takeoffThreshold)
        {
            currentlyFlying = true;
        }
        else if (isControllingHeight && currentHeight > minHeight + flyingInputMinHeightOffset)
        {
            currentlyFlying = true;
        }
        else if (isFlying && currentHeight > minHeight + flyingMaintainHeightOffset)
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
            if (currentHeight <= minHeight + landingHeightOffset)
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
        if (propellers == null || propellers.Length == 0)
        {
            InitializePropellers();
        }

        foreach (var p in propellers)
        {
            if (p != null)
                p.Rotate(Vector3.up, propellerRotateSpeed * Time.deltaTime, Space.Self);
        }
    }

    void HandleYaw()
    {
        if (droneRoot == null) return;

        float yaw = Input.GetAxisRaw("Horizontal");
        droneRoot.Rotate(0f, yaw * yawSpeed * Time.deltaTime, 0f);
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
    }

    void HandleHeight()
    {
        if (droneRoot == null) return;

        bool isAscending = Input.GetKey(KeyCode.Space);
        bool isDescending = Input.GetKey(KeyCode.L);

        // 只有在玩家主动操作升降时才修改高度，避免运行后自动把低于 minHeight 的无人机强行抬高
        if (!isAscending && !isDescending) return;

        Vector3 pos = droneRoot.position;

        if (isAscending)
        {
            pos.y += ascendSpeed * Time.deltaTime;
        }

        if (isDescending)
        {
            pos.y -= descendSpeed * Time.deltaTime;
        }

        pos.y = Mathf.Clamp(pos.y, minHeight, maxHeight);
        droneRoot.position = pos;
    }
}