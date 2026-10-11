/**
 * 客户端配置
 *
 * ⚠️ 安全约定：**不要把任何凭据写在这里**。
 * 本文件是 ES module，会被浏览器直接下载 —— 原先这里硬编码着
 * 火山引擎的 appId / accessToken / secretKey，等于把凭据发给每一个访客。
 *
 * 凭据现在只存在于服务端：`苏州双桥/.env`（已被 .gitignore 忽略），
 * 由 `server.js` 在建立上游 WebSocket 时作为请求头携带。
 * 浏览器这一侧只连本机代理 `ws://<host>:8082/voice-proxy`，不需要也不应该拿到凭据。
 */
export class ClientConfig {
    constructor() {
        this.webSocketUrl = 'ws://localhost:8082/voice-proxy';
        // 凭据一律留空 —— 由 server.js 服务端注入，前端不要填
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