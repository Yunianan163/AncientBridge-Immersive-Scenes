using UnityEngine;
using UnityEngine.Rendering;
using System.Collections;

public class SeasonManager : MonoBehaviour
{
    [Header("=== HDRI天空贴图 (Cubemap) ===")]
    public Cubemap springSummerHDRI;    // 春天/夏天共用
    public Cubemap autumnWinterHDRI;    // 秋天/冬天共用

    [Header("=== 太阳光设置 (URP强度: 建议5-10) ===")]
    public float springSunIntensity = 8.0f;      // 提高！
    public float summerSunIntensity = 10.0f;     // 提高！
    public float autumnSunIntensity = 6.0f;      // 提高！
    public float winterSunIntensity = 5.0f;      // 提高！

    public Color springSunColor = Color.white;
    public Color summerSunColor = new Color(1f, 0.95f, 0.8f);
    public Color autumnSunColor = new Color(1f, 0.9f, 0.7f);
    public Color winterSunColor = new Color(0.85f, 0.9f, 1f);

    [Header("=== 环境光强度 (Ambient Intensity) ===")]
    public float springAmbient = 1.0f;
    public float summerAmbient = 1.2f;
    public float autumnAmbient = 0.8f;
    public float winterAmbient = 0.7f;

    [Header("=== 雾效设置 ===")]
    public bool enableFog = true;
    public Color springFogColor = new Color(0.8f, 0.9f, 1f);
    public Color summerFogColor = new Color(0.9f, 0.95f, 1f);
    public Color autumnFogColor = new Color(0.9f, 0.8f, 0.6f);
    public Color winterFogColor = new Color(0.9f, 0.9f, 0.95f);

    [Header("=== 雾效密度 (建议 0.001-0.01) ===")]
    public float springFogDensity = 0.002f;   // 降低！
    public float summerFogDensity = 0.001f;   // 降低！
    public float autumnFogDensity = 0.005f;   // 降低！
    public float winterFogDensity = 0.008f;   // 降低！

    [Header("=== 冬天雪花粒子 ===")]
    public ParticleSystem snowParticleBig;
    public ParticleSystem snowParticleMedium;
    public ParticleSystem snowParticleSmall;

    [Header("=== 季节树木 ===")]
    public SeasonalTree[] seasonalTrees;

    private Material skyboxMaterial;
    private string currentSeason = "spring";
    private Light directionalLight;
    private float originalIntensity;  // 记录原始光照强度

    void Awake()
    {
        Debug.Log("⚡ [SeasonManager] Awake 被调用！");
    }

    void Start()
    {
        Debug.Log("🚀 [SeasonManager] Start 开始执行...");

        // 查找主光源
        FindDirectionalLight();

        // 记录原始光照设置
        SaveOriginalSettings();

        // 创建或使用现有天空盒材质
        SetupSkyboxMaterial();

        // 自动查找树木
        AutoFindTrees();

        // 默认切换到春天
        Debug.Log("🔄 [SeasonManager] 准备切换到春天...");
        ChangeSeason("spring");

        Debug.Log("✅ [SeasonManager] Start 执行完毕！");
    }

    void FindDirectionalLight()
    {
        // 先尝试通过名称查找
        directionalLight = GameObject.Find("Directional Light")?.GetComponent<Light>();

        // 找不到则查找任意平行光
        if (directionalLight == null)
        {
            Light[] lights = FindObjectsByType<Light>(FindObjectsSortMode.None);
            foreach (Light light in lights)
            {
                if (light.type == LightType.Directional)
                {
                    directionalLight = light;
                    break;
                }
            }
        }

        if (directionalLight != null)
        {
            originalIntensity = directionalLight.intensity;
            Debug.Log($"🔍 [SeasonManager] 找到 Directional Light: {directionalLight.name}, 原始强度: {originalIntensity}");
        }
        else
        {
            Debug.LogError("❌ [SeasonManager] 未找到 Directional Light！");
        }
    }

    void SaveOriginalSettings()
    {
        // 保存原始设置以便调试
        Debug.Log($"💾 [SeasonManager] 保存原始设置 - 环境光: {RenderSettings.ambientIntensity}, 雾效: {RenderSettings.fog}");
    }

    void SetupSkyboxMaterial()
    {
        // 优先使用现有的天空盒材质
        if (RenderSettings.skybox != null)
        {
            skyboxMaterial = RenderSettings.skybox;
            Debug.Log($"✅ [SeasonManager] 使用现有天空盒: {skyboxMaterial.name}, Exposure: {skyboxMaterial.GetFloat("_Exposure")}");
        }
        else
        {
            // 创建新的天空盒材质
            skyboxMaterial = new Material(Shader.Find("Skybox/Cubemap"));
            skyboxMaterial.SetFloat("_Rotation", 0);
            RenderSettings.skybox = skyboxMaterial;
            Debug.Log("✅ [SeasonManager] 创建新的天空盒材质");
        }
    }

    void AutoFindTrees()
    {
        if (seasonalTrees == null || seasonalTrees.Length == 0)
        {
            seasonalTrees = FindObjectsByType<SeasonalTree>(
                FindObjectsInactive.Include,
                FindObjectsSortMode.None
            );
            Debug.Log($"🌳 [SeasonManager] 自动找到 SeasonalTree 数量: {seasonalTrees.Length}");
        }
    }

    public void ChangeSeason(string season)
    {
        Debug.Log($"🎯 [SeasonManager] ChangeSeason 被调用，参数: {season}");

        if (string.IsNullOrWhiteSpace(season))
        {
            Debug.LogWarning("⚠️ [SeasonManager] 收到空季节参数");
            return;
        }

        string normalizedSeason = NormalizeSeasonKey(season);
        if (string.IsNullOrEmpty(normalizedSeason))
        {
            Debug.LogWarning($"❌ [SeasonManager] 无法识别的季节: {season}");
            return;
        }

        currentSeason = normalizedSeason;
        Debug.Log($"🔄 [SeasonManager] 切换季节到: {currentSeason}");

        switch (currentSeason)
        {
            case "spring":
                ApplySpring();
                break;
            case "summer":
                ApplySummer();
                break;
            case "autumn":
                ApplyAutumn();
                break;
            case "winter":
                ApplyWinter();
                break;
        }

        UpdateTreesSeason(currentSeason);
    }

    string NormalizeSeasonKey(string season)
    {
        string s = season.Trim().ToLower();
        switch (s)
        {
            case "spring":
            case "春":
            case "春天":
                return "spring";
            case "summer":
            case "夏":
            case "夏天":
                return "summer";
            case "autumn":
            case "fall":
            case "秋":
            case "秋天":
                return "autumn";
            case "winter":
            case "冬":
            case "冬天":
                return "winter";
            default:
                return "";
        }
    }

    void ApplySpring()
    {
        Debug.Log("🌸 [SeasonManager] 执行 ApplySpring()");
        SetSkybox(springSummerHDRI, "春天");
        SetSunLight(springSunIntensity, springSunColor);
        SetAmbientLight(springAmbient);
        SetFog(springFogColor, springFogDensity);
        SetSnowParticles(false);
    }

    void ApplySummer()
    {
        Debug.Log("☀️ [SeasonManager] 执行 ApplySummer()");
        SetSkybox(springSummerHDRI, "夏天");
        SetSunLight(summerSunIntensity, summerSunColor);
        SetAmbientLight(summerAmbient);
        SetFog(summerFogColor, summerFogDensity);
        SetSnowParticles(false);
    }

    void ApplyAutumn()
    {
        Debug.Log("🍂 [SeasonManager] 执行 ApplyAutumn()");
        SetSkybox(autumnWinterHDRI, "秋天");
        SetSunLight(autumnSunIntensity, autumnSunColor);
        SetAmbientLight(autumnAmbient);
        SetFog(autumnFogColor, autumnFogDensity);
        SetSnowParticles(false);
    }

    void ApplyWinter()
    {
        Debug.Log("❄️ [SeasonManager] 执行 ApplyWinter()");
        SetSkybox(autumnWinterHDRI, "冬天");
        SetSunLight(winterSunIntensity, winterSunColor);
        SetAmbientLight(winterAmbient);
        SetFog(winterFogColor, winterFogDensity);
        SetSnowParticles(true);
    }

    void SetSkybox(Cubemap hdri, string seasonName)
    {
        if (hdri == null)
        {
            Debug.LogError($"❌ [SeasonManager] HDRI 贴图为空（{seasonName}）！");
            return;
        }

        if (skyboxMaterial == null)
        {
            SetupSkyboxMaterial();
        }

        // 只切换 Cubemap，保留 Inspector 中的 Exposure 设置
        skyboxMaterial.SetTexture("_Tex", hdri);
        RenderSettings.skybox = skyboxMaterial;
        DynamicGI.UpdateEnvironment();

        float currentExposure = skyboxMaterial.GetFloat("_Exposure");
        Debug.Log($"✅ [SeasonManager] 已设置 {seasonName} 天空: {hdri.name}, Exposure: {currentExposure}");
    }

    void SetSunLight(float intensity, Color color)
    {
        if (directionalLight == null)
        {
            Debug.LogError("❌ [SeasonManager] Directional Light 为空，无法设置光照");
            return;
        }

        // 设置强度和颜色
        directionalLight.intensity = intensity;
        directionalLight.color = color;

        // 确保光照模式正确
        directionalLight.type = LightType.Directional;

        Debug.Log($"☀️ [SeasonManager] 设置太阳光 - 强度: {intensity}, 颜色: {color}, 当前实际强度: {directionalLight.intensity}");
    }

    void SetAmbientLight(float intensity)
    {
        // 设置环境光强度
        RenderSettings.ambientIntensity = intensity;
        RenderSettings.ambientMode = AmbientMode.Skybox;  // 使用天空盒作为环境光源

        Debug.Log($"💡 [SeasonManager] 设置环境光强度: {intensity}");
    }

    void SetFog(Color color, float density)
    {
        if (!enableFog)
        {
            RenderSettings.fog = false;
            Debug.Log("🌫️ [SeasonManager] 雾效已禁用");
            return;
        }

        RenderSettings.fog = true;
        RenderSettings.fogColor = color;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogDensity = density;

        Debug.Log($"🌫️ [SeasonManager] 设置雾 - 颜色: {color}, 密度: {density}");
    }

    void UpdateTreesSeason(string season)
    {
        if (seasonalTrees == null || seasonalTrees.Length == 0)
            return;

        foreach (SeasonalTree tree in seasonalTrees)
        {
            if (tree != null)
                tree.ChangeSeason(season);
        }
    }

    void SetSnowParticles(bool enable)
    {
        ControlParticle(snowParticleBig, enable);
        ControlParticle(snowParticleMedium, enable);
        ControlParticle(snowParticleSmall, enable);
        Debug.Log(enable ? "❄️ [SeasonManager] 开启雪花" : "🚫 [SeasonManager] 关闭雪花");
    }

    void ControlParticle(ParticleSystem ps, bool enable)
    {
        if (ps == null) return;

        if (enable)
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

    // 调试方法：打印当前光照状态
    [ContextMenu("打印光照状态")]
    void PrintLightStatus()
    {
        if (directionalLight != null)
        {
            Debug.Log($"☀️ Directional Light - 强度: {directionalLight.intensity}, 颜色: {directionalLight.color}");
        }
        Debug.Log($"💡 环境光强度: {RenderSettings.ambientIntensity}");
        Debug.Log($"🌫️ 雾效: {RenderSettings.fog}, 密度: {RenderSettings.fogDensity}");
    }

    // 公共方法供 WebSocket 调用
    public void SetSpring() => ChangeSeason("spring");
    public void SetSummer() => ChangeSeason("summer");
    public void SetAutumn() => ChangeSeason("autumn");
    public void SetWinter() => ChangeSeason("winter");
}