using UnityEngine;

public class BridgeWebSync : MonoBehaviour
{
    [Header("桥标识：shide / yongan")]
    public string bridgeType = "shide";

    [Header("离开时是否发送隐藏消息")]
    public bool sendLeaveMessage = true;

    private WebSocketClient wsClient;

    private void Start()
    {
        wsClient = FindFirstObjectByType<WebSocketClient>(FindObjectsInactive.Include);
    }

    private void EnsureClient()
    {
        if (wsClient == null)
        {
            wsClient = FindFirstObjectByType<WebSocketClient>(FindObjectsInactive.Include);
        }
    }

    private void OnMouseEnter()
    {
        EnsureClient();
        if (wsClient == null || !wsClient.isConnected) return;

        wsClient.SendMessageToServer("bridgeHover", bridgeType);
        Debug.Log($"[BridgeWebSync] Hover -> {bridgeType}");
    }

    private void OnMouseExit()
    {
        if (!sendLeaveMessage) return;

        EnsureClient();
        if (wsClient == null || !wsClient.isConnected) return;

        wsClient.SendMessageToServer("bridgeHoverExit", bridgeType);
        Debug.Log($"[BridgeWebSync] HoverExit -> {bridgeType}");
    }

    private void OnMouseDown()
    {
        EnsureClient();
        if (wsClient == null || !wsClient.isConnected) return;

        wsClient.SendMessageToServer("bridgeClick", bridgeType);
        Debug.Log($"[BridgeWebSync] Click -> {bridgeType}");
    }
}