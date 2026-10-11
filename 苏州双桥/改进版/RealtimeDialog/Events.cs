using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RealtimeDialog
{
    #region 请求事件模型

    /// <summary>
    /// StartSession请求
    /// </summary>
    public class StartSessionRequest
    {
        [JsonProperty("asr")]
        public AsrConfig? Asr { get; set; }

        [JsonProperty("tts")]
        public TtsConfig? Tts { get; set; }

        [JsonProperty("dialog")]
        public DialogConfig? Dialog { get; set; }
    }

    public class AsrConfig
    {
        [JsonProperty("audio_info")]
        public AudioInfo? AudioInfo { get; set; }

        [JsonProperty("extra")]
        public AsrExtra? Extra { get; set; }
    }

    public class AudioInfo
    {
        [JsonProperty("format")]
        public string? Format { get; set; } = "pcm";  // pcm 或 speech_opus

        [JsonProperty("sample_rate")]
        public int SampleRate { get; set; } = 16000;

        [JsonProperty("channel")]
        public int Channel { get; set; } = 1;
    }

    public class AsrExtra
    {
        [JsonProperty("end_smooth_window_ms")]
        public int? EndSmoothWindowMs { get; set; }

        [JsonProperty("enable_custom_vad")]
        public bool? EnableCustomVad { get; set; }

        [JsonProperty("enable_asr_twopass")]
        public bool? EnableAsrTwopass { get; set; }

        [JsonProperty("boosting_table_id")]
        public string? BoostingTableId { get; set; }

        [JsonProperty("boosting_table_name")]
        public string? BoostingTableName { get; set; }

        [JsonProperty("regex_correct_table_id")]
        public string? RegexCorrectTableId { get; set; }

        [JsonProperty("regex_correct_table_name")]
        public string? RegexCorrectTableName { get; set; }

        [JsonProperty("context")]
        public AsrContext? Context { get; set; }
    }

    public class AsrContext
    {
        [JsonProperty("hotwords")]
        public List<Hotword>? Hotwords { get; set; }

        [JsonProperty("correct_words")]
        public Dictionary<string, string>? CorrectWords { get; set; }
    }

    public class Hotword
    {
        [JsonProperty("word")]
        public string? Word { get; set; }
    }

    public class TtsConfig
    {
        [JsonProperty("speaker")]
        public string? Speaker { get; set; }

        [JsonProperty("audio_config")]
        public TtsAudioConfig? AudioConfig { get; set; }
    }

    public class TtsAudioConfig
    {
        [JsonProperty("channel")]
        public int Channel { get; set; } = 1;

        [JsonProperty("format")]
        public string? Format { get; set; } = "ogg";  // ogg, pcm, pcm_s16le

        [JsonProperty("sample_rate")]
        public int SampleRate { get; set; } = 24000;

        [JsonProperty("speech_rate")]
        public int? SpeechRate { get; set; }

        [JsonProperty("loudness_rate")]
        public int? LoudnessRate { get; set; }
    }

    public class DialogConfig
    {
        [JsonProperty("bot_name")]
        public string? BotName { get; set; }

        [JsonProperty("system_role")]
        public string? SystemRole { get; set; }

        [JsonProperty("speaking_style")]
        public string? SpeakingStyle { get; set; }

        [JsonProperty("dialog_id")]
        public string? DialogId { get; set; }

        [JsonProperty("character_manifest")]
        public string? CharacterManifest { get; set; }

        [JsonProperty("location")]
        public LocationInfo? Location { get; set; }

        [JsonProperty("dialog_context")]
        public List<DialogContextItem>? DialogContext { get; set; }

        [JsonProperty("extra")]
        public DialogExtra? Extra { get; set; }
    }

    public class LocationInfo
    {
        [JsonProperty("longitude")]
        public double? Longitude { get; set; }

        [JsonProperty("latitude")]
        public double? Latitude { get; set; }

        [JsonProperty("city")]
        public string? City { get; set; }

        [JsonProperty("country")]
        public string? Country { get; set; } = "中国";

        [JsonProperty("province")]
        public string? Province { get; set; }

        [JsonProperty("district")]
        public string? District { get; set; }

        [JsonProperty("town")]
        public string? Town { get; set; }

        [JsonProperty("country_code")]
        public string? CountryCode { get; set; } = "CN";

        [JsonProperty("address")]
        public string? Address { get; set; }
    }

    public class DialogContextItem
    {
        [JsonProperty("role")]
        public string? Role { get; set; }  // user 或 assistant

        [JsonProperty("text")]
        public string? Text { get; set; }

        [JsonProperty("timestamp")]
        public long? Timestamp { get; set; }
    }

    public class DialogExtra
    {
        [JsonProperty("strict_audit")]
        public bool? StrictAudit { get; set; } = true;

        [JsonProperty("audit_response")]
        public string? AuditResponse { get; set; }

        [JsonProperty("enable_volc_websearch")]
        public bool? EnableVolcWebSearch { get; set; }

        [JsonProperty("volc_websearch_type")]
        public string? VolcWebSearchType { get; set; }  // web, web_summary, web_agent

        [JsonProperty("volc_websearch_api_key")]
        public string? VolcWebSearchApiKey { get; set; }

        [JsonProperty("volc_websearch_result_count")]
        public int? VolcWebSearchResultCount { get; set; }

        [JsonProperty("volc_websearch_no_result_message")]
        public string? VolcWebSearchNoResultMessage { get; set; }

        [JsonProperty("input_mod")]
        public string? InputMod { get; set; }  // keep_alive, push_to_talk, text, audio_file

        [JsonProperty("enable_music")]
        public bool? EnableMusic { get; set; }

        [JsonProperty("enable_loudness_norm")]
        public bool? EnableLoudnessNorm { get; set; }

        [JsonProperty("enable_conversation_truncate")]
        public bool? EnableConversationTruncate { get; set; }

        [JsonProperty("enable_user_query_exit")]
        public bool? EnableUserQueryExit { get; set; }

        [JsonProperty("model")]
        public string? Model { get; set; }  // 1.2.1.1 (O2.0) 或 2.2.0.0 (SC2.0)
    }

    /// <summary>
    /// UpdateConfig请求
    /// </summary>
    public class UpdateConfigRequest
    {
        [JsonProperty("tts")]
        public TtsUpdateConfig? Tts { get; set; }

        [JsonProperty("dialog")]
        public DialogUpdateConfig? Dialog { get; set; }
    }

    public class TtsUpdateConfig
    {
        [JsonProperty("speaker")]
        public string? Speaker { get; set; }
    }

    public class DialogUpdateConfig
    {
        [JsonProperty("bot_name")]
        public string? BotName { get; set; }

        [JsonProperty("system_role")]
        public string? SystemRole { get; set; }

        [JsonProperty("speaking_style")]
        public string? SpeakingStyle { get; set; }

        [JsonProperty("dialog_id")]
        public string? DialogId { get; set; }

        [JsonProperty("location")]
        public LocationInfo? Location { get; set; }
    }

    /// <summary>
    /// SayHello请求
    /// </summary>
    public class SayHelloRequest
    {
        [JsonProperty("content")]
        public string? Content { get; set; }
    }

    /// <summary>
    /// ChatTTSText请求
    /// </summary>
    public class ChatTTSTextRequest
    {
        [JsonProperty("start")]
        public bool Start { get; set; }

        [JsonProperty("content")]
        public string? Content { get; set; }

        [JsonProperty("end")]
        public bool End { get; set; }
    }

    /// <summary>
    /// ChatTextQuery请求
    /// </summary>
    public class ChatTextQueryRequest
    {
        [JsonProperty("content")]
        public string? Content { get; set; }
    }

    /// <summary>
    /// ChatRAGText请求
    /// </summary>
    public class ChatRAGTextRequest
    {
        [JsonProperty("external_rag")]
        public string? ExternalRag { get; set; }
    }

    public class ExternalRagItem
    {
        [JsonProperty("title")]
        public string? Title { get; set; }

        [JsonProperty("content")]
        public string? Content { get; set; }
    }

    /// <summary>
    /// ConversationCreate请求
    /// </summary>
    public class ConversationCreateRequest
    {
        [JsonProperty("items")]
        public List<ConversationItem>? Items { get; set; }
    }

    public class ConversationItem
    {
        [JsonProperty("role")]
        public string? Role { get; set; }

        [JsonProperty("text")]
        public string? Text { get; set; }

        [JsonProperty("timestamp")]
        public long? Timestamp { get; set; }

        [JsonProperty("item_id")]
        public string? ItemId { get; set; }
    }

    /// <summary>
    /// ConversationUpdate请求
    /// </summary>
    public class ConversationUpdateRequest
    {
        [JsonProperty("items")]
        public List<ConversationUpdateItem>? Items { get; set; }
    }

    public class ConversationUpdateItem
    {
        [JsonProperty("item_id")]
        public string? ItemId { get; set; }

        [JsonProperty("text")]
        public string? Text { get; set; }
    }

    /// <summary>
    /// ConversationRetrieve请求
    /// </summary>
    public class ConversationRetrieveRequest
    {
        [JsonProperty("items")]
        public List<ConversationRetrieveItem>? Items { get; set; }
    }

    public class ConversationRetrieveItem
    {
        [JsonProperty("item_id")]
        public string? ItemId { get; set; }
    }

    /// <summary>
    /// ConversationTruncate请求
    /// </summary>
    public class ConversationTruncateRequest
    {
        [JsonProperty("item_id")]
        public string? ItemId { get; set; }

        [JsonProperty("audio_end_ms")]
        public int AudioEndMs { get; set; }
    }

    /// <summary>
    /// ConversationDelete请求
    /// </summary>
    public class ConversationDeleteRequest
    {
        [JsonProperty("items")]
        public List<ConversationDeleteItem>? Items { get; set; }
    }

    public class ConversationDeleteItem
    {
        [JsonProperty("item_id")]
        public string? ItemId { get; set; }
    }

    #endregion

    #region 响应事件模型

    /// <summary>
    /// SessionStarted响应
    /// </summary>
    public class SessionStartedResponse
    {
        [JsonProperty("dialog_id")]
        public string? DialogId { get; set; }
    }

    /// <summary>
    /// Error响应
    /// </summary>
    public class ErrorResponse
    {
        [JsonProperty("error")]
        public string? Error { get; set; }

        [JsonProperty("status_code")]
        public string? StatusCode { get; set; }

        [JsonProperty("message")]
        public string? Message { get; set; }
    }

    /// <summary>
    /// TTSSentenceStart响应
    /// </summary>
    public class TTSSentenceStartResponse
    {
        [JsonProperty("tts_type")]
        public string? TtsType { get; set; }

        [JsonProperty("text")]
        public string? Text { get; set; }

        [JsonProperty("question_id")]
        public string? QuestionId { get; set; }

        [JsonProperty("reply_id")]
        public string? ReplyId { get; set; }
    }

    /// <summary>
    /// TTSSentenceEnd响应
    /// </summary>
    public class TTSSentenceEndResponse
    {
        [JsonProperty("question_id")]
        public string? QuestionId { get; set; }

        [JsonProperty("reply_id")]
        public string? ReplyId { get; set; }
    }

    /// <summary>
    /// TTSEnded响应
    /// </summary>
    public class TTSEndedResponse
    {
        [JsonProperty("question_id")]
        public string? QuestionId { get; set; }

        [JsonProperty("reply_id")]
        public string? ReplyId { get; set; }

        [JsonProperty("status_code")]
        public string? StatusCode { get; set; }
    }

    /// <summary>
    /// ASRInfo响应
    /// </summary>
    public class ASRInfoResponse
    {
        [JsonProperty("question_id")]
        public string? QuestionId { get; set; }
    }

    /// <summary>
    /// ASRResponse响应
    /// </summary>
    public class ASRResponse
    {
        [JsonProperty("results")]
        public List<ASRResult>? Results { get; set; }
    }

    public class ASRResult
    {
        [JsonProperty("text")]
        public string? Text { get; set; }

        [JsonProperty("is_interim")]
        public bool IsInterim { get; set; }
    }

    /// <summary>
    /// ChatResponse响应
    /// </summary>
    public class ChatResponse
    {
        [JsonProperty("content")]
        public string? Content { get; set; }

        [JsonProperty("question_id")]
        public string? QuestionId { get; set; }

        [JsonProperty("reply_id")]
        public string? ReplyId { get; set; }
    }

    /// <summary>
    /// ChatTextQueryConfirmed响应
    /// </summary>
    public class ChatTextQueryConfirmedResponse
    {
        [JsonProperty("question_id")]
        public string? QuestionId { get; set; }
    }

    /// <summary>
    /// ChatEnded响应
    /// </summary>
    public class ChatEndedResponse
    {
        [JsonProperty("question_id")]
        public string? QuestionId { get; set; }

        [JsonProperty("reply_id")]
        public string? ReplyId { get; set; }
    }

    /// <summary>
    /// ConversationCreated响应
    /// </summary>
    public class ConversationCreatedResponse
    {
        [JsonProperty("items")]
        public List<ConversationItem>? Items { get; set; }
    }

    /// <summary>
    /// ConversationUpdated响应
    /// </summary>
    public class ConversationUpdatedResponse
    {
        [JsonProperty("message")]
        public string? Message { get; set; }
    }

    /// <summary>
    /// ConversationRetrieved响应
    /// </summary>
    public class ConversationRetrievedResponse
    {
        [JsonProperty("items")]
        public List<ConversationItem>? Items { get; set; }
    }

    /// <summary>
    /// ConversationDeleted响应
    /// </summary>
    public class ConversationDeletedResponse
    {
        [JsonProperty("items")]
        public List<ConversationItem>? Items { get; set; }

        [JsonProperty("status_code")]
        public int? StatusCode { get; set; }

        [JsonProperty("message")]
        public string? Message { get; set; }
    }

    /// <summary>
    /// DialogCommonError响应
    /// </summary>
    public class DialogCommonErrorResponse
    {
        [JsonProperty("status_code")]
        public string? StatusCode { get; set; }

        [JsonProperty("message")]
        public string? Message { get; set; }
    }

    /// <summary>
    /// Usage响应
    /// </summary>
    public class UsageResponse
    {
        [JsonProperty("usage")]
        public UsageInfo? Usage { get; set; }
    }

    public class UsageInfo
    {
        [JsonProperty("input_text_tokens")]
        public int InputTextTokens { get; set; }

        [JsonProperty("input_audio_tokens")]
        public int InputAudioTokens { get; set; }

        [JsonProperty("cached_text_tokens")]
        public int CachedTextTokens { get; set; }

        [JsonProperty("cached_audio_tokens")]
        public int CachedAudioTokens { get; set; }

        [JsonProperty("output_text_tokens")]
        public int OutputTextTokens { get; set; }

        [JsonProperty("output_audio_tokens")]
        public int OutputAudioTokens { get; set; }
    }

    #endregion

    #region 事件参数

    /// <summary>
    /// 服务端事件参数
    /// </summary>
    public class ServerEventArgs : EventArgs
    {
        public int EventId { get; set; }
        public string? SessionId { get; set; }
        public byte[]? RawPayload { get; set; }
    }

    /// <summary>
    /// 音频数据事件参数
    /// </summary>
    public class AudioDataEventArgs : EventArgs
    {
        public string? SessionId { get; set; }
        public byte[]? AudioData { get; set; }
    }

    /// <summary>
    /// ASR识别事件参数
    /// </summary>
    public class ASRResultEventArgs : EventArgs
    {
        public string? SessionId { get; set; }
        public string? Text { get; set; }
        public bool IsInterim { get; set; }
        public string? QuestionId { get; set; }
    }

    /// <summary>
    /// 聊天响应事件参数
    /// </summary>
    public class ChatResponseEventArgs : EventArgs
    {
        public string? SessionId { get; set; }
        public string? Content { get; set; }
        public string? QuestionId { get; set; }
        public string? ReplyId { get; set; }
    }

    /// <summary>
    /// TTS开始事件参数
    /// </summary>
    public class TTSStartEventArgs : EventArgs
    {
        public string? SessionId { get; set; }
        public string? TtsType { get; set; }
        public string? Text { get; set; }
        public string? QuestionId { get; set; }
        public string? ReplyId { get; set; }
    }

    /// <summary>
    /// TTS结束事件参数
    /// </summary>
    public class TTSEndEventArgs : EventArgs
    {
        public string? SessionId { get; set; }
        public string? QuestionId { get; set; }
        public string? ReplyId { get; set; }
        public string? StatusCode { get; set; }
        public bool IsUserExit => StatusCode == "20000002";
    }

    /// <summary>
    /// 错误事件参数
    /// </summary>
    public class ErrorEventArgs : EventArgs
    {
        public string? SessionId { get; set; }
        public string? Error { get; set; }
        public string? StatusCode { get; set; }
        public string? Message { get; set; }
    }

    /// <summary>
    /// 会话开始事件参数
    /// </summary>
    public class SessionStartedEventArgs : EventArgs
    {
        public string? SessionId { get; set; }
        public string? DialogId { get; set; }
    }

    #endregion
}
