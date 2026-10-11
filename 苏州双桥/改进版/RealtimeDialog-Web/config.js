/**
 * 客户端配置（改进版·历史副本）
 *
 * ⚠️ 这里原先与顶层 `RealtimeDialog-Web/config.js` 一样硬编码着火山引擎凭据，已一并清除。
 * 本目录整体是历史归档（Unity 构建从未放进来），如不再使用建议整体移出交付包。
 * 凭据只应存在于服务端 `苏州双桥/.env`（已 gitignore），由 server.js 注入请求头。
 */
export class ClientConfig {
    constructor() {
        this.webSocketUrl = 'ws://localhost:8082/voice-proxy';
        this.appId = '';
        this.accessToken = '';
        this.secretKey = '';
    }
}

export class AudioConfiguration {
    constructor() {
        this.inputFormat = 'pcm';
        this.inputSampleRate = 16000;
        this.inputChannels = 1;
        this.outputFormat = 'pcm_s16le';  // 关键修复：与C#一致
        this.outputSampleRate = 24000;
        this.outputChannels = 1;
        this.speechRate = null;
        this.loudnessRate = null;
    }
}

export const VoiceSpeakers = {
    Custom: 'S_tYw86oeY1',
    VV: 'zh_female_vv_jupiter_bigtts',
    XiaoHe: 'zh_female_xiaohe_jupiter_bigtts',
    YunZhou: 'zh_male_yunzhou_jupiter_bigtts',
    XiaoTian: 'zh_male_xiaotian_jupiter_bigtts',
    Default: 'S_tYw86oeY1'
};

export const ModelVersions = {
    O2_0: '1.2.1.1',
    SC2_0: '2.2.0.0'
};

export const InputModes = {
    KeepAlive: 'keep_alive',
    PushToTalk: 'push_to_talk',
    Text: 'text',
    AudioFile: 'audio_file'
};

export const WebSearchTypes = {
    Web: 'web',
    WebSummary: 'web_summary',
    WebAgent: 'web_agent'
};

export const TTSTypes = {
    AuditContentRisky: 'audit_content_risky',
    ChatTtsText: 'chat_tts_text',
    Network: 'network',
    ExternalRag: 'external_rag',
    Sing: 'sing',
    Default: 'default'
};