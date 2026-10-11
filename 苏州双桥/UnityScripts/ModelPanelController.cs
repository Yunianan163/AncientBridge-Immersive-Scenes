using UnityEngine;

public class ModelPanelController : MonoBehaviour
{
    [Header("要控制的Canvas面板")]
    [SerializeField] private GameObject modelPanelCanvas;

    private bool isPanelOpen = false;

    void Start()
    {
        // 初始状态：隐藏面板
        if (modelPanelCanvas != null)
        {
            modelPanelCanvas.SetActive(false);
        }
    }

    /// <summary>
    /// 切换面板显示状态
    /// </summary>
    public void TogglePanel(bool show)
    {
        isPanelOpen = show;

        if (modelPanelCanvas != null)
        {
            modelPanelCanvas.SetActive(show);
            Debug.Log($"[ModelPanelController] 面板已{(show ? "显示" : "隐藏")}");
        }
    }
}