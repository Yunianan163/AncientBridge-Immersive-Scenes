using UnityEngine;
using System.Collections.Generic;

public class SeasonalTree : MonoBehaviour
{
    [Header("=== 季节颜色设置 ===")]
    public Color springColor = new Color(0.4f, 0.8f, 0.3f, 1f);
    public Color summerColor = new Color(0.1f, 0.5f, 0.1f, 1f);
    public Color autumnColor = new Color(0.9f, 0.6f, 0.1f, 1f);

    [Header("=== 是否启动时默认春天 ===")]
    public bool setSpringOnStart = true;

    [Header("=== 冬天雪花特效（拖入 Particle System） ===")]
    public ParticleSystem[] snowEffects;

    private bool isWinter = false;
    private List<RendererRecord> rendererRecords = new List<RendererRecord>();

    [System.Serializable]
    private class RendererRecord
    {
        public Renderer renderer;
        public MeshFilter meshFilter;
        public Mesh originalMesh;
        public Mesh runtimeMesh;

        public List<int> leafMaterialIndices = new List<int>();
        public Dictionary<int, int[]> originalSubmeshTriangles = new Dictionary<int, int[]>();

        public bool isLeafOnlyRenderer = false;
        public bool hasAnyLeaf = false;
        public bool meshReadable = false;
    }

    void Start()
    {
        ScanAllRenderers();

        // 启动时先统一关闭雪花，避免初始残留
        SetSnowEffect(false);

        if (setSpringOnStart)
        {
            ChangeSeason("spring");
        }
    }

    void ScanAllRenderers()
    {
        rendererRecords.Clear();

        Renderer[] allRenderers = GetComponentsInChildren<Renderer>(true);
        Debug.Log($"[SeasonalTree] {gameObject.name} 下找到 Renderer 数量: {allRenderers.Length}");

        foreach (Renderer r in allRenderers)
        {
            if (r == null) continue;

            MeshFilter mf = r.GetComponent<MeshFilter>();
            Material[] materials = r.sharedMaterials;

            if (materials == null || materials.Length == 0) continue;

            RendererRecord record = new RendererRecord();
            record.renderer = r;
            record.meshFilter = mf;

            int leafCount = 0;
            int nonLeafCount = 0;

            Debug.Log($"=== 分析 Renderer: {r.name} ===");

            for (int i = 0; i < materials.Length; i++)
            {
                if (materials[i] == null) continue;

                string matName = materials[i].name.ToLower();
                Debug.Log($"[{r.name}] 材质槽 {i}: {matName}");

                if (IsLeafMaterial(matName))
                {
                    record.leafMaterialIndices.Add(i);
                    leafCount++;
                    Debug.Log($"    -> 识别为叶子材质");
                }
                else
                {
                    nonLeafCount++;
                }
            }

            record.hasAnyLeaf = record.leafMaterialIndices.Count > 0;
            record.isLeafOnlyRenderer = (leafCount > 0 && nonLeafCount == 0);

            if (record.hasAnyLeaf && mf != null && mf.sharedMesh != null)
            {
                record.originalMesh = mf.sharedMesh;
                record.meshReadable = record.originalMesh.isReadable;

                if (!record.meshReadable)
                {
                    Debug.LogError(
                        $"[SeasonalTree] Mesh {record.originalMesh.name} 不可读写！" +
                        $"请到 Project 面板选中模型资源，在 Model 导入设置里勾选 Read/Write Enabled，然后点 Apply。");
                }
                else
                {
                    record.runtimeMesh = Instantiate(record.originalMesh);
                    record.runtimeMesh.name = record.originalMesh.name + "_RuntimeClone";
                    mf.mesh = record.runtimeMesh;

                    int subMeshCount = record.runtimeMesh.subMeshCount;
                    Debug.Log($"[{r.name}] subMeshCount = {subMeshCount}");

                    for (int i = 0; i < subMeshCount; i++)
                    {
                        record.originalSubmeshTriangles[i] = record.runtimeMesh.GetTriangles(i);
                        Debug.Log($"[{r.name}] submesh {i} 原始三角面数量: {record.originalSubmeshTriangles[i].Length}");
                    }
                }
            }

            if (record.hasAnyLeaf)
            {
                rendererRecords.Add(record);
                Debug.Log($"[SeasonalTree] 记录 Renderer: {r.name}，叶子槽 = [{string.Join(", ", record.leafMaterialIndices)}]，纯叶子 Renderer = {record.isLeafOnlyRenderer}");
            }
        }

        Debug.Log($"[SeasonalTree] 最终参与季节控制的 Renderer 数量: {rendererRecords.Count}");
    }

    bool IsLeafMaterial(string matName)
    {
        return matName.Contains("leaf") || matName.Contains("leaves") || matName.Contains("foliage");
    }

    public void ChangeSeason(string season)
    {
        string seasonLower = season.ToLower().Trim();
        Debug.Log($"[SeasonalTree] {gameObject.name} 切换季节到: {seasonLower}");

        // 先统一关闭冬天状态和雪花
        isWinter = false;
        SetSnowEffect(false);

        switch (seasonLower)
        {
            case "spring":
            case "春":
                ShowLeaves(true);
                SetLeafColor(springColor);
                break;

            case "summer":
            case "夏":
                ShowLeaves(true);
                SetLeafColor(summerColor);
                break;

            case "autumn":
            case "秋":
                ShowLeaves(true);
                SetLeafColor(autumnColor);
                break;

            case "winter":
            case "冬":
                isWinter = true;
                ShowLeaves(false);
                SetSnowEffect(true);
                break;

            default:
                Debug.LogWarning($"[SeasonalTree] 未知季节参数: {season}");
                break;
        }
    }

    void ShowLeaves(bool show)
    {
        foreach (RendererRecord record in rendererRecords)
        {
            if (record.renderer == null) continue;

            // 如果整个 Renderer 都是叶子，直接开关它
            if (record.isLeafOnlyRenderer)
            {
                record.renderer.enabled = show;
                Debug.Log(show
                    ? $"[SeasonalTree] 恢复纯叶子 Renderer: {record.renderer.name}"
                    : $"[SeasonalTree] 关闭纯叶子 Renderer: {record.renderer.name}");
                continue;
            }

            // 如果叶子和树干共用一个 Mesh，用 submesh 方式处理
            if (record.runtimeMesh == null)
            {
                Debug.LogWarning($"[SeasonalTree] {record.renderer.name} 没有可用的 runtimeMesh，无法通过 submesh 隐藏叶子。");
                continue;
            }

            int subMeshCount = record.runtimeMesh.subMeshCount;

            foreach (int leafSubmeshIndex in record.leafMaterialIndices)
            {
                if (leafSubmeshIndex < 0 || leafSubmeshIndex >= subMeshCount)
                {
                    Debug.LogWarning($"[SeasonalTree] {record.renderer.name} 的叶子索引 {leafSubmeshIndex} 超出 submesh 范围");
                    continue;
                }

                if (show)
                {
                    if (record.originalSubmeshTriangles.ContainsKey(leafSubmeshIndex))
                    {
                        record.runtimeMesh.SetTriangles(record.originalSubmeshTriangles[leafSubmeshIndex], leafSubmeshIndex);
                        Debug.Log($"[SeasonalTree] 恢复 {record.renderer.name} 的叶子 submesh {leafSubmeshIndex}");
                    }
                }
                else
                {
                    record.runtimeMesh.SetTriangles(System.Array.Empty<int>(), leafSubmeshIndex);
                    Debug.Log($"[SeasonalTree] 清空 {record.renderer.name} 的叶子 submesh {leafSubmeshIndex}");
                }
            }
        }

        Debug.Log(show ? "[SeasonalTree] 显示叶子" : "[SeasonalTree] 冬天彻底移除叶子");
    }

    void SetLeafColor(Color targetColor)
    {
        if (isWinter) return;

        foreach (RendererRecord record in rendererRecords)
        {
            if (record.renderer == null) continue;

            Material[] materials = record.renderer.sharedMaterials;
            if (materials == null || materials.Length == 0) continue;

            MaterialPropertyBlock block = new MaterialPropertyBlock();

            foreach (int index in record.leafMaterialIndices)
            {
                if (index < 0 || index >= materials.Length) continue;

                Material mat = materials[index];
                if (mat == null) continue;

                block.Clear();
                record.renderer.GetPropertyBlock(block, index);

                if (mat.HasProperty("_BaseColor"))
                {
                    Color c = targetColor;
                    c.a = 1f;
                    block.SetColor("_BaseColor", c);
                }

                if (mat.HasProperty("_Color"))
                {
                    Color c = targetColor;
                    c.a = 1f;
                    block.SetColor("_Color", c);
                }

                record.renderer.SetPropertyBlock(block, index);
            }
        }
    }

    void SetSnowEffect(bool active)
    {
        if (snowEffects == null || snowEffects.Length == 0) return;

        foreach (ParticleSystem ps in snowEffects)
        {
            if (ps == null) continue;

            if (active)
            {
                if (!ps.gameObject.activeSelf)
                    ps.gameObject.SetActive(true);

                ps.Clear();
                ps.Play();
            }
            else
            {
                ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
                ps.Clear();
                ps.gameObject.SetActive(false);
            }
        }

        Debug.Log(active ? "[SeasonalTree] 开启雪花特效" : "[SeasonalTree] 关闭雪花特效");
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Alpha1)) ChangeSeason("spring");
        if (Input.GetKeyDown(KeyCode.Alpha2)) ChangeSeason("summer");
        if (Input.GetKeyDown(KeyCode.Alpha3)) ChangeSeason("autumn");
        if (Input.GetKeyDown(KeyCode.Alpha4)) ChangeSeason("winter");
    }

    public void SetSpring() => ChangeSeason("spring");
    public void SetSummer() => ChangeSeason("summer");
    public void SetAutumn() => ChangeSeason("autumn");
    public void SetWinter() => ChangeSeason("winter");
}