using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class ModelViewerController : MonoBehaviour
{
    [Header("UI")]
    public GameObject viewerPanel;
    public RawImage modelDisplay;
    public AspectRatioFitter modelDisplayAspectFitter;

    [Header("提示文字")]
    public TextMeshProUGUI viewerHintText;
    [TextArea(2, 4)]
    public string hintMessage = "请将鼠标分别悬浮在两个桥模型上查看介绍，\n点击桥模型后可在网页端固定显示对应介绍";

    [Header("桥描边闪烁控制")]
    public BridgeOutlineBlinkController bridgeOutlineBlinkController;

    [Header("渲染")]
    public Camera modelViewerCamera;
    public RenderTexture modelRenderTexture;

    [Header("模型")]
    public GameObject modelRoot;

    [Header("打开面板时的行为")]
    public bool resetViewWhenOpen = false;

    private ModelRotator modelRotator;

    private void Awake()
    {
        CacheReferences();
        SetupRenderTarget();
        ApplyHintText();
        CloseViewerImmediate();
    }

    private void Start()
    {
        CacheReferences();
        SetupRenderTarget();
        ApplyHintText();
    }

    private void CacheReferences()
    {
        if (modelRoot != null)
        {
            modelRotator = modelRoot.GetComponent<ModelRotator>();
            if (modelRotator == null)
            {
                modelRotator = modelRoot.GetComponentInChildren<ModelRotator>(true);
            }
        }
    }

    private void SetupRenderTarget()
    {
        if (modelDisplay != null && modelRenderTexture != null)
        {
            modelDisplay.texture = modelRenderTexture;
        }

        if (modelViewerCamera != null && modelRenderTexture != null)
        {
            modelViewerCamera.targetTexture = modelRenderTexture;
            modelViewerCamera.enabled = false;
            modelViewerCamera.transform.localScale = Vector3.one;
            modelViewerCamera.aspect = (float)modelRenderTexture.width / modelRenderTexture.height;
        }

        if (modelDisplayAspectFitter != null && modelRenderTexture != null)
        {
            modelDisplayAspectFitter.aspectRatio = (float)modelRenderTexture.width / modelRenderTexture.height;
        }
    }

    private void ApplyHintText()
    {
        if (viewerHintText != null)
        {
            viewerHintText.text = hintMessage;
        }
    }

    private void SetHintVisible(bool visible)
    {
        if (viewerHintText != null)
        {
            viewerHintText.gameObject.SetActive(visible);
        }
    }

    public void OpenViewer()
    {
        CacheReferences();
        SetupRenderTarget();
        ApplyHintText();

        if (viewerPanel != null)
        {
            viewerPanel.SetActive(true);
        }

        if (modelRoot != null)
        {
            modelRoot.SetActive(true);
        }

        if (modelViewerCamera == null)
        {
            Debug.LogError("[ModelViewerController] modelViewerCamera 未赋值");
            return;
        }

        modelViewerCamera.enabled = true;
        modelViewerCamera.targetTexture = modelRenderTexture;
        modelViewerCamera.transform.localScale = Vector3.one;

        if (modelDisplay != null)
        {
            modelDisplay.texture = modelRenderTexture;
        }

        SetHintVisible(true);

        if (bridgeOutlineBlinkController != null)
        {
            bridgeOutlineBlinkController.SetOutlineActive(true);
            Debug.Log("[ModelViewerController] 已开启桥描边闪烁");
        }

        if (modelRotator != null)
        {
            if (resetViewWhenOpen)
            {
                modelRotator.ResetView();
                Debug.Log("[ModelViewerController] 打开时执行 ResetView");
            }
            else
            {
                modelRotator.InitializeFromCurrentCamera(true);
                Debug.Log("[ModelViewerController] 已从当前相机位置进行初始化");
            }
        }
        else
        {
            Debug.LogWarning("[ModelViewerController] 没有找到 ModelRotator");
        }
    }

    public void CloseViewer()
    {
        if (viewerPanel != null)
        {
            viewerPanel.SetActive(false);
        }

        if (modelViewerCamera != null)
        {
            modelViewerCamera.enabled = false;
        }

        if (bridgeOutlineBlinkController != null)
        {
            bridgeOutlineBlinkController.SetOutlineActive(false);
            Debug.Log("[ModelViewerController] 已关闭桥描边闪烁");
        }

        SetHintVisible(false);
    }

    public void TogglePanel(bool show)
    {
        if (show)
        {
            OpenViewer();
        }
        else
        {
            CloseViewer();
        }
    }

    private void CloseViewerImmediate()
    {
        if (viewerPanel != null)
        {
            viewerPanel.SetActive(false);
        }

        if (modelViewerCamera != null)
        {
            modelViewerCamera.enabled = false;
        }

        if (bridgeOutlineBlinkController != null)
        {
            bridgeOutlineBlinkController.SetOutlineActive(false);
        }

        SetHintVisible(false);
    }
}