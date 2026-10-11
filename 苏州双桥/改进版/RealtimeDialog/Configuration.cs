namespace RealtimeDialog
{
    /// <summary>
    /// 客户端配置
    /// </summary>
    public class ClientConfig
    {
        /// <summary>
        /// WebSocket URL
        /// </summary>
        public string WebSocketUrl { get; set; } = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";

        /// <summary>
        /// App ID
        /// </summary>
        public string AppId { get; set; } = "";

        /// <summary>
        /// Access Token
        /// </summary>
        public string AccessToken { get; set; } = "";

        /// <summary>
        /// Secret Key（用于某些签名场景）
        /// </summary>
        public string SecretKey { get; set; } = "";

        /// <summary>
        /// App Key（X-Api-App-Key 请求头）。
        /// ⚠️ 不要写死在源码里 —— 由 Program.cs 从环境变量 VOICE_APP_KEY 注入。
        /// </summary>
        public string AppKey { get; set; } = "";
    }

    /// <summary>
    /// 音频配置
    /// </summary>
    public class AudioConfiguration
    {
        /// <summary>
        /// 输入音频格式: pcm 或 speech_opus
        /// </summary>
        public string InputFormat { get; set; } = "pcm";

        /// <summary>
        /// 输入采样率
        /// </summary>
        public int InputSampleRate { get; set; } = 16000;

        /// <summary>
        /// 输入声道数
        /// </summary>
        public int InputChannels { get; set; } = 1;

        /// <summary>
        /// 输出音频格式: ogg, pcm, pcm_s16le
        /// </summary>
        public string OutputFormat { get; set; } = "pcm_s16le";

        /// <summary>
        /// 输出采样率
        /// </summary>
        public int OutputSampleRate { get; set; } = 24000;

        /// <summary>
        /// 输出声道数
        /// </summary>
        public int OutputChannels { get; set; } = 1;

        /// <summary>
        /// 语速 (-50 到 100)
        /// </summary>
        public int? SpeechRate { get; set; }

        /// <summary>
        /// 音量 (-50 到 100)
        /// </summary>
        public int? LoudnessRate { get; set; }
    }

    /// <summary>
    /// 音色选项
    /// </summary>
    public static class VoiceSpeakers
    {
        // 自定义克隆音色
        public const string Custom = "S_tYw86oeY1";

        // O版本和O2.0版本音色
        public const string VV = "zh_female_vv_jupiter_bigtts";  // vv音色，活泼灵动的女声
        public const string XiaoHe = "zh_female_xiaohe_jupiter_bigtts";  // xiaohe音色，甜美活泼的女声（台湾口音）
        public const string YunZhou = "zh_male_yunzhou_jupiter_bigtts";  // yunzhou音色，清爽沉稳的男声
        public const string XiaoTian = "zh_male_xiaotian_jupiter_bigtts";  // xiaotian音色，清爽磁性的男声

        // 默认音色
        public const string Default = Custom;
    }

    /// <summary>
    /// 模型版本
    /// </summary>
    public static class ModelVersions
    {
        /// <summary>
        /// O2.0版本（规范版本号1.2.1.1）
        /// </summary>
        public const string O2_0 = "1.2.1.1";

        /// <summary>
        /// SC2.0版本（规范版本号2.2.0.0）
        /// </summary>
        public const string SC2_0 = "2.2.0.0";
    }

    /// <summary>
    /// 输入模式
    /// </summary>
    public static class InputModes
    {
        /// <summary>
        /// 麦克风静音保活模式
        /// </summary>
        public const string KeepAlive = "keep_alive";

        /// <summary>
        /// 麦克风按键输入模式
        /// </summary>
        public const string PushToTalk = "push_to_talk";

        /// <summary>
        /// 纯文本输入模式
        /// </summary>
        public const string Text = "text";

        /// <summary>
        /// 录音文件输入模式
        /// </summary>
        public const string AudioFile = "audio_file";
    }

    /// <summary>
    /// 搜索服务类型
    /// </summary>
    public static class WebSearchTypes
    {
        /// <summary>
        /// 普通版
        /// </summary>
        public const string Web = "web";

        /// <summary>
        /// 总结版
        /// </summary>
        public const string WebSummary = "web_summary";

        /// <summary>
        /// 搜索Agent
        /// </summary>
        public const string WebAgent = "web_agent";
    }

    /// <summary>
    /// TTS类型
    /// </summary>
    public static class TTSTypes
    {
        /// <summary>
        /// 命中安全审核音频
        /// </summary>
        public const string AuditContentRisky = "audit_content_risky";

        /// <summary>
        /// 客户文本合成音频
        /// </summary>
        public const string ChatTtsText = "chat_tts_text";

        /// <summary>
        /// 内置联网音频
        /// </summary>
        public const string Network = "network";

        /// <summary>
        /// 外部RAG总结音频
        /// </summary>
        public const string ExternalRag = "external_rag";

        /// <summary>
        /// 唱歌音频
        /// </summary>
        public const string Sing = "sing";

        /// <summary>
        /// 闲聊音频（默认）
        /// </summary>
        public const string Default = "default";
    }
}
