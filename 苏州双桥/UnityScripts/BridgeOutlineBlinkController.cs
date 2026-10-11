using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

[DisallowMultipleComponent]
public class BridgeOutlineBlinkController : MonoBehaviour
{
    [System.Serializable]
    public class BridgeOutlineItem
    {
        [Header("桥名称")]
        public string bridgeName;

        [Header("桥根节点，例如：双桥1号 / 双桥2号")]
        public Transform bridgeRoot;

        [Header("荧光材质（Custom/BridgeOutlineGlow）")]
        public Material outlineMaterial;

        [Header("荧光颜色")]
        public Color glowColor = new Color(1f, 0.9f, 0.3f, 1f);

        [Header("描边宽度")]
        [Range(0.001f, 0.05f)]
        public float outlineWidth = 0.02f;

        [Header("闪烁速度")]
        public float blinkSpeed = 3.0f;

        [Header("闪烁次数")]
        [Min(1)]
        public int blinkCount = 2;

        [Header("最低发光强度")]
        public float minGlowIntensity = 1.0f;

        [Header("最大发光强度")]
        public float maxGlowIntensity = 8.0f;

        [Header("透明度")]
        [Range(0.3f, 1.0f)]
        public float transparency = 0.7f;
    }

    private class RuntimeOutlineData
    {
        public BridgeOutlineItem config;
        public GameObject outlineRoot;
        public Material runtimeMaterial;

        public float blinkStartTime;
        public bool finished;
    }

    [Header("需要描边闪烁的桥")]
    public List<BridgeOutlineItem> bridges = new List<BridgeOutlineItem>();

    private readonly List<RuntimeOutlineData> runtimeOutlines = new List<RuntimeOutlineData>();

    private static readonly int GlowColorId = Shader.PropertyToID("_GlowColor");
    private static readonly int GlowIntensityId = Shader.PropertyToID("_GlowIntensity");
    private static readonly int OutlineWidthId = Shader.PropertyToID("_OutlineWidth");
    private static readonly int TransparencyId = Shader.PropertyToID("_Transparency");

    private bool isActive = false;
    private bool hasBuilt = false;

    private void Awake()
    {
        BuildAllOutlines();
        SetOutlineActive(false);
    }

    private void Update()
    {
        if (!isActive) return;

        bool hasAnyRunning = false;

        for (int i = 0; i < runtimeOutlines.Count; i++)
        {
            RuntimeOutlineData data = runtimeOutlines[i];
            if (data == null || data.runtimeMaterial == null || data.config == null || data.outlineRoot == null)
                continue;

            if (data.finished)
                continue;

            float safeBlinkSpeed = Mathf.Max(0.01f, data.config.blinkSpeed);
            int safeBlinkCount = Mathf.Max(1, data.config.blinkCount);

            // 总闪烁时长 = 闪烁次数 / 闪烁速度
            float totalBlinkDuration = safeBlinkCount / safeBlinkSpeed;
            float elapsed = Time.time - data.blinkStartTime;

            if (elapsed >= totalBlinkDuration)
            {
                data.finished = true;
                data.outlineRoot.SetActive(false);
                continue;
            }

            hasAnyRunning = true;

            float t = (Mathf.Cos(elapsed * safeBlinkSpeed * Mathf.PI * 2f) + 1f) * 0.5f;
            float glowIntensity = Mathf.Lerp(data.config.minGlowIntensity, data.config.maxGlowIntensity, t);

            ApplyGlowToMaterial(
                data.runtimeMaterial,
                data.config.glowColor,
                glowIntensity,
                data.config.outlineWidth,
                data.config.transparency
            );
        }

        if (!hasAnyRunning)
        {
            isActive = false;
        }
    }

    public void SetOutlineActive(bool active)
    {
        if (!hasBuilt)
        {
            BuildAllOutlines();
        }

        isActive = active;

        for (int i = 0; i < runtimeOutlines.Count; i++)
        {
            RuntimeOutlineData data = runtimeOutlines[i];
            if (data == null || data.outlineRoot == null)
                continue;

            if (!active)
            {
                data.finished = true;
                data.outlineRoot.SetActive(false);
                continue;
            }

            data.finished = false;
            data.blinkStartTime = Time.time;
            data.outlineRoot.SetActive(true);

            if (data.runtimeMaterial != null && data.config != null)
            {
                ApplyGlowToMaterial(
                    data.runtimeMaterial,
                    data.config.glowColor,
                    data.config.maxGlowIntensity,
                    data.config.outlineWidth,
                    data.config.transparency
                );
            }
        }
    }

    private void BuildAllOutlines()
    {
        if (hasBuilt) return;
        hasBuilt = true;

        runtimeOutlines.Clear();

        for (int i = 0; i < bridges.Count; i++)
        {
            BridgeOutlineItem item = bridges[i];
            if (item == null || item.bridgeRoot == null || item.outlineMaterial == null)
            {
                Debug.LogWarning($"[BridgeOutline] 跳过无效配置项索引 {i}");
                continue;
            }

            RuntimeOutlineData data = BuildSingleOutline(item);
            if (data != null)
            {
                runtimeOutlines.Add(data);
                Debug.Log($"[BridgeOutline] 已构建描边: {item.bridgeName}");
            }
        }

        Debug.Log($"[BridgeOutline] 构建完成，共 {runtimeOutlines.Count} 个描边物体");
    }

    private RuntimeOutlineData BuildSingleOutline(BridgeOutlineItem item)
    {
        GameObject outlineRoot = new GameObject(item.bridgeRoot.name + "_OutlineGlowRoot");

        outlineRoot.transform.SetParent(item.bridgeRoot, false);
        outlineRoot.transform.localPosition = Vector3.zero;
        outlineRoot.transform.localRotation = Quaternion.identity;
        outlineRoot.transform.localScale = Vector3.one;

        Material runtimeMat = new Material(item.outlineMaterial);
        runtimeMat.name = item.bridgeRoot.name + "_OutlineGlowRuntimeMat";

        ApplyGlowToMaterial(
            runtimeMat,
            item.glowColor,
            item.maxGlowIntensity,
            item.outlineWidth,
            item.transparency
        );

        CopyHierarchy(item.bridgeRoot, outlineRoot.transform, runtimeMat, 1.0f);

        outlineRoot.SetActive(false);
        outlineRoot.layer = item.bridgeRoot.gameObject.layer;

        return new RuntimeOutlineData
        {
            config = item,
            outlineRoot = outlineRoot,
            runtimeMaterial = runtimeMat,
            blinkStartTime = 0f,
            finished = true
        };
    }

    private void CopyHierarchy(Transform source, Transform targetParent, Material runtimeMat, float scale)
    {
        CreateOutlineMeshIfNeeded(source, targetParent, runtimeMat, scale);

        for (int i = 0; i < source.childCount; i++)
        {
            Transform sourceChild = source.GetChild(i);

            if (sourceChild.name.Contains("_OutlineGlowRoot") || sourceChild.name.Contains("_OutlineMesh"))
                continue;

            GameObject cloneNode = new GameObject(sourceChild.name + "_OutlineNode");
            Transform cloneTransform = cloneNode.transform;

            cloneTransform.SetParent(targetParent, false);
            cloneTransform.localPosition = sourceChild.localPosition;
            cloneTransform.localRotation = sourceChild.localRotation;
            cloneTransform.localScale = sourceChild.localScale;

            cloneNode.layer = sourceChild.gameObject.layer;

            CopyHierarchy(sourceChild, cloneTransform, runtimeMat, scale);
        }
    }

    private void CreateOutlineMeshIfNeeded(Transform source, Transform targetParent, Material runtimeMat, float scale)
    {
        MeshFilter sourceMeshFilter = source.GetComponent<MeshFilter>();
        MeshRenderer sourceMeshRenderer = source.GetComponent<MeshRenderer>();

        if (sourceMeshFilter != null && sourceMeshRenderer != null && sourceMeshFilter.sharedMesh != null)
        {
            GameObject outlineMeshObj = new GameObject(source.name + "_OutlineMesh");
            Transform outlineMeshTf = outlineMeshObj.transform;
            outlineMeshTf.SetParent(targetParent, false);
            outlineMeshTf.localPosition = Vector3.zero;
            outlineMeshTf.localRotation = Quaternion.identity;
            outlineMeshTf.localScale = Vector3.one * scale;

            MeshFilter mf = outlineMeshObj.AddComponent<MeshFilter>();
            mf.sharedMesh = sourceMeshFilter.sharedMesh;

            MeshRenderer mr = outlineMeshObj.AddComponent<MeshRenderer>();
            mr.sharedMaterial = runtimeMat;
            SetupOutlineRenderer(mr);
            outlineMeshObj.layer = source.gameObject.layer;
            return;
        }

        SkinnedMeshRenderer sourceSkinned = source.GetComponent<SkinnedMeshRenderer>();
        if (sourceSkinned != null && sourceSkinned.sharedMesh != null)
        {
            GameObject outlineMeshObj = new GameObject(source.name + "_OutlineMesh");
            Transform outlineMeshTf = outlineMeshObj.transform;
            outlineMeshTf.SetParent(targetParent, false);
            outlineMeshTf.localPosition = Vector3.zero;
            outlineMeshTf.localRotation = Quaternion.identity;
            outlineMeshTf.localScale = Vector3.one * scale;

            SkinnedMeshRenderer smr = outlineMeshObj.AddComponent<SkinnedMeshRenderer>();
            smr.sharedMesh = sourceSkinned.sharedMesh;
            smr.sharedMaterial = runtimeMat;
            smr.localBounds = sourceSkinned.localBounds;

            SetupOutlineRenderer(smr);
            outlineMeshObj.layer = source.gameObject.layer;
        }
    }

    private void SetupOutlineRenderer(Renderer renderer)
    {
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        renderer.lightProbeUsage = LightProbeUsage.Off;
        renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
        renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
        renderer.allowOcclusionWhenDynamic = false;

        if (renderer.sharedMaterial != null)
        {
            renderer.sharedMaterial.renderQueue = 3001;
        }
    }

    private void ApplyGlowToMaterial(Material mat, Color glowColor, float glowIntensity,
                                     float outlineWidth, float transparency)
    {
        if (mat == null) return;

        if (mat.HasProperty(GlowColorId))
        {
            mat.SetColor(GlowColorId, glowColor);
        }

        if (mat.HasProperty(GlowIntensityId))
        {
            mat.SetFloat(GlowIntensityId, glowIntensity);
        }

        if (mat.HasProperty(OutlineWidthId))
        {
            mat.SetFloat(OutlineWidthId, outlineWidth);
        }

        if (mat.HasProperty(TransparencyId))
        {
            mat.SetFloat(TransparencyId, transparency);
        }
    }

    private void OnDisable()
    {
        SetOutlineActive(false);
    }

    private void OnDestroy()
    {
        SetOutlineActive(false);
    }
}