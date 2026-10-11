using System;
using UnityEngine;
using UnityEngine.UI;

[DisallowMultipleComponent]
public class BridgeViewerPointerInteractor : MonoBehaviour
{
    [Header("UI 引用")]
    [SerializeField] private RawImage targetRawImage;
    [SerializeField] private GameObject viewerPanel;

    [Header("模型查看器相机")]
    [SerializeField] private Camera modelViewerCamera;

    [Header("桥根节点")]
    [SerializeField] private Transform shideBridgeRoot;   // 双桥1号 -> 世德桥
    [SerializeField] private Transform yonganBridgeRoot;  // 双桥2号 -> 永安桥

    [Header("射线设置")]
    [SerializeField] private LayerMask raycastLayers = ~0;
    [SerializeField] private float rayDistance = 2000f;

    [Header("调试")]
    [SerializeField] private bool enableDebugLog = true;

    private Canvas parentCanvas;
    private RectTransform rawImageRect;
    private string currentHoverBridge = "";
    private bool wasMouseInsideLastFrame = false;

    private void Awake()
    {
        if (targetRawImage == null)
        {
            targetRawImage = GetComponent<RawImage>();
        }

        if (targetRawImage != null)
        {
            rawImageRect = targetRawImage.rectTransform;
            parentCanvas = targetRawImage.GetComponentInParent<Canvas>();
        }
    }

    private void Update()
    {
        if (!IsViewerReady())
        {
            ClearHoverAndNotify();
            return;
        }

        bool isMouseInside = IsMouseInsideRawImage(Input.mousePosition);

        if (!isMouseInside)
        {
            if (wasMouseInsideLastFrame)
            {
                if (enableDebugLog)
                {
                    Debug.Log("[BridgeViewerPointerInteractor] 鼠标已离开 ModelDisplay 区域");
                }
            }

            wasMouseInsideLastFrame = false;
            ClearHoverAndNotify();
            return;
        }

        if (!wasMouseInsideLastFrame && enableDebugLog)
        {
            Debug.Log("[BridgeViewerPointerInteractor] 鼠标已进入 ModelDisplay 区域");
        }

        wasMouseInsideLastFrame = true;

        string bridgeType = GetBridgeTypeFromMousePosition(Input.mousePosition);
        UpdateHoverState(bridgeType);

        if (Input.GetMouseButtonDown(0))
        {
            if (!string.IsNullOrEmpty(bridgeType))
            {
                SendBridgeMessage("bridgeClick", bridgeType);

                if (enableDebugLog)
                {
                    Debug.Log($"[BridgeViewerPointerInteractor] 点击桥梁: {bridgeType}");
                }
            }
            else
            {
                if (enableDebugLog)
                {
                    Debug.Log("[BridgeViewerPointerInteractor] 点击了 ModelDisplay，但没有点中桥");
                }
            }
        }
    }

    private bool IsViewerReady()
    {
        if (targetRawImage == null) return false;
        if (rawImageRect == null) return false;
        if (modelViewerCamera == null) return false;
        if (!modelViewerCamera.enabled) return false;

        if (viewerPanel != null && !viewerPanel.activeInHierarchy)
            return false;

        return true;
    }

    private bool IsMouseInsideRawImage(Vector2 screenPoint)
    {
        if (rawImageRect == null)
            return false;

        Camera uiCamera = GetUICamera();

        return RectTransformUtility.RectangleContainsScreenPoint(
            rawImageRect,
            screenPoint,
            uiCamera
        );
    }

    private string GetBridgeTypeFromMousePosition(Vector2 screenPoint)
    {
        if (rawImageRect == null || modelViewerCamera == null)
            return "";

        Camera uiCamera = GetUICamera();

        Vector2 localPoint;
        bool success = RectTransformUtility.ScreenPointToLocalPointInRectangle(
            rawImageRect,
            screenPoint,
            uiCamera,
            out localPoint
        );

        if (!success)
            return "";

        Rect rect = rawImageRect.rect;

        float normalizedX = (localPoint.x - rect.xMin) / rect.width;
        float normalizedY = (localPoint.y - rect.yMin) / rect.height;

        if (normalizedX < 0f || normalizedX > 1f || normalizedY < 0f || normalizedY > 1f)
            return "";

        Ray ray = modelViewerCamera.ViewportPointToRay(new Vector3(normalizedX, normalizedY, 0f));

        if (Physics.Raycast(ray, out RaycastHit hit, rayDistance, raycastLayers, QueryTriggerInteraction.Ignore))
        {
            if (enableDebugLog)
            {
                Debug.Log($"[BridgeViewerPointerInteractor] 射线命中物体: {hit.transform.name}");
            }

            return ResolveBridgeType(hit.transform);
        }

        return "";
    }

    private Camera GetUICamera()
    {
        if (parentCanvas == null)
            return null;

        if (parentCanvas.renderMode == RenderMode.ScreenSpaceOverlay)
            return null;

        return parentCanvas.worldCamera;
    }

    private string ResolveBridgeType(Transform hitTransform)
    {
        if (hitTransform == null)
            return "";

        if (shideBridgeRoot != null)
        {
            if (hitTransform == shideBridgeRoot || hitTransform.IsChildOf(shideBridgeRoot))
                return "shide";
        }

        if (yonganBridgeRoot != null)
        {
            if (hitTransform == yonganBridgeRoot || hitTransform.IsChildOf(yonganBridgeRoot))
                return "yongan";
        }

        return "";
    }

    private void UpdateHoverState(string bridgeType)
    {
        if (bridgeType == currentHoverBridge)
            return;

        currentHoverBridge = bridgeType;

        if (string.IsNullOrEmpty(currentHoverBridge))
        {
            SendBridgeMessage("bridgeHoverExit", "");

            if (enableDebugLog)
            {
                Debug.Log("[BridgeViewerPointerInteractor] 鼠标当前没有悬浮在桥上");
            }
        }
        else
        {
            SendBridgeMessage("bridgeHover", currentHoverBridge);

            if (enableDebugLog)
            {
                Debug.Log($"[BridgeViewerPointerInteractor] 鼠标悬浮桥梁: {currentHoverBridge}");
            }
        }
    }

    private void ClearHoverAndNotify()
    {
        if (string.IsNullOrEmpty(currentHoverBridge))
            return;

        currentHoverBridge = "";
        SendBridgeMessage("bridgeHoverExit", "");

        if (enableDebugLog)
        {
            Debug.Log("[BridgeViewerPointerInteractor] 清除悬浮状态并发送 bridgeHoverExit");
        }
    }

    private void SendBridgeMessage(string messageType, string bridgeType)
    {
        if (WebSocketClient.Instance == null)
        {
            if (enableDebugLog)
            {
                Debug.LogWarning("[BridgeViewerPointerInteractor] WebSocketClient.Instance 为空，消息未发送");
            }
            return;
        }

        if (!WebSocketClient.Instance.isConnected)
        {
            if (enableDebugLog)
            {
                Debug.LogWarning("[BridgeViewerPointerInteractor] WebSocket 未连接，消息未发送");
            }
            return;
        }

        WebSocketClient.OutgoingMessage msg = new WebSocketClient.OutgoingMessage
        {
            type = messageType,
            data = bridgeType,
            from = "unity",
            time = DateTime.Now.ToString("o")
        };

        WebSocketClient.Instance.SendJson(msg);
    }
}