// ==================== 请求事件模型 ====================

/**
 * StartSession请求
 */
export class StartSessionRequest {
    constructor() {
        /** @type {AsrConfig|null} */
        this.asr = null;
        
        /** @type {TtsConfig|null} */
        this.tts = null;
        
        /** @type {DialogConfig|null} */
        this.dialog = null;
    }
}

export class AsrConfig {
    constructor() {
        /** @type {AudioInfo|null} */
        this.audio_info = null;
        
        /** @type {AsrExtra|null} */
        this.extra = null;
    }
}

export class AudioInfo {
    constructor() {
        /** @type {string} */
        this.format = 'pcm';  // pcm 或 speech_opus
        
        /** @type {number} */
        this.sample_rate = 16000;
        
        /** @type {number} */
        this.channel = 1;
    }
}

export class AsrExtra {
    constructor() {
        /** @type {number|null} */
        this.end_smooth_window_ms = null;
        
        /** @type {boolean|null} */
        this.enable_custom_vad = null;
        
        /** @type {boolean|null} */
        this.enable_asr_twopass = null;
        
        /** @type {string|null} */
        this.boosting_table_id = null;
        
        /** @type {string|null} */
        this.boosting_table_name = null;
        
        /** @type {string|null} */
        this.regex_correct_table_id = null;
        
        /** @type {string|null} */
        this.regex_correct_table_name = null;
        
        /** @type {AsrContext|null} */
        this.context = null;
    }
}

export class AsrContext {
    constructor() {
        /** @type {Hotword[]|null} */
        this.hotwords = null;
        
        /** @type {Object.<string, string>|null} */
        this.correct_words = null;
    }
}

export class Hotword {
    constructor() {
        /** @type {string|null} */
        this.word = null;
    }
}

export class TtsConfig {
    constructor() {
        /** @type {string|null} */
        this.speaker = null;
        
        /** @type {TtsAudioConfig|null} */
        this.audio_config = null;
    }
}

export class TtsAudioConfig {
    constructor() {
        /** @type {number} */
        this.channel = 1;
        
        /** @type {string} */
        this.format = 'ogg';  // ogg, pcm, pcm_s16le
        
        /** @type {number} */
        this.sample_rate = 24000;
        
        /** @type {number|null} */
        this.speech_rate = null;
        
        /** @type {number|null} */
        this.loudness_rate = null;
    }
}

export class DialogConfig {
    constructor() {
        /** @type {string|null} */
        this.bot_name = null;
        
        /** @type {string|null} */
        this.system_role = null;
        
        /** @type {string|null} */
        this.speaking_style = null;
        
        /** @type {string|null} */
        this.dialog_id = null;
        
        /** @type {string|null} */
        this.character_manifest = null;
        
        /** @type {LocationInfo|null} */
        this.location = null;
        
        /** @type {DialogContextItem[]|null} */
        this.dialog_context = null;
        
        /** @type {DialogExtra|null} */
        this.extra = null;
    }
}

export class LocationInfo {
    constructor() {
        /** @type {number|null} */
        this.longitude = null;
        
        /** @type {number|null} */
        this.latitude = null;
        
        /** @type {string|null} */
        this.city = null;
        
        /** @type {string} */
        this.country = '中国';
        
        /** @type {string|null} */
        this.province = null;
        
        /** @type {string|null} */
        this.district = null;
        
        /** @type {string|null} */
        this.town = null;
        
        /** @type {string} */
        this.country_code = 'CN';
        
        /** @type {string|null} */
        this.address = null;
    }
}

export class DialogContextItem {
    constructor() {
        /** @type {string|null}  user 或 assistant */
        this.role = null;
        
        /** @type {string|null} */
        this.text = null;
        
        /** @type {number|null} */
        this.timestamp = null;
    }
}

export class DialogExtra {
    constructor() {
        /** @type {boolean} */
        this.strict_audit = true;
        
        /** @type {string|null} */
        this.audit_response = null;
        
        /** @type {boolean|null} */
        this.enable_volc_websearch = null;
        
        /** @type {string|null} web, web_summary, web_agent */
        this.volc_websearch_type = null;
        
        /** @type {string|null} */
        this.volc_websearch_api_key = null;
        
        /** @type {number|null} */
        this.volc_websearch_result_count = null;
        
        /** @type {string|null} */
        this.volc_websearch_no_result_message = null;
        
        /** @type {string|null} keep_alive, push_to_talk, text, audio_file */
        this.input_mod = null;
        
        /** @type {boolean|null} */
        this.enable_music = null;
        
        /** @type {boolean|null} */
        this.enable_loudness_norm = null;
        
        /** @type {boolean|null} */
        this.enable_conversation_truncate = null;
        
        /** @type {boolean|null} */
        this.enable_user_query_exit = null;
        
        /** @type {string|null} 1.2.1.1 (O2.0) 或 2.2.0.0 (SC2.0) */
        this.model = null;
    }
}

/**
 * UpdateConfig请求
 */
export class UpdateConfigRequest {
    constructor() {
        /** @type {TtsUpdateConfig|null} */
        this.tts = null;
        
        /** @type {DialogUpdateConfig|null} */
        this.dialog = null;
    }
}

export class TtsUpdateConfig {
    constructor() {
        /** @type {string|null} */
        this.speaker = null;
    }
}

export class DialogUpdateConfig {
    constructor() {
        /** @type {string|null} */
        this.bot_name = null;
        
        /** @type {string|null} */
        this.system_role = null;
        
        /** @type {string|null} */
        this.speaking_style = null;
        
        /** @type {string|null} */
        this.dialog_id = null;
        
        /** @type {LocationInfo|null} */
        this.location = null;
    }
}

/**
 * SayHello请求
 */
export class SayHelloRequest {
    constructor() {
        /** @type {string|null} */
        this.content = null;
    }
}

/**
 * ChatTTSText请求
 */
export class ChatTTSTextRequest {
    constructor() {
        /** @type {boolean} */
        this.start = false;
        
        /** @type {string|null} */
        this.content = null;
        
        /** @type {boolean} */
        this.end = false;
    }
}

/**
 * ChatTextQuery请求
 */
export class ChatTextQueryRequest {
    constructor() {
        /** @type {string|null} */
        this.content = null;
    }
}

/**
 * ChatRAGText请求
 */
export class ChatRAGTextRequest {
    constructor() {
        /** @type {string|null} */
        this.external_rag = null;
    }
}

export class ExternalRagItem {
    constructor() {
        /** @type {string|null} */
        this.title = null;
        
        /** @type {string|null} */
        this.content = null;
    }
}

/**
 * ConversationCreate请求
 */
export class ConversationCreateRequest {
    constructor() {
        /** @type {ConversationItem[]|null} */
        this.items = null;
    }
}

export class ConversationItem {
    constructor() {
        /** @type {string|null} */
        this.role = null;
        
        /** @type {string|null} */
        this.text = null;
        
        /** @type {number|null} */
        this.timestamp = null;
        
        /** @type {string|null} */
        this.item_id = null;
    }
}

/**
 * ConversationUpdate请求
 */
export class ConversationUpdateRequest {
    constructor() {
        /** @type {ConversationUpdateItem[]|null} */
        this.items = null;
    }
}

export class ConversationUpdateItem {
    constructor() {
        /** @type {string|null} */
        this.item_id = null;
        
        /** @type {string|null} */
        this.text = null;
    }
}

/**
 * ConversationRetrieve请求
 */
export class ConversationRetrieveRequest {
    constructor() {
        /** @type {ConversationRetrieveItem[]|null} */
        this.items = null;
    }
}

export class ConversationRetrieveItem {
    constructor() {
        /** @type {string|null} */
        this.item_id = null;
    }
}

/**
 * ConversationTruncate请求
 */
export class ConversationTruncateRequest {
    constructor() {
        /** @type {string|null} */
        this.item_id = null;
        
        /** @type {number} */
        this.audio_end_ms = 0;
    }
}

/**
 * ConversationDelete请求
 */
export class ConversationDeleteRequest {
    constructor() {
        /** @type {ConversationDeleteItem[]|null} */
        this.items = null;
    }
}

export class ConversationDeleteItem {
    constructor() {
        /** @type {string|null} */
        this.item_id = null;
    }
}

// ==================== 响应事件模型 ====================

/**
 * SessionStarted响应
 */
export class SessionStartedResponse {
    constructor() {
        /** @type {string|null} */
        this.dialog_id = null;
    }
}

/**
 * Error响应
 */
export class ErrorResponse {
    constructor() {
        /** @type {string|null} */
        this.error = null;
        
        /** @type {string|null} */
        this.status_code = null;
        
        /** @type {string|null} */
        this.message = null;
    }
}

/**
 * TTSSentenceStart响应
 */
export class TTSSentenceStartResponse {
    constructor() {
        /** @type {string|null} */
        this.tts_type = null;
        
        /** @type {string|null} */
        this.text = null;
        
        /** @type {string|null} */
        this.question_id = null;
        
        /** @type {string|null} */
        this.reply_id = null;
    }
}

/**
 * TTSSentenceEnd响应
 */
export class TTSSentenceEndResponse {
    constructor() {
        /** @type {string|null} */
        this.question_id = null;
        
        /** @type {string|null} */
        this.reply_id = null;
    }
}

/**
 * TTSEnded响应
 */
export class TTSEndedResponse {
    constructor() {
        /** @type {string|null} */
        this.question_id = null;
        
        /** @type {string|null} */
        this.reply_id = null;
        
        /** @type {string|null} */
        this.status_code = null;
    }
}

/**
 * ASRInfo响应
 */
export class ASRInfoResponse {
    constructor() {
        /** @type {string|null} */
        this.question_id = null;
    }
}

/**
 * ASRResponse响应
 */
export class ASRResponse {
    constructor() {
        /** @type {ASRResult[]|null} */
        this.results = null;
    }
}

export class ASRResult {
    constructor() {
        /** @type {string|null} */
        this.text = null;
        
        /** @type {boolean} */
        this.is_interim = false;
    }
}

/**
 * ChatResponse响应
 */
export class ChatResponse {
    constructor() {
        /** @type {string|null} */
        this.content = null;
        
        /** @type {string|null} */
        this.question_id = null;
        
        /** @type {string|null} */
        this.reply_id = null;
    }
}

/**
 * ChatTextQueryConfirmed响应
 */
export class ChatTextQueryConfirmedResponse {
    constructor() {
        /** @type {string|null} */
        this.question_id = null;
    }
}

/**
 * ChatEnded响应
 */
export class ChatEndedResponse {
    constructor() {
        /** @type {string|null} */
        this.question_id = null;
        
        /** @type {string|null} */
        this.reply_id = null;
    }
}

/**
 * ConversationCreated响应
 */
export class ConversationCreatedResponse {
    constructor() {
        /** @type {ConversationItem[]|null} */
        this.items = null;
    }
}

/**
 * ConversationUpdated响应
 */
export class ConversationUpdatedResponse {
    constructor() {
        /** @type {string|null} */
        this.message = null;
    }
}

/**
 * ConversationRetrieved响应
 */
export class ConversationRetrievedResponse {
    constructor() {
        /** @type {ConversationItem[]|null} */
        this.items = null;
    }
}

/**
 * ConversationDeleted响应
 */
export class ConversationDeletedResponse {
    constructor() {
        /** @type {ConversationItem[]|null} */
        this.items = null;
        
        /** @type {number|null} */
        this.status_code = null;
        
        /** @type {string|null} */
        this.message = null;
    }
}

/**
 * DialogCommonError响应
 */
export class DialogCommonErrorResponse {
    constructor() {
        /** @type {string|null} */
        this.status_code = null;
        
        /** @type {string|null} */
        this.message = null;
    }
}

/**
 * Usage响应
 */
export class UsageResponse {
    constructor() {
        /** @type {UsageInfo|null} */
        this.usage = null;
    }
}

export class UsageInfo {
    constructor() {
        /** @type {number} */
        this.input_text_tokens = 0;
        
        /** @type {number} */
        this.input_audio_tokens = 0;
        
        /** @type {number} */
        this.cached_text_tokens = 0;
        
        /** @type {number} */
        this.cached_audio_tokens = 0;
        
        /** @type {number} */
        this.output_text_tokens = 0;
        
        /** @type {number} */
        this.output_audio_tokens = 0;
    }
}

// ==================== 事件参数 ====================

/**
 * 服务端事件参数
 */
export class ServerEventArgs {
    constructor() {
        /** @type {number} */
        this.eventId = 0;
        
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {Uint8Array|null} */
        this.rawPayload = null;
    }
}

/**
 * 音频数据事件参数
 */
export class AudioDataEventArgs {
    constructor() {
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {Uint8Array|null} */
        this.audioData = null;
    }
}

/**
 * ASR识别事件参数
 */
export class ASRResultEventArgs {
    constructor() {
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {string|null} */
        this.text = null;
        
        /** @type {boolean} */
        this.isInterim = false;
        
        /** @type {string|null} */
        this.questionId = null;
    }
}

/**
 * 聊天响应事件参数
 */
export class ChatResponseEventArgs {
    constructor() {
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {string|null} */
        this.content = null;
        
        /** @type {string|null} */
        this.questionId = null;
        
        /** @type {string|null} */
        this.replyId = null;
    }
}

/**
 * TTS开始事件参数
 */
export class TTSStartEventArgs {
    constructor() {
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {string|null} */
        this.ttsType = null;
        
        /** @type {string|null} */
        this.text = null;
        
        /** @type {string|null} */
        this.questionId = null;
        
        /** @type {string|null} */
        this.replyId = null;
    }
}

/**
 * TTS结束事件参数
 */
export class TTSEndEventArgs {
    constructor() {
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {string|null} */
        this.questionId = null;
        
        /** @type {string|null} */
        this.replyId = null;
        
        /** @type {string|null} */
        this.statusCode = null;
    }
    
    get isUserExit() {
        return this.statusCode === '20000002';
    }
}

/**
 * 错误事件参数
 */
export class ErrorEventArgs {
    constructor() {
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {string|null} */
        this.error = null;
        
        /** @type {string|null} */
        this.statusCode = null;
        
        /** @type {string|null} */
        this.message = null;
    }
}

/**
 * 会话开始事件参数
 */
export class SessionStartedEventArgs {
    constructor() {
        /** @type {string|null} */
        this.sessionId = null;
        
        /** @type {string|null} */
        this.dialogId = null;
    }
}
