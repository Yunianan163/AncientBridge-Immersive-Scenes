using UnityEngine;

public class ModelViewer : MonoBehaviour
{
    [Header("UI")]
    public GameObject viewerPanel;

    void Start()
    {
        if (viewerPanel != null)
            viewerPanel.SetActive(false);
    }

    public void OpenViewer(string modelId)
    {
        if (viewerPanel != null)
        {
            viewerPanel.SetActive(true);
            Debug.Log($"打开模型查看器: {modelId}");
        }
    }

    public void CloseViewer()
    {
        if (viewerPanel != null)
            viewerPanel.SetActive(false);
    }

    void Update()
    {
        // 按 M 键测试显示面板
        if (Input.GetKeyDown(KeyCode.M))
        {
            OpenViewer("test");
        }

        // ESC关闭
        if (Input.GetKeyDown(KeyCode.Escape))
        {
            CloseViewer();
        }
    }
}