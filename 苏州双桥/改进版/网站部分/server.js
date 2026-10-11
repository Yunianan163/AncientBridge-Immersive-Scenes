const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8083;
const clients = new Map();
const voiceBridges = new Map();
const clientMissions = new Map();

// WebSocket 服务器实例（在后面初始化）
let wss;
let voiceProxyWss;

/* ===========================================================================
 * 语音凭据 —— 与顶层 server.js 同一约定：一律从环境变量 / 同目录 .env 读取
 * ⚠️ 这里原来硬编码着火山引擎 appId / accessToken / appKey，已清除。
 * 本目录是历史归档（端口 8083），如不再使用建议整体移出交付包。
 * =========================================================================== */
function loadDotEnv(file) {
    const out = {};
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (val.length >= 2 && ((val[0] === '"' && val.endsWith('"')) ||
                                (val[0] === "'" && val.endsWith("'")))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

const DOTENV = loadDotEnv(path.join(__dirname, '.env'));
const envValue = (key) => process.env[key] || DOTENV[key] || '';

const VOICE_CONFIG = {
    url: envValue('VOICE_ENDPOINT') || 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
    appId: envValue('VOICE_APP_ID'),
    accessToken: envValue('VOICE_ACCESS_TOKEN'),
    resourceId: envValue('VOICE_RESOURCE_ID') || 'volc.speech.dialog',
    appKey: envValue('VOICE_APP_KEY'),

    model: envValue('VOICE_MODEL') || '1.2.1.1',
    speaker: envValue('VOICE_SPEAKER') || 'S_tYw86oeY1',

    botName: '沧朔',
    systemRole: '本机器人是室外虚拟古桥场景专属的AI语音交流角色，功能仅围绕古桥历史与用户对话交流，不参与任何操作控制。整体形象设定可爱软萌，语音轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。它熟知古桥的建造年代、历史故事、民间传说与建筑变迁，能用轻松可爱的语气和用户聊天，耐心解答各种关于古桥历史的问题，讲解生动有趣，自带亲切感，让用户在愉快的对话中了解古桥的历史与文化。',
    speakingStyle: '你说话可爱软萌、轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。',

    inputMod: 'keep_alive',
    inputSampleRate: 16000,
    inputChannels: 1,
    outputSampleRate: 24000,
    outputChannels: 1
};

const RTMessageType = {
    FullClientRequest: 0b0001,
    AudioOnlyRequest: 0b0010,
    FullServerResponse: 0b1001,
    AudioOnlyResponse: 0b1011,
    ErrorInformation: 0b1111
};

const RTSerialization = {
    Raw: 0b0000,
    Json: 0b0001
};

const RTCompression = {
    None: 0b0000,
    Gzip: 0b0001
};

const RTFlags = {
    NoSequence: 0b0000,
    SequenceNonTerminal: 0b0001,
    LastNoSequence: 0b0010,
    LastNegativeSequence: 0b0011,
    HasEventId: 0b0100
};

const RTClientEventId = {
    StartConnection: 1,
    FinishConnection: 2,
    StartSession: 100,
    FinishSession: 102,
    TaskRequest: 200,
    UpdateConfig: 201,
    SayHello: 300,
    EndASR: 400,
    ChatTTSText: 500,
    ChatTextQuery: 501,
    ChatRAGText: 502,
    ClientInterrupt: 515
};

const RTServerEventId = {
    ConnectionStarted: 50,
    ConnectionFailed: 51,
    ConnectionFinished: 52,
    SessionStarted: 150,
    SessionFinished: 152,
    SessionFailed: 153,
    UsageResponse: 154,
    ConfigUpdated: 251,
    TTSSentenceStart: 350,
    TTSSentenceEnd: 351,
    TTSResponse: 352,
    TTSEnded: 359,
    ASRInfo: 450,
    ASRResponse: 451,
    ASREnded: 459,
    ChatResponse: 550,
    ChatTextQueryConfirmed: 553,
    ChatEnded: 559,
    DialogCommonError: 599
};

// =============================
// 任务进度管理
// =============================

// 防止季节消息循环
const recentSeasonMessages = new Map();
const SEASON_LOOP_TIMEOUT = 2000; // 2秒内重复的相同来源和目标的季节消息将被忽略

function getMissionProgress(ip) {
    if (!clientMissions.has(ip)) {
        clientMissions.set(ip, {
            modelViewed: false,
            seasonsCompleted: new Set(),
            droneUnlocked: false,

            isAllCompleted() {
                return this.modelViewed && this.seasonsCompleted.size >= 4;
            },

            reset() {
                this.modelViewed = false;
                this.seasonsCompleted.clear();
                this.droneUnlocked = false;
            }
        });
    }
    return clientMissions.get(ip);
}

function createId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// =============================
// 实时语音协议工具
// =============================
function int32ToBigEndian(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value, 0);
    return buffer;
}

function createProtocolHeader(messageType, flags, serialization, compression = RTCompression.None) {
    const header = Buffer.alloc(4);
    const protocolVersion = 0b0001;
    const headerSize = 0b0001;

    header[0] = (protocolVersion << 4) | headerSize;
    header[1] = (messageType << 4) | flags;
    header[2] = (serialization << 4) | compression;
    header[3] = 0x00;
    return header;
}

function buildClientEventPacket(eventId, sessionId = null, payloadObj = {}) {
    const header = createProtocolHeader(
        RTMessageType.FullClientRequest,
        RTFlags.HasEventId,
        RTSerialization.Json,
        RTCompression.None
    );

    const eventBytes = int32ToBigEndian(eventId);
    const sessionBytes = sessionId ? Buffer.from(sessionId, 'utf8') : Buffer.alloc(0);
    const sessionSizeBytes = int32ToBigEndian(sessionBytes.length);

    const payloadText = JSON.stringify(payloadObj || {});
    const payloadBytes = Buffer.from(payloadText, 'utf8');
    const payloadSizeBytes = int32ToBigEndian(payloadBytes.length);

    return Buffer.concat([
        header,
        eventBytes,
        sessionSizeBytes,
        sessionBytes,
        payloadSizeBytes,
        payloadBytes
    ]);
}

function buildAudioPacket(sessionId, audioBytes) {
    const header = createProtocolHeader(
        RTMessageType.AudioOnlyRequest,
        RTFlags.HasEventId,
        RTSerialization.Raw,
        RTCompression.None
    );

    const eventBytes = int32ToBigEndian(RTClientEventId.TaskRequest);
    const sessionBytes = Buffer.from(sessionId, 'utf8');
    const sessionSizeBytes = int32ToBigEndian(sessionBytes.length);
    const payloadSizeBytes = int32ToBigEndian(audioBytes.length);

    return Buffer.concat([
        header,
        eventBytes,
        sessionSizeBytes,
        sessionBytes,
        payloadSizeBytes,
        Buffer.from(audioBytes)
    ]);
}

function parseRealtimePacket(buffer) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    if (buffer.length < 8) throw new Error('实时语音数据包过短');

    const header0 = buffer[0];
    const header1 = buffer[1];
    const header2 = buffer[2];

    const protocolVersion = (header0 >> 4) & 0x0f;
    const headerSize = header0 & 0x0f;
    const messageType = (header1 >> 4) & 0x0f;
    const flags = header1 & 0x0f;
    const serialization = (header2 >> 4) & 0x0f;
    const compression = header2 & 0x0f;

    let offset = headerSize * 4;
    let errorCode = null;
    let sequence = null;
    let eventId = null;
    let sessionId = null;

    if (messageType === RTMessageType.ErrorInformation && buffer.length >= offset + 4) {
        errorCode = buffer.readInt32BE(offset);
        offset += 4;
    }

    if ((flags & 0b0011) !== 0 && buffer.length >= offset + 4) {
        sequence = buffer.readInt32BE(offset);
        offset += 4;
    }

    if ((flags & RTFlags.HasEventId) !== 0 && buffer.length >= offset + 4) {
        eventId = buffer.readInt32BE(offset);
        offset += 4;

        if (buffer.length >= offset + 4) {
            const sessionSize = buffer.readInt32BE(offset);
            offset += 4;

            if (sessionSize > 0 && buffer.length >= offset + sessionSize) {
                sessionId = buffer.slice(offset, offset + sessionSize).toString('utf8');
                offset += sessionSize;
            }
        }
    }

    const payloadSize = buffer.length >= offset + 4 ? buffer.readInt32BE(offset) : 0;
    offset += 4;

    const payloadBytes = payloadSize > 0 && buffer.length >= offset + payloadSize
        ? buffer.slice(offset, offset + payloadSize)
        : Buffer.alloc(0);

    let payloadText = null;
    let payloadJson = null;

    if (serialization === RTSerialization.Json && payloadBytes.length > 0) {
        payloadText = payloadBytes.toString('utf8');
        try {
            payloadJson = JSON.parse(payloadText);
        } catch {
            payloadJson = null;
        }
    }

    return {
        protocolVersion,
        headerSize,
        messageType,
        flags,
        serialization,
        compression,
        errorCode,
        sequence,
        eventId,
        sessionId,
        payloadSize,
        payloadBytes,
        payloadText,
        payloadJson
    };
}

// =============================
// 实时语音代理
// =============================
class RealtimeVoiceBridge {
    constructor(ownerClientId) {
        this.ownerClientId = ownerClientId;
        this.upstream = null;
        this.connectId = '';
        this.sessionId = '';
        this.isConnected = false;
        this.isSessionStarted = false;
        this.isReplying = false;
        this.replyBuffer = '';
        this.readyPromise = null;
    }

    async ensureConnected() {
        if (this.upstream && this.isConnected) {
            console.log(`[voice] 上游已连接 (复用), owner=${this.ownerClientId}`);
            return;
        }
        if (this.readyPromise) {
            console.log(`[voice] 正在连接... owner=${this.ownerClientId}`);
            return this.readyPromise;
        }

        this.readyPromise = new Promise((resolve, reject) => {
            this.connectId = createId('connect');
            const connectionTimeout = setTimeout(() => {
                reject(new Error('上游语音服务连接超时（30秒）'));
                this.readyPromise = null;
                if (this.upstream) {
                    this.upstream.close();
                    this.upstream = null;
                }
            }, 30000);

            const ws = new WebSocket(VOICE_CONFIG.url, {
                headers: {
                    'X-Api-App-ID': VOICE_CONFIG.appId,
                    'X-Api-Access-Key': VOICE_CONFIG.accessToken,
                    'X-Api-Resource-Id': VOICE_CONFIG.resourceId,
                    'X-Api-App-Key': VOICE_CONFIG.appKey,
                    'X-Api-Connect-Id': this.connectId
                }
            });

            this.upstream = ws;

            ws.on('open', () => {
                clearTimeout(connectionTimeout);
                this.isConnected = true;
                this.sendPacket(buildClientEventPacket(RTClientEventId.StartConnection, null, {}));
                console.log(`[voice] ✅ 上游实时语音已连接，owner=${this.ownerClientId}`);
                resolve();
            });

            ws.on('message', (data) => {
                try {
                    const packet = parseRealtimePacket(Buffer.isBuffer(data) ? data : Buffer.from(data));

                    console.log(
                        '[voice] 收到上游事件:',
                        'eventId=' + packet.eventId,
                        'messageType=' + packet.messageType,
                        'sessionId=' + (packet.sessionId || ''),
                        'payload=' + (packet.payloadText || '[binary/empty]')
                    );

                    this.handleUpstreamPacket(packet);
                } catch (err) {
                    console.error('[voice] 解析上游数据失败:', err.message);
                    this.emitVoiceEvent({
                        type: 'robotConversationError',
                        message: '解析语音服务返回失败'
                    });
                }
            });

            ws.on('close', () => {
                clearTimeout(connectionTimeout);
                console.log(`[voice] 上游实时语音已关闭，owner=${this.ownerClientId}`);
                this.isConnected = false;
                this.isSessionStarted = false;
                this.isReplying = false;
                this.replyBuffer = '';
                this.readyPromise = null;
                this.upstream = null;
            });

            ws.on('error', (err) => {
                clearTimeout(connectionTimeout);
                console.error('[voice] ❌ 上游实时语音连接失败:', err.message);
                this.emitVoiceEvent({
                    type: 'robotConversationError',
                    message: `语音服务连接失败: ${err.message}`
                });
                this.readyPromise = null;
                reject(err);
            });
        });

        return this.readyPromise;
    }

    async ensureSessionStarted() {
        await this.ensureConnected();
        if (this.isSessionStarted) {
            console.log(`[voice] 会话已启动 (复用), owner=${this.ownerClientId}`);
            return;
        }

        console.log(`[voice] 正在启动会话, owner=${this.ownerClientId}`);
        this.sessionId = createId('session');

        const payload = {
            asr: {
                audio_info: {
                    format: 'pcm',
                    sample_rate: 16000,
                    channel: 1
                },
                extra: {}
            },
            tts: {
                speaker: 'S_tYw86oeY1',
                audio_config: {
                    format: 'pcm_s16le',
                    sample_rate: 24000,
                    channel: 1
                },
                extra: {}
            },
            dialog: {
                bot_name: '沧朔',
                system_role: '本机器人是室外虚拟古桥场景专属的AI语音交流角色，功能仅围绕古桥历史与用户对话交流，不参与任何操作控制。整体形象设定可爱软萌，语音轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。它熟知古桥的建造年代、历史故事、民间传说与建筑变迁，能用轻松可爱的语气和用户聊天，耐心解答各种关于古桥历史的问题，讲解生动有趣，自带亲切感，让用户在愉快的对话中了解古桥的历史与文化。',
                speaking_style: '你说话可爱软萌、轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。',
                extra: {
                    input_mod: 'keep_alive',
                    model: '1.2.1.1'
                }
            }
        };

        try {
            this.sendPacket(buildClientEventPacket(RTClientEventId.StartSession, this.sessionId, payload));
            this.isSessionStarted = true;
            console.log(`[voice] ✅ 会话已启动，owner=${this.ownerClientId}，sessionId=${this.sessionId}`);
        } catch (err) {
            this.isSessionStarted = false;
            console.error(`[voice] ❌ 会话启动失败，owner=${this.ownerClientId}:`, err.message);
            throw err;
        }
    }

    async startListening() {
        try {
            console.log(`[voice] 开始启动监听，owner=${this.ownerClientId}`);
            await this.ensureSessionStarted();
            console.log(`[voice] ✅ 会话已准备就绪，owner=${this.ownerClientId}，可以开始接收语音`);
            this.emitVoiceEvent({ type: 'robotListenStarted', data: 'true' });
        } catch (err) {
            console.error(`[voice] ❌ 启动监听失败，owner=${this.ownerClientId}:`, err.message);
            this.emitVoiceEvent({
                type: 'robotConversationError',
                message: `启动监听失败: ${err.message}`
            });
            throw err;
        }
    }

    async stopListening() {
        if (!this.isConnected || !this.sessionId) return;
        this.sendPacket(buildClientEventPacket(RTClientEventId.EndASR, this.sessionId, {}));
        this.emitVoiceEvent({ type: 'robotListenStopped', data: 'true' });
    }

    async sendAudioChunk(base64Audio) {
        try {
            await this.ensureSessionStarted();
        } catch (err) {
            console.error(`[voice] ❌ 确保会话启动失败，owner=${this.ownerClientId}:`, err.message);
            this.emitVoiceEvent({
                type: 'robotConversationError',
                message: '语音会话连接失败，请重试'
            });
            throw err;
        }

        if (!base64Audio) return;

        try {
            const audioBytes = Buffer.from(base64Audio, 'base64');
            console.log(`[voice] 🔊 正在发送音频块 (${audioBytes.length}字节) 给上游，owner=${this.ownerClientId}`);
            this.sendPacket(buildAudioPacket(this.sessionId, audioBytes));
        } catch (err) {
            console.error(`[voice] ❌ 发送音频数据失败，owner=${this.ownerClientId}:`, err.message);
            this.emitVoiceEvent({
                type: 'robotConversationError',
                message: '音频发送失败，请检查连接'
            });
        }
    }

    async sendTextQuery(text) {
        try {
            await this.ensureSessionStarted();
        } catch (err) {
            console.error(`[voice] 确保会话启动失败，owner=${this.ownerClientId}:`, err.message);
            this.emitVoiceEvent({
                type: 'robotConversationError',
                message: '语音会话连接失败，请重试'
            });
            throw err;
        }

        const cleanText = String(text || '').trim();
        if (!cleanText) return;

        try {
            this.emitVoiceEvent({
                type: 'robotUserTextFinal',
                text: cleanText,
                data: cleanText
            });

            this.sendPacket(
                buildClientEventPacket(
                    RTClientEventId.ChatTextQuery,
                    this.sessionId,
                    { content: cleanText }
                )
            );
        } catch (err) {
            console.error(`[voice] 发送文本查询失败，owner=${this.ownerClientId}:`, err.message);
            this.emitVoiceEvent({
                type: 'robotConversationError',
                message: '文本送失败，请检查连接'
            });
        }
    }

    async interrupt() {
        if (!this.isConnected || !this.sessionId) return;
        this.sendPacket(buildClientEventPacket(RTClientEventId.ClientInterrupt, this.sessionId, {}));
    }

    async finishSession() {
        if (!this.isConnected || !this.sessionId) return;
        this.sendPacket(buildClientEventPacket(RTClientEventId.FinishSession, this.sessionId, {}));
        this.isSessionStarted = false;
    }

    sendPacket(packet) {
        if (!this.upstream || this.upstream.readyState !== WebSocket.OPEN) {
            throw new Error('上游实时语音未连接');
        }
        this.upstream.send(packet);
    }

    handleUpstreamPacket(packet) {
        switch (packet.eventId) {
            case RTServerEventId.ConnectionStarted:
                console.log(`[voice] ConnectionStarted owner=${this.ownerClientId}`);
                break;

            case RTServerEventId.SessionStarted:
                console.log(`[voice] ✅ SessionStarted owner=${this.ownerClientId}, sessionId=${packet.sessionId || this.sessionId}`);
                this.isSessionStarted = true;
                this.emitVoiceEvent({
                    type: 'robotConversationReady',
                    data: 'true',
                    dialogId: packet.payloadJson?.dialog_id || ''
                });
                break;

            case RTServerEventId.ASRResponse: {
                const results = packet.payloadJson?.results || [];
                if (!results.length) {
                    console.log(`[voice] ⚠️ 收到 ASRResponse 但无识别结果，owner=${this.ownerClientId}`);
                    break;
                }

                const result = results[0] || {};
                const text = String(result.text || '').trim();
                
                console.log(`[voice] 📝 ASR识别结果 (${result.is_interim ? '中间' : '最终'}): "${text}", owner=${this.ownerClientId}`);
                
                if (!text) break;

                this.emitVoiceEvent({
                    type: result.is_interim ? 'robotUserTextPartial' : 'robotUserTextFinal',
                    text,
                    data: text
                });
                break;
            }

            case RTServerEventId.ChatResponse: {
                const chunk = String(packet.payloadJson?.content || '');
                if (!chunk) break;

                if (!this.isReplying) {
                    this.isReplying = true;
                    this.replyBuffer = '';
                    this.emitVoiceEvent({ type: 'robotReplyStarted', data: 'true' });
                }

                this.replyBuffer += chunk;
                this.emitVoiceEvent({
                    type: 'robotReplyTextPartial',
                    text: this.replyBuffer,
                    data: this.replyBuffer
                });
                break;
            }

            case RTServerEventId.ChatEnded: {
                const finalText = this.replyBuffer.trim();

                if (finalText) {
                    this.emitVoiceEvent({
                        type: 'robotReplyTextFinal',
                        text: finalText,
                        data: finalText
                    });
                }

                this.emitVoiceEvent({ type: 'robotReplyEnded', data: 'true' });
                this.isReplying = false;
                this.replyBuffer = '';
                break;
            }

            // 【关键修改】处理TTS开始事件，广播给Unity触发说话动画
            case RTServerEventId.TTSSentenceStart:
                console.log(`[voice] TTSSentenceStart owner=${this.ownerClientId}`);
                this.emitVoiceEvent({ type: 'robotTalkStart', data: 'true' });
                break;

            case RTServerEventId.TTSResponse:
                if (packet.payloadBytes && packet.payloadBytes.length > 0) {
                    console.log(`[voice] 收到 TTS 音频块，${packet.payloadBytes.length} 字节，owner=${this.ownerClientId}`);
                    this.emitVoiceEvent({
                        type: 'robotTtsAudioChunk',
                        data: packet.payloadBytes.toString('base64'),
                        format: 'pcm_s16le',
                        sampleRate: VOICE_CONFIG.outputSampleRate,
                        channels: VOICE_CONFIG.outputChannels
                    });
                }
                break;

            // 【关键修改】处理TTS结束事件，广播给Unity停止说话动画
            case RTServerEventId.TTSEnded:
                this.emitVoiceEvent({ type: 'robotTalkEnd', data: 'true' });
                this.emitVoiceEvent({ type: 'robotTtsEnded', data: 'true' });
                break;

            case RTServerEventId.DialogCommonError:
            case RTServerEventId.SessionFailed:
                this.emitVoiceEvent({
                    type: 'robotConversationError',
                    message: packet.payloadJson?.message || packet.payloadJson?.error || '语音服务异常',
                    statusCode: packet.payloadJson?.status_code || ''
                });
                break;

            case RTServerEventId.SessionFinished:
                this.isSessionStarted = false;
                break;

            default:
                break;
        }
    }

    emitVoiceEvent(msg) {
        const payload = {
            ...msg,
            from: 'server',
            time: new Date().toISOString()
        };
        relayServerEvent(this.ownerClientId, payload);
    }

    close() {
        try {
            if (this.upstream && this.upstream.readyState === WebSocket.OPEN) {
                this.upstream.close();
            }
        } catch (err) {
            console.error('[voice] 关闭上游连接失败:', err.message);
        }

        this.upstream = null;
        this.readyPromise = null;
        this.isConnected = false;
        this.isSessionStarted = false;
        this.isReplying = false;
        this.replyBuffer = '';
    }
}

function getOrCreateVoiceBridge(clientId) {
    let bridge = voiceBridges.get(clientId);
    if (!bridge) {
        bridge = new RealtimeVoiceBridge(clientId);
        voiceBridges.set(clientId, bridge);
    }
    return bridge;
}

function removeVoiceBridge(clientId) {
    const bridge = voiceBridges.get(clientId);
    if (bridge) {
        bridge.close();
        voiceBridges.delete(clientId);
    }
}

// =============================
// 重置整轮任务
// =============================
function resetMissionProgress(reason = '', ip = null) {
    if (ip) {
        const progress = clientMissions.get(ip);
        if (progress) {
            progress.reset();
            console.log(`🔄 任务进度已重置${reason ? '，原因：' + reason : ''}，IP: ${ip}`);
            broadcastMissionProgress(ip);
            sendToClientsByIp(ip, {
                type: 'droneLocked',
                data: 'true',
                reason,
                time: new Date().toISOString()
            });
        }
    } else {
        clientMissions.forEach((progress, clientIp) => {
            progress.reset();
            console.log(`🔄 任务进度已重置${reason ? '，原因：' + reason : ''}，IP: ${clientIp}`);
            broadcastMissionProgress(clientIp);
            sendToClientsByIp(clientIp, {
                type: 'droneLocked',
                data: 'true',
                reason,
                time: new Date().toISOString()
            });
        });
    }
}

function countClientsByType(type) {
    let count = 0;
    clients.forEach(client => {
        if (client.type === type) {
            count++;
        }
    });
    return count;
}

// =============================
// HTTP 静态资源服务
// =============================
const server = http.createServer((req, res) => {
    // 设置 CORS 头，允许跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Upgrade, Connection');
    
    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    const rawUrl = req.url || '/';
    const pathname = decodeURIComponent(rawUrl.split('?')[0]);

    // 语音对话页面路由
    if (pathname === '/voice' || pathname === '/voice/') {
        const voiceIndexPath = path.join(__dirname, '..', 'RealtimeDialog-Web', 'index.html');
        fs.readFile(voiceIndexPath, (error, content) => {
            if (error) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Error loading voice dialog page: ' + error.message);
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content, 'utf-8');
            }
        });
        return;
    }

    // 语音对话相关资源文件
    if (pathname.startsWith('/voice/')) {
        const relativePath = pathname.replace(/^\/voice\//, '');
        const voiceFilePath = path.join(__dirname, '..', 'RealtimeDialog-Web', relativePath);
        const extname = String(path.extname(voiceFilePath)).toLowerCase();
        
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8'
        };
        const contentType = mimeTypes[extname] || 'application/octet-stream';
        
        fs.readFile(voiceFilePath, (error, content) => {
            if (error) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not found: ' + relativePath);
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
        return;
    }

    const safeRelativePath = pathname === '/'
        ? 'index.html'
        : pathname.replace(/^\/+/, '');

    const filePath = path.join(__dirname, safeRelativePath);
    const extname = String(path.extname(filePath)).toLowerCase();

    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.mov': 'video/quicktime',
        '.m4v': 'video/x-m4v',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Server Error: ' + error.code + '\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// =============================
// 任务追踪
// =============================
function handleMissionTracking(msgType, msg, clientIp) {
    const missionProgress = getMissionProgress(clientIp);
    if (msgType === 'viewModel') {
        const shouldOpen =
            msg.show === true ||
            msg.data === true ||
            msg.data === 'true' ||
            msg.data === 'open' ||
            msg.data === '1' ||
            msg.data === 'main';

        if (shouldOpen && !missionProgress.modelViewed) {
            missionProgress.modelViewed = true;
            console.log(`✅ 任务进度：已完成 查看模型及介绍，IP: ${clientIp}`);
            broadcastMissionProgress(clientIp);
        }
    }

    if (msgType === 'season' || msgType === 'seasonChanged' || msgType === 'season_changed') {
        const normalizedSeason = normalizeSeason(msg.data || msg.season);

        if (normalizedSeason && !missionProgress.seasonsCompleted.has(normalizedSeason)) {
            missionProgress.seasonsCompleted.add(normalizedSeason);
            console.log(`✅ 任务进度：已完成季节 ${normalizedSeason}，当前 ${missionProgress.seasonsCompleted.size}/4，IP: ${clientIp}`);
            broadcastMissionProgress(clientIp);
        }
    }
}

// =============================
// 季节标准化
// =============================
function normalizeSeason(season) {
    if (!season) return '';

    const s = String(season).trim().toLowerCase();
    const seasonMap = {
        spring: 'spring',
        '春': 'spring',
        '春天': 'spring',

        summer: 'summer',
        '夏': 'summer',
        '夏天': 'summer',

        autumn: 'autumn',
        fall: 'autumn',
        '秋': 'autumn',
        '秋天': 'autumn',

        winter: 'winter',
        '冬': 'winter',
        '冬天': 'winter'
    };

    return seasonMap[s] || '';
}

// =============================
// 任务进度消息
// =============================
function createMissionProgressMessage(ip) {
    const missionProgress = getMissionProgress(ip);
    return {
        type: 'missionProgress',
        modelViewed: missionProgress.modelViewed,
        seasonsCompleted: Array.from(missionProgress.seasonsCompleted),
        seasonsCount: missionProgress.seasonsCompleted.size,
        droneUnlocked: missionProgress.droneUnlocked,
        totalSeasons: 4,
        time: new Date().toISOString()
    };
}

function sendMissionProgress(targetClientId) {
    const client = clients.get(targetClientId);
    if (!client || !client.ip) return;
    sendToClient(targetClientId, createMissionProgressMessage(client.ip));
}

function broadcastMissionProgress(ip) {
    const progress = createMissionProgressMessage(ip);
    sendToClientsByIp(ip, progress);
    console.log(`📢 广播进度（${ip}）：模型 ${progress.modelViewed ? '✓' : '✗'}，四季 ${progress.seasonsCount}/4，解锁 ${progress.droneUnlocked ? '✓' : '✗'}`);
}

function broadcastDroneUnlocked(ip) {
    const unlockMsg = {
        type: 'droneUnlocked',
        data: 'true',
        message: '无人机已解锁！',
        controls: {
            space: '起飞',
            l: '降落',
            w: '前进',
            s: '后退',
            a: '左转',
            d: '右转',
            q: '水平左转',
            e: '水平右转'
        },
        hint: '往前走到桥的旁边解锁更多的交互和介绍',
        time: new Date().toISOString()
    };

    sendToClientsByIp(ip, unlockMsg);
    console.log(`🚁 已广播 droneUnlocked（${ip}）`);
}

// =============================
// 发送工具
// =============================
function sendToClient(clientId, msg) {
    const client = clients.get(clientId);
    if (!client || !client.socket || client.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        client.socket.send(JSON.stringify(msg));
    } catch (err) {
        console.error(`发送给客户端 ${clientId} 失败:`, err.message);
    }
}

function sendToClientsByIp(ip, msg) {
    const text = JSON.stringify(msg);
    clients.forEach((client, id) => {
        if (client.ip !== ip || !client.socket || client.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        try {
            client.socket.send(text);
        } catch (err) {
            console.error(`发送给 ${id} 失败:`, err.message);
        }
    });
}

function relayServerEvent(ownerClientId, msg) {
    sendToClient(ownerClientId, msg);
    forwardToOthers(ownerClientId, msg);
}

function broadcastMessage(msg, targetIp = null) {
    const text = JSON.stringify(msg);

    clients.forEach((client, id) => {
        if (!client.socket || client.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        if (targetIp && client.ip !== targetIp) {
            return;
        }

        try {
            client.socket.send(text);
        } catch (err) {
            console.error(`广播失败给 ${id}:`, err.message);
        }
    });
}

function forwardToOthers(sourceClientId, msg) {
    const sourceClient = clients.get(sourceClientId);
    if (!sourceClient) return;

    const sourceIp = sourceClient.ip;
    const text = JSON.stringify(msg);
    let forwardCount = 0;
    
    console.log(`[转发] 开始转发消息，源客户端: ${sourceClientId}, IP: ${sourceIp}, 消息类型: ${msg.type}`);
    console.log(`[转发] 当前客户端数量: ${clients.size}`);

    clients.forEach((target, id) => {
        console.log(`[转发] 检查客户端 ${id}, type: ${target.type}, ip: ${target.ip}, readyState: ${target.socket?.readyState}`);
        
        if (id === sourceClientId) {
            console.log(`[转发] 跳过源客户端 ${id}`);
            return;
        }
        if (!target.socket || target.socket.readyState !== WebSocket.OPEN) {
            console.log(`[转发] 客户端 ${id} 未连接，跳过`);
            return;
        }
        if (target.ip !== sourceIp) {
            console.log(`[转发] 客户端 ${id} IP 不匹配 (${target.ip} !== ${sourceIp})，跳过`);
            return;
        }

        try {
            target.socket.send(text);
            console.log(`✅ 已转发给 ${target.type || 'unknown'} (${id})`);
            forwardCount++;
        } catch (err) {
            console.error(`❌ 转发失败给 ${id}:`, err.message);
        }
    });

    console.log(`[转发] 转发完成: ${forwardCount} 个客户端`);
}

// =============================
// WebSocket 服务器初始化
// =============================

// 1. Unity-Web 通信 WebSocket 服务器
wss = new WebSocket.Server({ noServer: true, path: '/ws' });

wss.on('connection', (socket, req) => {
    const clientId = Date.now() + Math.random();
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() 
        || req.headers['x-real-ip'] 
        || req.socket.remoteAddress;
    const client = {
        id: clientId,
        socket,
        type: null,
        ip: clientIp
    };

    clients.set(clientId, client);
    console.log(`[${new Date().toLocaleTimeString()}] 新客户端连接, ID: ${clientId}, IP: ${clientIp}`);

    const cleanupClient = (reason) => {
        const current = clients.get(clientId);
        if (!current) return;

        const wasWeb = current.type === 'web';
        const currentIp = current.ip;
        clients.delete(clientId);
        removeVoiceBridge(clientId);
        console.log(`客户端 ${clientId} 断开(${reason})`);

        if (wasWeb && countClientsByType('web') === 0) {
            resetMissionProgress('所有网页客户端已断开', currentIp);
        }
    };

    socket.on('message', async (raw, isBinary) => {
        if (isBinary) {
            console.log('收到未处理的二进制客户端消息，已忽略');
            return;
        }

        const message = raw.toString('utf8');
        console.log(`[收到] ${message}`);

        try {
            const msg = JSON.parse(message);

            if (msg.type === 'resetMissionProgress') {
                resetMissionProgress('网页主动请求重置', client.ip);
                return;
            }

            if (msg.type === 'register') {
                client.type = msg.client || 'unknown';
                console.log(`✅ 客户端 ${clientId} 注册为: ${client.type}`);
                console.log(`[注册] 当前所有客户端: ${Array.from(clients.entries()).map(([id, c]) => `${id}:${c.type}`).join(', ')}`);

                if (client.type === 'web' && msg.resetSession === true) {
                    resetMissionProgress('网页刷新/重新进入，开始新一轮任务', client.ip);
                }

                sendMissionProgress(clientId);
                return;
            }

            if (msg.type === 'ping') {
                sendToClient(clientId, {
                    type: 'pong',
                    time: new Date().toISOString()
                });
                return;
            }

            if (msg.data === undefined && msg.season !== undefined) {
                msg.data = msg.season;
            }

            if (
                (msg.type === 'season' || msg.type === 'season_changed' || msg.cmd === 'season') &&
                (!msg.data || msg.data === 'data')
            ) {
                console.log('⚠️ 丢弃无效季节消息:', msg);
                return;
            }

            const from = msg.from || client.type || 'unknown';
            const msgType = msg.type || msg.cmd || 'unknown';
            const msgData = msg.data !== undefined
                ? msg.data
                : (msg.season !== undefined ? msg.season : '');

            // ===== 网页语音控制消息：由 server 代理到上游语音服务 =====
            if (from === 'web') {
                const voiceBridge = getOrCreateVoiceBridge(clientId);

                if (msgType === 'robotListenStart') {
                    console.log(`[server] 收到 robotListenStart，启动语音监听，clientId=${clientId}`);
                    await voiceBridge.startListening();
                    return;
                }

                if (msgType === 'robotListenStop') {
                    console.log(`[server] 收到 robotListenStop，停止语音监听，clientId=${clientId}`);
                    await voiceBridge.stopListening();
                    return;
                }

                if (msgType === 'robotAudioChunk') {
                    const audioData = msg.data || msg.audio || msg.base64 || '';
                    if (!audioData) {
                        console.warn(`[server] 收到 robotAudioChunk 但没有音频数据`);
                        return;
                    }
                    console.log(`[server] 收到 robotAudioChunk，长度=${audioData.length}，clientId=${clientId}`);
                    await voiceBridge.sendAudioChunk(audioData);
                    return;
                }

                if (msgType === 'robotTextQuery' || msgType === 'robotChatText') {
                    await voiceBridge.sendTextQuery(msg.text || msg.data || '');
                    return;
                }

                if (msgType === 'robotInterrupt') {
                    await voiceBridge.interrupt();
                    return;
                }

                if (msgType === 'robotVoiceClose') {
                    await voiceBridge.finishSession();
                    return;
                }
            }

            handleMissionTracking(msgType, msg, client.ip);

            const missionProgress = getMissionProgress(client.ip);
            if (!missionProgress.droneUnlocked && missionProgress.isAllCompleted()) {
                missionProgress.droneUnlocked = true;
                console.log(`🎉 前置任务完成，无人机已解锁，IP: ${client.ip}`);

                broadcastMissionProgress(client.ip);
                broadcastDroneUnlocked(client.ip);
            }

            if (msgType === 'droneUnlocked') {
                if (!missionProgress.droneUnlocked) {
                    missionProgress.droneUnlocked = true;
                    broadcastMissionProgress(client.ip);
                }
            }

            if (msgType === 'droneLocked') {
                if (missionProgress.droneUnlocked) {
                    missionProgress.droneUnlocked = false;
                    broadcastMissionProgress(client.ip);
                }
            }

            const forwardMsg = {
                ...msg,
                type: msgType,
                data: msgData,
                from,
                time: new Date().toISOString()
            };

            // 防止季节消息循环：如果是从 Unity 发来的季节消息，且最近已经转发过相同的季节，则忽略
            if (msgType === 'season' || msgType === 'seasonChanged' || msgType === 'season_changed') {
                const seasonKey = normalizeSeason(msgData);
                const now = Date.now();
                
                // 清理过期的记录
                for (const [key, timestamp] of recentSeasonMessages) {
                    if (now - timestamp > SEASON_LOOP_TIMEOUT) {
                        recentSeasonMessages.delete(key);
                    }
                }
                
                // 检查是否是可能的循环消息
                if (from === 'unity' || from === 'unity_client') {
                    const unityKey = `unity-${seasonKey}`;
                    if (recentSeasonMessages.has(unityKey)) {
                        console.log(`🔄 阻止可能的季节消息循环: ${seasonKey} 来自 ${from}`);
                        return; // 不转发这条消息
                    }
                    recentSeasonMessages.set(unityKey, now);
                } else if (from === 'web') {
                    const webKey = `web-${seasonKey}`;
                    recentSeasonMessages.set(webKey, now);
                }
            }

            forwardToOthers(clientId, forwardMsg);
        } catch (e) {
            console.error('处理错误:', e);
            sendToClient(clientId, {
                type: 'robotConversationError',
                message: e.message || '服务器处理失败',
                from: 'server',
                time: new Date().toISOString()
            });
        }
    });

    socket.on('close', () => {
        cleanupClient('close');
    });

    socket.on('error', (err) => {
        console.error(`客户端 ${clientId} 错误:`, err.message);
        cleanupClient('error');
    });
});

// 2. 语音代理 WebSocket 服务器（关键修改部分）
voiceProxyWss = new WebSocket.Server({ noServer: true, path: '/voice-proxy' });

voiceProxyWss.on('connection', (clientWs, req) => {
    console.log('[voice-proxy] 新的语音客户端连接');
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() 
        || req.headers['x-real-ip'] 
        || req.socket.remoteAddress;
    
    // 连接到火山引擎
    const targetWs = new WebSocket(VOICE_CONFIG.url, {
        headers: {
            'X-Api-App-ID': VOICE_CONFIG.appId,
            'X-Api-Access-Key': VOICE_CONFIG.accessToken,
            'X-Api-Resource-Id': VOICE_CONFIG.resourceId,
            'X-Api-App-Key': VOICE_CONFIG.appKey,
            'X-Api-Connect-Id': Date.now().toString()
        }
    });
    
    let targetReady = false;
    const messageQueue = [];
    
    targetWs.on('open', () => {
        console.log('[voice-proxy] 火山引擎已连接');
        targetReady = true;
        
        while (messageQueue.length > 0) {
            const msg = messageQueue.shift();
            targetWs.send(msg);
        }
    });
    
    targetWs.on('message', (data) => {
        // 1. 透传给网页客户端（保持原有功能不变）
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data);
        }
        
        // 2. 【关键修改】解析火山引擎协议，检测AI说话状态并广播给Unity（仅同IP）
        try {
            const packet = parseRealtimePacket(Buffer.isBuffer(data) ? data : Buffer.from(data));
            
            // TTSSentenceStart (350) - AI开始播放语音（触发Talking1/2动画）
            if (packet.eventId === RTServerEventId.TTSSentenceStart) {
                console.log('[voice-proxy] 检测到AI开始说话(TTSSentenceStart)，广播robotTalkStart');
                sendToClientsByIp(clientIp, {
                    type: 'robotTalkStart',
                    data: 'true',
                    trigger: 'Talk2', // 兼容旧版本
                    from: 'server',
                    time: new Date().toISOString()
                });
            }
            // TTSEnded (359) - AI语音播放结束（停止手部动画）
            else if (packet.eventId === RTServerEventId.TTSEnded) {
                console.log('[voice-proxy] 检测到AI说话结束(TTSEnded)，广播robotTalkEnd');
                sendToClientsByIp(clientIp, {
                    type: 'robotTalkEnd',
                    data: 'true',
                    from: 'server',
                    time: new Date().toISOString()
                });
            }
            // ASRResponse (451) - 用户说话识别中（临时结果），触发聆听点头
            else if (packet.eventId === RTServerEventId.ASRResponse) {
                const results = packet.payloadJson?.results || [];
                if (results.length > 0 && results[0].is_interim) {
                    sendToClientsByIp(clientIp, {
                        type: 'userSpeaking',
                        from: 'server',
                        time: new Date().toISOString()
                    });
                }
            }
        } catch (err) {
            // 解析失败的是音频二进制数据，属于正常情况，忽略即可
        }
    });
    
    targetWs.on('error', (err) => {
        console.error('[voice-proxy] 火山引擎错误:', err.message);
        clientWs.close();
    });
    
    targetWs.on('close', () => {
        console.log('[voice-proxy] 火山引擎连接关闭');
        clientWs.close();
    });
    
    clientWs.on('message', (data) => {
        if (targetReady) {
            targetWs.send(data);
        } else {
            messageQueue.push(data);
        }
    });
    
    clientWs.on('close', () => {
        console.log('[voice-proxy] 客户端断开');
        targetWs.close();
    });
    
    clientWs.on('error', (err) => {
        console.error('[voice-proxy] 客户端错误:', err.message);
        targetWs.close();
    });
});

// =============================
// 处理 HTTP 升级到 WebSocket
// =============================
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
    console.log(`[upgrade] 收到升级请求: ${pathname}`);
    
    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else if (pathname === '/voice-proxy') {
        voiceProxyWss.handleUpgrade(request, socket, head, (ws) => {
            voiceProxyWss.emit('connection', ws, request);
        });
    } else {
        console.log(`[upgrade] 未知路径，断开连接: ${pathname}`);
        socket.destroy();
    }
});

// =============================
// 启动服务器
// =============================
server.listen(PORT, () => {
    console.log('========================================');
    console.log('服务器已启动');
    console.log(`网页访问: http://127.0.0.1:${PORT}`);
    console.log(`WebSocket: ws://127.0.0.1:${PORT}`);
    console.log('语音代理: 已启用');
    console.log('先执行: npm install ws');
    console.log('按 Ctrl+C 停止');
    console.log('========================================');
});