import { ProtocolMessage, ClientEventId, ServerEventId } from './protocol.js';
import { 
    ErrorEventArgs, 
    SessionStartedEventArgs, 
    ASRResultEventArgs, 
    ServerEventArgs,
    ChatResponseEventArgs,
    AudioDataEventArgs,
    TTSStartEventArgs,
    TTSEndEventArgs
} from './events.js';

/**
 * 语音对话客户端 - 网页端实现
 * 参照RealtimeDialog C#版本的RealtimeDialogClient实现
 */
export class RealtimeDialogClient extends EventTarget {
    /**
     * @param {import('./config.js').ClientConfig} config 
     */
    constructor(config) {
        super();
        
        if (!config) {
            throw new Error('Config cannot be null');
        }
        
        /** @private @type {import('./config.js').ClientConfig} */
        this._config = config;
        
        /** @private @type {WebSocket|null} */
        this._webSocket = null;
        
        /** @private @type {AbortController|null} */
        this._abortController = null;
        
        /** @private @type {Array<Uint8Array>} */
        this._sendQueue = [];
        
        /** @private @type {boolean} */
        this._isConnected = false;
        
        /** @private @type {boolean} */
        this._isSessionActive = false;
        
        /** @private @type {string|null} */
        this._currentSessionId = null;
        
        /** @private @type {boolean} */
        this._isSending = false;
    }
    
    /** @returns {string|null} */
    get currentSessionId() {
        return this._currentSessionId;
    }
    
    /** @returns {boolean} */
    get isConnected() {
        return this._isConnected && this._webSocket !== null && this._webSocket.readyState === WebSocket.OPEN;
    }
    
    /** @returns {boolean} */
    get isSessionActive() {
        return this._isSessionActive;
    }
    
    /**
     * 连接到服务器
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async connectAsync(signal) {
        if (this._isConnected) {
            throw new Error('Already connected');
        }
        
        this._abortController = new AbortController();
        if (signal) {
            signal.addEventListener('abort', () => this._abortController.abort());
        }
        
        const connectId = this._generateGuid();
        
        return new Promise((resolve, reject) => {
            try {
                const url = new URL(this._config.webSocketUrl);
                url.searchParams.set('X-Api-Connect-Id', connectId);
                
                this._webSocket = new WebSocket(url.toString());
                this._webSocket.binaryType = 'arraybuffer';
                
                this._webSocket.onopen = () => {
                    this._isConnected = true;
                    this._startReceiveLoop();
                    this._startSendLoop();
                    
                    this._sendEventAsync(ClientEventId.StartConnection, null, '{}')
                        .then(() => {
                            this._emit('connectionStarted');
                            resolve();
                        })
                        .catch(reject);
                };
                
                this._webSocket.onerror = (error) => {
                    const errorArgs = new ErrorEventArgs();
                    errorArgs.error = 'WebSocket error';
                    this._emit('connectionFailed', errorArgs);
                    reject(new Error('WebSocket connection failed'));
                };
                
                this._webSocket.onclose = () => {
                    this._isConnected = false;
                    this._isSessionActive = false;
                    this._currentSessionId = null;
                    this._emit('connectionFinished');
                };
                
            } catch (ex) {
                this._isConnected = false;
                const errorArgs = new ErrorEventArgs();
                errorArgs.error = ex.message;
                this._emit('connectionFailed', errorArgs);
                reject(ex);
            }
        });
    }
    
    /**
     * 断开连接
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async disconnectAsync(signal) {
        if (!this._isConnected) return;
        
        try {
            if (this._isSessionActive) {
                await this.finishSessionAsync(signal);
            }
            
            await this._sendEventAsync(ClientEventId.FinishConnection, null, '{}');
            await this._delay(100);
            
            this._abortController?.abort();
            
            if (this._webSocket && this._webSocket.readyState === WebSocket.OPEN) {
                this._webSocket.close(1000, 'Closing');
            }
        } catch {
            // 忽略错误
        } finally {
            this._isConnected = false;
            this._isSessionActive = false;
            this._currentSessionId = null;
        }
    }
    
    /**
     * 启动会话
     * @param {import('./events.js').StartSessionRequest} request 
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async startSessionAsync(request, signal) {
        this._ensureConnected();
        
        if (this._isSessionActive) {
            throw new Error('Session already active');
        }
        
        this._currentSessionId = this._generateGuid();
        
        const json = JSON.stringify(request);
        await this._sendEventAsync(ClientEventId.StartSession, this._currentSessionId, json, signal);
    }
    
    /**
     * 结束会话
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async finishSessionAsync(signal) {
        this._ensureConnected();
        this._ensureSessionActive();
        
        await this._sendEventAsync(ClientEventId.FinishSession, this._currentSessionId, '{}', signal);
        this._isSessionActive = false;
    }
    
    /**
     * 发送音频数据
     * @param {Uint8Array} audioData 
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async sendAudioAsync(audioData, signal) {
        this._ensureConnected();
        this._ensureSessionActive();
        
        const message = ProtocolMessage.createAudioRequest(this._currentSessionId, audioData);
        const data = message.encode();
        this._sendQueue.push(data);
        
        this._processSendQueue();
    }
    
    /**
     * 发送文字查询
     * @param {string} content 
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async sendChatTextQueryAsync(content, signal) {
        this._ensureConnected();
        this._ensureSessionActive();
        
        const request = { content };
        const json = JSON.stringify(request);
        await this._sendEventAsync(ClientEventId.ChatTextQuery, this._currentSessionId, json, signal);
    }
    
    /**
     * 发送客户端打断事件
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async sendClientInterruptAsync(signal) {
        this._ensureConnected();
        this._ensureSessionActive();
        await this._sendEventAsync(ClientEventId.ClientInterrupt, this._currentSessionId, '{}', signal);
    }
    
    /**
     * 发送问候语
     * @param {string} content 
     * @param {AbortSignal} [signal] 
     * @returns {Promise<void>}
     */
    async sayHelloAsync(content, signal) {
        this._ensureConnected();
        this._ensureSessionActive();
        
        const request = { content };
        const json = JSON.stringify(request);
        await this._sendEventAsync(ClientEventId.SayHello, this._currentSessionId, json, signal);
    }
    
    /**
     * @private
     * @param {number} eventId 
     * @param {string|null} sessionId 
     * @param {string} jsonPayload 
     * @param {AbortSignal} [signal] 
     */
    async _sendEventAsync(eventId, sessionId, jsonPayload, signal) {
        const message = ProtocolMessage.createClientEvent(eventId, sessionId, jsonPayload);
        const data = message.encode();
        this._sendQueue.push(data);
        this._processSendQueue();
    }
    
    /**
     * @private
     */
    async _processSendQueue() {
        if (this._isSending || this._sendQueue.length === 0) return;
        if (!this._webSocket || this._webSocket.readyState !== WebSocket.OPEN) return;
        
        this._isSending = true;
        
        while (this._sendQueue.length > 0) {
            const data = this._sendQueue.shift();
            try {
                this._webSocket.send(data);
            } catch (ex) {
                console.error('[RealtimeDialogClient] Send error:', ex);
            }
        }
        
        this._isSending = false;
    }
    
    /**
     * @private
     */
    _startSendLoop() {
        // 发送队列由 _processSendQueue 处理
    }
    
    /**
     * @private
     */
    _startReceiveLoop() {
        if (!this._webSocket) return;
        
        this._webSocket.onmessage = async (event) => {
            try {
                let data;
                if (event.data instanceof ArrayBuffer) {
                    data = new Uint8Array(event.data);
                } else if (event.data instanceof Blob) {
                    const arrayBuffer = await event.data.arrayBuffer();
                    data = new Uint8Array(arrayBuffer);
                } else {
                    return;
                }
                
                await this._processMessageAsync(data);
            } catch (ex) {
                console.error('[RealtimeDialogClient] Message processing error:', ex);
                const errorArgs = new ErrorEventArgs();
                errorArgs.error = `Message processing error: ${ex.message}`;
                this._emit('errorReceived', errorArgs);
            }
        };
    }
    
    /**
     * @private
     * @param {Uint8Array} data 
     */
    async _processMessageAsync(data) {
        const message = ProtocolMessage.decode(data);
        const eventId = message.eventId || 0;
        const sessionId = message.sessionId;
        const payloadJson = new TextDecoder().decode(message.payload);
        
        switch (eventId) {
            case ServerEventId.ConnectionStarted:
                this._emit('connectionStarted');
                break;
                
            case ServerEventId.SessionStarted:
                this._isSessionActive = true;
                const sessionResp = JSON.parse(payloadJson);
                const sessionArgs = new SessionStartedEventArgs();
                sessionArgs.sessionId = sessionId;
                sessionArgs.dialogId = sessionResp?.dialog_id;
                this._emit('sessionStarted', sessionArgs);
                break;
                
            case ServerEventId.SessionFinished:
                this._isSessionActive = false;
                this._emit('sessionFinished');
                break;
                
            case ServerEventId.SessionFailed:
                this._isSessionActive = false;
                const sessionError = JSON.parse(payloadJson);
                const sessionErrorArgs = new ErrorEventArgs();
                sessionErrorArgs.error = sessionError?.error;
                sessionErrorArgs.sessionId = sessionId;
                this._emit('sessionFailed', sessionErrorArgs);
                break;
                
            case ServerEventId.ASRInfo:
                const asrInfo = JSON.parse(payloadJson);
                const asrInfoArgs = new ASRResultEventArgs();
                asrInfoArgs.sessionId = sessionId;
                asrInfoArgs.questionId = asrInfo?.question_id;
                this._emit('asrInfoReceived', asrInfoArgs);
                break;
                
            case ServerEventId.ASRResponse:
                const asrResp = JSON.parse(payloadJson);
                if (asrResp?.results && asrResp.results.length > 0) {
                    const result = asrResp.results[0];
                    const asrArgs = new ASRResultEventArgs();
                    asrArgs.sessionId = sessionId;
                    asrArgs.text = result.text;
                    asrArgs.isInterim = result.is_interim;
                    this._emit('asrResultReceived', asrArgs);
                }
                break;
                
            case ServerEventId.ASREnded:
                const asrEndArgs = new ServerEventArgs();
                asrEndArgs.sessionId = sessionId;
                this._emit('asrEnded', asrEndArgs);
                break;
                
            case ServerEventId.ChatResponse:
                const chatResp = JSON.parse(payloadJson);
                const chatArgs = new ChatResponseEventArgs();
                chatArgs.sessionId = sessionId;
                chatArgs.content = chatResp?.content;
                chatArgs.questionId = chatResp?.question_id;
                chatArgs.replyId = chatResp?.reply_id;
                this._emit('chatResponseReceived', chatArgs);
                break;
                
            case ServerEventId.ChatEnded:
                const chatEnd = JSON.parse(payloadJson);
                const chatEndArgs = new ChatResponseEventArgs();
                chatEndArgs.sessionId = sessionId;
                chatEndArgs.questionId = chatEnd?.question_id;
                chatEndArgs.replyId = chatEnd?.reply_id;
                this._emit('chatEnded', chatEndArgs);
                break;

            case ServerEventId.TTSSentenceStart:
                const ttsStart = JSON.parse(payloadJson);
                const ttsStartArgs = new TTSStartEventArgs();
                ttsStartArgs.sessionId = sessionId;
                ttsStartArgs.ttsType = ttsStart?.tts_type;
                ttsStartArgs.text = ttsStart?.text;
                ttsStartArgs.questionId = ttsStart?.question_id;
                ttsStartArgs.replyId = ttsStart?.reply_id;
                this._emit('ttsSentenceStart', ttsStartArgs);
                break;

            case ServerEventId.TTSSentenceEnd:
                const ttsSentenceEnd = JSON.parse(payloadJson);
                const ttsSentenceEndArgs = new ServerEventArgs();
                ttsSentenceEndArgs.sessionId = sessionId;
                this._emit('ttsSentenceEnd', ttsSentenceEndArgs);
                break;
                
            case ServerEventId.TTSResponse:
                const ttsArgs = new AudioDataEventArgs();
                ttsArgs.sessionId = sessionId;
                ttsArgs.audioData = message.payload;
                this._emit('ttsAudioReceived', ttsArgs);
                break;

            case ServerEventId.TTSEnded:
                const ttsEnd = JSON.parse(payloadJson);
                const ttsEndArgs = new TTSEndEventArgs();
                ttsEndArgs.sessionId = sessionId;
                ttsEndArgs.questionId = ttsEnd?.question_id;
                ttsEndArgs.replyId = ttsEnd?.reply_id;
                ttsEndArgs.statusCode = ttsEnd?.status_code;
                this._emit('ttsEnded', ttsEndArgs);
                break;
                
            case ServerEventId.DialogCommonError:
                const error = JSON.parse(payloadJson);
                const errorArgs = new ErrorEventArgs();
                errorArgs.sessionId = sessionId;
                errorArgs.statusCode = error?.status_code;
                errorArgs.message = error?.message;
                this._emit('errorReceived', errorArgs);
                break;
                
            default:
                break;
        }
    }
    
    /**
     * @private
     */
    _ensureConnected() {
        if (!this.isConnected) {
            throw new Error('Not connected to server');
        }
    }
    
    /**
     * @private
     */
    _ensureSessionActive() {
        if (!this._isSessionActive) {
            throw new Error('No active session');
        }
    }
    
    /**
     * @private
     * @param {string} eventName 
     * @param {any} [data] 
     */
    _emit(eventName, data) {
        this.dispatchEvent(new CustomEvent(eventName, { detail: data }));
    }
    
    /**
     * @private
     * @param {number} ms 
     * @returns {Promise<void>}
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * @private
     * @returns {string}
     */
    _generateGuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    /**
     * 释放资源
     */
    dispose() {
        this.disconnectAsync().catch(() => {});
        this._abortController?.abort();
    }
}

// 事件名称常量
export const ClientEvents = {
    ConnectionStarted: 'connectionStarted',
    ConnectionFailed: 'connectionFailed',
    ConnectionFinished: 'connectionFinished',
    SessionStarted: 'sessionStarted',
    SessionFinished: 'sessionFinished',
    SessionFailed: 'sessionFailed',
    ASRInfoReceived: 'asrInfoReceived',
    ASRResultReceived: 'asrResultReceived',
    ASREnded: 'asrEnded',
    ChatResponseReceived: 'chatResponseReceived',
    ChatEnded: 'chatEnded',
    TTSSentenceStart: 'ttsSentenceStart',
    TTSSentenceEnd: 'ttsSentenceEnd',
    TTSAudioReceived: 'ttsAudioReceived',
    TTSEnded: 'ttsEnded',
    ErrorReceived: 'errorReceived'
};
