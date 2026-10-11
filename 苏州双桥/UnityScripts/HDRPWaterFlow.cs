using UnityEngine;

public class HDRPWaterFlow : MonoBehaviour
{
    [Header("基础流动")]
    [Tooltip("主要流动速度，建议0.01-0.05")]
    public Vector2 mainFlowSpeed = new Vector2(0.02f, 0.01f);

    [Header("波动设置")]
    [Tooltip("叠加的波动速度，制造不规则感")]
    public Vector2 waveSpeed = new Vector2(0.05f, 0.03f);
    [Tooltip("波动强度")]
    public float waveStrength = 0.3f;
    [Tooltip("波动变化频率")]
    public float waveFrequency = 0.5f;

    [Header("法线贴图分层")]
    [Tooltip("第二法线贴图速度（如果有的话）")]
    public Vector2 normal2Speed = new Vector2(-0.01f, 0.02f);

    private Material waterMaterial;
    private Vector2 mainOffset;
    private Vector2 waveOffset;
    private Vector2 normal2Offset;
    private float time;

    void Start()
    {
        waterMaterial = GetComponent<Renderer>().material;
    }

    void Update()
    {
        time += Time.deltaTime;

        // 1. 主流动 - 超慢速平移
        mainOffset += mainFlowSpeed * Time.deltaTime;

        // 2. 叠加正弦波动 - 让水有"呼吸感"而不是直线移动
        Vector2 waveOffset = new Vector2(
            Mathf.Sin(time * waveFrequency) * waveStrength,
            Mathf.Cos(time * waveFrequency * 0.7f) * waveStrength
        ) * 0.01f; // 控制波动幅度

        // 3. 第二法线贴图反向/差速流动（增加层次感）
        normal2Offset += normal2Speed * Time.deltaTime;

        // 应用偏移
        // 主法线：基础流动 + 波动
        waterMaterial.SetTextureOffset("_NormalMap", mainOffset + waveOffset);

        // 基础颜色贴图：稍微慢一点，制造视差感
        waterMaterial.SetTextureOffset("_BaseColorMap", mainOffset * 0.5f);

        // 第二法线（如果有）：反向流动
        if (waterMaterial.HasTexture("_NormalMap2") || waterMaterial.HasTexture("_DetailNormalMap"))
        {
            waterMaterial.SetTextureOffset("_DetailNormalMap", normal2Offset);
        }
    }
}