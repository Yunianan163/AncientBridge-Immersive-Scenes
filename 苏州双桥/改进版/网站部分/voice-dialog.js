// 语音对话模块 - 从 RealtimeDialog-Web 完整移植
// 使用 ES6 模块导入

import { RealtimeDialogClient, ClientEvents } from '../RealtimeDialog-Web/RealtimeDialogClient.js';
import { AudioRecorder, isAudioRecordingSupported, requestMicrophonePermission } from '../RealtimeDialog-Web/AudioRecorder.js';
import { AudioPlayer, isWebAudioSupported } from '../RealtimeDialog-Web/AudioPlayer.js';
import { ClientConfig, VoiceSpeakers, InputModes, ModelVersions } from '../RealtimeDialog-Web/config.js';
import { StartSessionRequest, AsrConfig, AudioInfo, AsrExtra, TtsConfig, TtsAudioConfig, DialogConfig, DialogExtra } from '../RealtimeDialog-Web/events.js';

// 语音对话应用类（适配主页面）
class VoiceDialogApp {
    constructor() {
        this.client = null;
        this.audioRecorder = null;
        this.audioPlayer = null;
        this.isRecording = false;
        this.isUserSpeaking = false;
        this.aiLineStarted = false;
        this._recordingPausedForPlayback = false;
        this._playbackMonitorInterval = null;
        this._ttsActiveCount = 0;
        this._resumeDelayTimeout = null;
        this._sessionReady = false;
        this._pendingHello = false;
        this._listenNodSent = false;

        this.initUI();
        this.checkBrowserSupport();
    }

    initUI() {
        // 适配主页面的元素 ID
        this.btnConnect = document.getElementById('btn-voice-connect');
        this.btnVoiceChat = document.getElementById('btn-voice-start');
        this.btnStop = document.getElementById('btn-voice-stop');
        this.btnSendText = document.getElementById('btn-voice-send');
        this.textInput = document.getElementById('voice-text-input');
        this.chatContainer = document.getElementById('voice-chat-container');
        this.recordingIndicator = document.getElementById('voice-recording-indicator');
        this.statusEl = document.getElementById('voice-status');

        this.btnConnect?.addEventListener('click', () => this.connect());
        this.btnVoiceChat?.addEventListener('click', () => this.startVoiceChat());
        this.btnStop?.addEventListener('click', () => this.stop());
        this.btnSendText?.addEventListener('click', () => this.sendText());
        this.textInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendText();
        });
    }

    async checkBrowserSupport() {
        const warnings = [];
        if (!isWebAudioSupported()) warnings.push('不支持 Web Audio API');
        if (!isAudioRecordingSupported()) warnings.push('不支持音频录制');
        if (!window.WebSocket) warnings.push('不支持 WebSocket');
        if (warnings.length > 0) {
            this.addSystemMessage('浏览器兼容警告: ' + warnings.join(', '));
        }
    }

    updateConnectionStatus(status, isError = false) {
        if (this.statusEl) {
            this.statusEl.textContent = status;
            this.statusEl.className = 'voice-status ' + (isError ? 'error' : (status === '已连接' ? 'connected' : ''));
        }
    }

    addMessage(text, isUser = false, isInterim = false) {
        if (!this.chatContainer) return;

        let messageEl;
        const existingId = isUser ? 'user-current' : 'ai-current';

        if (isInterim) {
            messageEl = document.getElementById(existingId);
            if (!messageEl) {
                messageEl = document.createElement('div');
                messageEl.id = existingId;
                messageEl.className = 'voice-message ' + (isUser ? 'user' : 'ai') + ' interim';
                this.chatContainer.appendChild(messageEl);
            }
            messageEl.textContent = text;
        } else {
            const tempEl = document.getElementById(existingId);
            if (tempEl) tempEl.remove();

            messageEl = document.createElement('div');
            messageEl.className = 'voice-message ' + (isUser ? 'user' : 'ai');
            messageEl.textContent = text;
            this.chatContainer.appendChild(messageEl);
        }

        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        return messageEl;
    }

    addSystemMessage(text) {
        if (!this.chatContainer) return;
        const messageEl = document.createElement('div');
        messageEl.className = 'voice-message voice-message-system';
        messageEl.textContent = text;
        this.chatContainer.appendChild(messageEl);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    async connect() {
        if (this.client?.isConnected) {
            this.addSystemMessage('已经连接了');
            return;
        }

        try {
            this.updateConnectionStatus('正在连接...');

            // 请求麦克风权限
            const hasPermission = await requestMicrophonePermission();
            if (!hasPermission) {
                this.addSystemMessage('需要麦克风权限才能进行语音对话');
                this.updateConnectionStatus('麦克风权限被拒绝', true);
                return;
            }

            // 创建配置和客户端
            const config = new ClientConfig();
            this.client = new RealtimeDialogClient(config);
            this.setupEventHandlers();

            // 连接服务器
            await this.client.connectAsync();
            this.updateConnectionStatus('已连接');
            this.addSystemMessage('✅ 连接成功！点击"开始对话"按钮开始语音交流。');
            this.enableButtons({ connect: false, voice: true, stop: true });

        } catch (error) {
            this.updateConnectionStatus('连接失败', true);
            this.addSystemMessage('❌ 连接失败: ' + error.message);
            console.error('[VoiceDialog] 连接错误:', error);
        }
    }

    async startVoiceChat() {
        if (!this.client?.isConnected) {
            this.addSystemMessage('请先连接服务器');
            return;
        }

        if (this.client?.isSessionActive) {
            this.addSystemMessage('对话已在进行中');
            return;
        }

        try {
            this._sessionReady = false;
            this._pendingHello = true;
            this.isUserSpeaking = false;

            // 初始化音频播放器
            this.audioPlayer = new AudioPlayer();
            this.audioPlayer.initialize();

            // 创建音频录制器并添加事件监听
            this.audioRecorder = new AudioRecorder();
            this.audioRecorder.addEventListener('audioDataAvailable', (event) => {
                if (this.client?.isSessionActive && this.isRecording && this._sessionReady) {
                    this.client.sendAudioAsync(event.detail).catch(err => {
                        console.error('[VoiceDialog] 发送音频失败:', err);
                    });
                }
            });

            // 创建会话请求
            const request = new StartSessionRequest();

            request.asr = new AsrConfig();
            request.asr.audio_info = new AudioInfo();
            request.asr.audio_info.format = 'pcm';
            request.asr.audio_info.sample_rate = 16000;
            request.asr.audio_info.channel = 1;
            // 启用双流式识别，这样才能收到临时识别结果用于打断
            request.asr.extra = new AsrExtra();
            request.asr.extra.enable_asr_twopass = true;

            request.tts = new TtsConfig();
            request.tts.speaker = VoiceSpeakers.Default;
            request.tts.audio_config = new TtsAudioConfig();
            request.tts.audio_config.format = 'pcm_s16le';
            request.tts.audio_config.sample_rate = 24000;
            request.tts.audio_config.channel = 1;

            request.dialog = new DialogConfig();
            request.dialog.bot_name = '沧朔';
            request.dialog.system_role = '本机器人是室外虚拟古桥场景专属的AI语音交流角色，功能仅围绕古桥历史与用户对话交流，不参与任何操作控制。整体形象设定可爱软萌，语音轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。它熟知古桥的建造年代、历史故事、民间传说与建筑变迁，能用轻松可爱的语气和用户聊天，耐心解答各种关于古桥历史的问题，讲解生动有趣，自带亲切感，让用户在愉快的对话中了解古桥的历史与文化。';
            request.dialog.speaking_style = '你说话可爱软萌、轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。';
            request.dialog.extra = new DialogExtra();
            request.dialog.extra.input_mod = InputModes.KeepAlive;
            request.dialog.extra.model = ModelVersions.O2_0;

            this.addSystemMessage('正在启动语音对话...');
            await this.client.startSessionAsync(request);

            this.updateConnectionStatus('语音对话中');
            this.enableButtons({ connect: false, voice: false, stop: true });

            // 启动播放监控
            this._startPlaybackMonitor();

        } catch (error) {
            this._pendingHello = false;
            this.addSystemMessage('❌ 启动失败: ' + error.message);
            console.error('[VoiceDialog] 启动语音对话失败:', error);
        }
    }

    // 发送开场白
    async _sendHello() {
        if (!this._pendingHello || !this.client?.isSessionActive) return;

        this._pendingHello = false;

        try {
            await new Promise(resolve => setTimeout(resolve, 500));

            const helloText = '你好呀～我是沧朔！是专门陪你聊古桥历史的小向导哦。不管是古桥的建造故事、年代变迁，还是和它有关的传说往事，我都可以慢慢讲给你听。快来和我聊聊你想知道的古桥历史吧～';

            this.addMessage(helloText, false);
            await this.client.sayHelloAsync(helloText);
            console.log('[VoiceDialog] 开场白已发送');

            await this._startRecordingSafe();

        } catch (error) {
            console.error('[VoiceDialog] 发送开场白失败:', error);
            await this._startRecordingSafe();
        }
    }

    // 安全开始录音
    async _startRecordingSafe() {
        if (!this.audioRecorder || this.isRecording || !this._sessionReady) return;
        if (this.audioPlayer?.isPlaying) {
            return;
        }

        try {
            await this.audioRecorder.startRecording();
            this.isRecording = true;
            this.showRecordingIndicator(true);
            console.log('[VoiceDialog] 开始录音');
        } catch (error) {
            console.error('[VoiceDialog] 开始录音失败:', error);
        }
    }

    // 启动播放监控
    _startPlaybackMonitor() {
        if (this._playbackMonitorInterval) return;
        this._playbackMonitorInterval = setInterval(() => this._handlePlaybackRecordingSync(), 50);
    }

    // 停止播放监控
    _stopPlaybackMonitor() {
        if (this._playbackMonitorInterval) {
            clearInterval(this._playbackMonitorInterval);
            this._playbackMonitorInterval = null;
        }
    }

    // 处理播放和录音的同步
    _handlePlaybackRecordingSync() {
        if (!this.audioPlayer || !this.audioRecorder || !this._sessionReady) return;

        const isPlaying = this.audioPlayer.isPlaying;

        // 只更新录音指示器状态显示，不实际暂停录音
        if (isPlaying && this.isRecording) {
            // AI在播放时，隐藏录音指示器（但录音仍在进行）
            if (this.recordingIndicator?.classList.contains('active')) {
                this.showRecordingIndicator(false);
            }
        } else if (!isPlaying && this.isRecording && !this.recordingIndicator?.classList.contains('active')) {
            // AI停止播放，显示录音指示器
            this.showRecordingIndicator(true);
        }
    }

    // 处理用户打断
    _handleUserInterruption(interimText) {
        if (!this.isUserSpeaking && this.audioPlayer?.isPlaying) {
            this.isUserSpeaking = true;
            console.log('[VoiceDialog] [打断] 检测到用户说话:', interimText);
            this.addSystemMessage('[打断] 检测到语音');

            // 1. 立即清空音频播放队列（本地打断）
            this.audioPlayer?.clear();

            // 2. 向服务器发送打断事件
            this.client?.sendClientInterruptAsync().then(() => {
                console.log('[VoiceDialog] [打断] ClientInterrupt事件已发送');
            }).catch(err => {
                console.error('[VoiceDialog] [打断] 发送打断事件失败:', err);
            });
        }
    }

    setupEventHandlers() {
        if (!this.client) return;

        this.aiLineStarted = false;

        // 会话已启动
        this.client.addEventListener(ClientEvents.SessionStarted, async (event) => {
            console.log('[VoiceDialog] 会话已启动', event.detail);
            this._sessionReady = true;
            this.isUserSpeaking = false;
            this.addSystemMessage('✅ 语音对话已就绪');

            // 发送开场白
            await this._sendHello();

            // 通知 Unity
            if (typeof sendToServer === 'function') {
                sendToServer({
                    type: 'robotConversationReady',
                    from: 'web',
                    time: new Date().toISOString()
                });
            }
        });

        // 会话已结束
        this.client.addEventListener(ClientEvents.SessionFinished, () => {
            console.log('[VoiceDialog] 会话已结束');
            this._sessionReady = false;
            this.isRecording = false;
            this.isUserSpeaking = false;
            this.showRecordingIndicator(false);
        });

        // 会话启动失败
        this.client.addEventListener(ClientEvents.SessionFailed, (event) => {
            console.error('[VoiceDialog] 会话启动失败:', event.detail);
            this._sessionReady = false;
            this._pendingHello = false;
            this.addSystemMessage('❌ 会话失败: ' + (event.detail?.error || '未知错误'));
        });

        // TTS开始 - AI开始说话
        this.client.addEventListener(ClientEvents.TTSSentenceStart, (event) => {
            console.log('[VoiceDialog] TTS开始:', event.detail?.text);
            this._ttsActiveCount++;
            
            // 通知 Unity 机器人开始说话动画（随机选择 Talk1 或 Talk2）
            const talkTrigger = Math.random() > 0.5 ? 'Talk1' : 'Talk2';
            if (typeof sendToServer === 'function') {
                sendToServer({
                    type: 'robotTalkStart',
                    trigger: talkTrigger,
                    from: 'web',
                    time: new Date().toISOString()
                });
            }
        });

        // TTS结束 - AI停止说话
        this.client.addEventListener(ClientEvents.TTSEnded, () => {
            this._ttsActiveCount = Math.max(0, this._ttsActiveCount - 1);
            
            // 通知 Unity 机器人停止说话动画
            if (typeof sendToServer === 'function') {
                sendToServer({
                    type: 'robotTalkEnd',
                    from: 'web',
                    time: new Date().toISOString()
                });
            }

            if (!this.isRecording && this._sessionReady && !this.audioPlayer?.isPlaying) {
                this._startRecordingSafe().catch(() => {});
            }
        });

        // ASR识别结果处理
        this.client.addEventListener(ClientEvents.ASRResultReceived, (event) => {
            const data = event.detail;
            console.log('[VoiceDialog] [ASR] 收到识别结果:', data.text, 'isInterim:', data.isInterim);
            
            if (data.isInterim) {
                // 临时结果 - 用户正在说话，触发打断
                this._handleUserInterruption(data.text);
                this.addMessage(data.text, true, true);
                
                // 通知 Unity 用户正在说话，触发倾听点头动画
                if (typeof sendToServer === 'function' && !this._listenNodSent) {
                    this._listenNodSent = true;
                    sendToServer({
                        type: 'robotListenNod',
                        trigger: 'ListenNod',
                        from: 'web',
                        time: new Date().toISOString()
                    });
                }
            } else {
                // 最终结果 - 用户说话结束，重置打断状态
                console.log('[VoiceDialog] [ASR] 最终结果，重置打断状态');
                this.addMessage(data.text, true);
                this.isUserSpeaking = false;
                this._listenNodSent = false;
                
                // 通知 Unity 用户说完，触发回应点头动画
                if (typeof sendToServer === 'function') {
                    sendToServer({
                        type: 'robotAfterUserNod',
                        trigger: 'AfterUserNod',
                        from: 'web',
                        time: new Date().toISOString()
                    });
                }
            }
        });

        // 对话回复处理
        this.client.addEventListener(ClientEvents.ChatResponseReceived, (event) => {
            const data = event.detail;
            if (data.content) {
                if (!this.aiLineStarted) {
                    this.aiLineStarted = true;
                }
                this.appendAIContent(data.content);
            }
        });

        // 对话结束
        this.client.addEventListener(ClientEvents.ChatEnded, () => {
            this.aiLineStarted = false;
            this.isUserSpeaking = false;
            this.finalizeAIMessage();
        });

        // TTS音频数据接收 - 关键：播放AI声音
        this.client.addEventListener(ClientEvents.TTSAudioReceived, (event) => {
            const data = event.detail;
            if (data.audioData && data.audioData.length > 0) {
                console.log('[VoiceDialog] 收到TTS音频数据:', data.audioData.length, 'bytes');
                this.audioPlayer?.play(data.audioData);
            }
        });

        // ASR结束
        this.client.addEventListener(ClientEvents.ASREnded, () => {
            console.log('[VoiceDialog] [ASR] ASR结束，用户停止说话');
            this.isUserSpeaking = false;
            this._listenNodSent = false;
        });

        // 错误处理
        this.client.addEventListener(ClientEvents.ErrorReceived, (event) => {
            const data = event.detail;
            console.error('[VoiceDialog] 收到错误:', data);
            this.addSystemMessage('⚠️ ' + (data.statusCode || '') + ': ' + (data.message || data.error));
        });

        // 连接事件
        this.client.addEventListener(ClientEvents.ConnectionStarted, () => {
            console.log('[VoiceDialog] 连接已启动');
        });

        this.client.addEventListener(ClientEvents.ConnectionFailed, (event) => {
            console.error('[VoiceDialog] 连接失败:', event.detail);
            this.updateConnectionStatus('连接失败', true);
        });

        this.client.addEventListener(ClientEvents.ConnectionFinished, () => {
            console.log('[VoiceDialog] 连接已结束');
            this._sessionReady = false;
            this.updateConnectionStatus('未连接');
            this.enableButtons({ connect: true, voice: false, stop: false });
        });
    }

    appendAIContent(text) {
        if (!this.chatContainer) return;

        let aiMessageEl = document.getElementById('ai-current-text');
        if (!aiMessageEl) {
            const msg = document.createElement('div');
            msg.className = 'voice-message ai streaming';
            aiMessageEl = document.createElement('span');
            aiMessageEl.id = 'ai-current-text';
            msg.appendChild(aiMessageEl);
            this.chatContainer.appendChild(msg);
        }

        aiMessageEl.textContent += text;
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    finalizeAIMessage() {
        const el = document.getElementById('ai-current-text');
        if (el) {
            el.removeAttribute('id');
            if (el.parentElement) {
                el.parentElement.classList.remove('streaming');
            }
        }
    }

    async sendText() {
        const text = this.textInput?.value.trim();
        if (!text) return;

        if (!this.client?.isConnected) {
            this.addSystemMessage('请先连接服务器');
            return;
        }

        try {
            if (!this.client?.isSessionActive) {
                // 如果没有活动会话，先启动会话
                this.audioPlayer = new AudioPlayer();
                this.audioPlayer.initialize();

                const request = new StartSessionRequest();
                request.asr = new AsrConfig();
                request.asr.audio_info = new AudioInfo();
                request.asr.audio_info.format = 'pcm';
                request.asr.audio_info.sample_rate = 16000;
                request.asr.audio_info.channel = 1;

                request.tts = new TtsConfig();
                request.tts.speaker = VoiceSpeakers.Default;
                request.tts.audio_config = new TtsAudioConfig();
                request.tts.audio_config.format = 'pcm_s16le';
                request.tts.audio_config.sample_rate = 24000;
                request.tts.audio_config.channel = 1;

                request.dialog = new DialogConfig();
                request.dialog.bot_name = '沧朔';
                request.dialog.system_role = '本机器人是室外虚拟古桥场景专属的AI语音交流角色，功能仅围绕古桥历史与用户对话交流，不参与任何操作控制。整体形象设定可爱软萌，语音轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。它熟知古桥的建造年代、历史故事、民间传说与建筑变迁，能用轻松可爱的语气和用户聊天，耐心解答各种关于古桥历史的问题，讲解生动有趣，自带亲切感，让用户在愉快的对话中了解古桥的历史与文化。';
                request.dialog.speaking_style = '你说话可爱软萌、轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。';
                request.dialog.extra = new DialogExtra();
                request.dialog.extra.input_mod = InputModes.Text;
                request.dialog.extra.model = ModelVersions.O2_0;

                await this.client.startSessionAsync(request);
                this.enableButtons({ connect: false, voice: false, stop: true });
            }

            this.addMessage(text, true);
            this.textInput.value = '';
            await this.client.sendChatTextQueryAsync(text);

        } catch (error) {
            this.addSystemMessage('❌ 发送失败: ' + error.message);
            console.error('[VoiceDialog] 发送文本失败:', error);
        }
    }

    async stop() {
        this._stopPlaybackMonitor();
        if (this._resumeDelayTimeout) clearTimeout(this._resumeDelayTimeout);

        if (this.client?.isSessionActive) {
            if (this.isRecording) {
                this.audioRecorder?.stopRecording();
                this.isRecording = false;
            }
            this.audioPlayer?.clear();

            try {
                await this.client.finishSessionAsync();
                this.addSystemMessage('✅ 对话已停止');
            } catch (error) {
                console.error('[VoiceDialog] 停止会话失败:', error);
            }

            this.showRecordingIndicator(false);

        } else if (this.client?.isConnected) {
            await this.client.disconnectAsync();
            this.audioPlayer?.dispose();
            this.audioRecorder?.dispose();
            this.addSystemMessage('✅ 已断开连接');
        }

        this._sessionReady = false;
        this._pendingHello = false;
        this._recordingPausedForPlayback = false;
        this._ttsActiveCount = 0;
        this.aiLineStarted = false;
        this.isUserSpeaking = false;

        this.updateConnectionStatus('未连接');
        this.enableButtons({ connect: true, voice: false, stop: false });
    }

    showRecordingIndicator(show) {
        if (this.recordingIndicator) {
            this.recordingIndicator.style.display = show ? 'flex' : 'none';
            if (show) {
                this.recordingIndicator.classList.add('active');
            } else {
                this.recordingIndicator.classList.remove('active');
            }
        }
    }

    enableButtons({ connect, voice, stop }) {
        if (this.btnConnect) this.btnConnect.disabled = !connect;
        if (this.btnVoiceChat) this.btnVoiceChat.disabled = !voice;
        if (this.btnStop) this.btnStop.disabled = !stop;
    }

    // 完全重置语音对话状态和内容
    reset() {
        // 停止所有进行中的操作
        this._stopPlaybackMonitor();
        if (this._resumeDelayTimeout) clearTimeout(this._resumeDelayTimeout);
        
        // 停止录音
        if (this.isRecording && this.audioRecorder) {
            this.audioRecorder.stopRecording();
            this.isRecording = false;
        }
        
        // 清空音频播放
        if (this.audioPlayer) {
            this.audioPlayer.clear();
            this.audioPlayer.dispose();
            this.audioPlayer = null;
        }
        
        // 关闭会话和连接
        if (this.client) {
            if (this.client.isSessionActive) {
                this.client.finishSessionAsync().catch(() => {});
            }
            if (this.client.isConnected) {
                this.client.disconnectAsync().catch(() => {});
            }
            // 移除所有事件监听器
            this.client.removeAllListeners?.();
            this.client = null;
        }
        
        // 释放录音器
        if (this.audioRecorder) {
            this.audioRecorder.dispose?.();
            this.audioRecorder = null;
        }
        
        // 重置所有状态变量
        this._sessionReady = false;
        this._pendingHello = false;
        this._recordingPausedForPlayback = false;
        this._ttsActiveCount = 0;
        this.aiLineStarted = false;
        this.isUserSpeaking = false;
        this.isRecording = false;
        this._listenNodSent = false;
        
        // 清空聊天记录
        if (this.chatContainer) {
            this.chatContainer.innerHTML = '';
        }
        
        // 重置UI状态
        this.updateConnectionStatus('未连接');
        this.showRecordingIndicator(false);
        this.enableButtons({ connect: true, voice: false, stop: false });
        
        // 添加欢迎消息
        this.addSystemMessage('欢迎与机器人沧朔对话！点击"开始对话"按钮开始语音交流。');
        
        console.log('[VoiceDialog] 语音对话已完全重置');
    }
}

// 导出供全局使用
window.VoiceDialogApp = VoiceDialogApp;

// 显示语音对话面板
window.showVoiceDialog = function() {
    const panel = document.getElementById('voice-dialog-panel');
    if (!panel) {
        console.error('语音对话面板不存在');
        return;
    }
    
    panel.style.display = 'flex';
    
    // 初始化应用（如果还没初始化）
    if (!window.voiceDialogApp) {
        window.voiceDialogApp = new VoiceDialogApp();
    }
    
    // 添加日志
    if (typeof addLog === 'function') {
        addLog('系统：语音对话面板已显示', 'system');
    }
};

// 关闭语音对话面板
window.closeVoiceDialog = function() {
    const panel = document.getElementById('voice-dialog-panel');
    if (!panel) return;
    
    panel.style.display = 'none';
    
    // 停止录音和连接
    if (window.voiceDialogApp) {
        window.voiceDialogApp.stop();
    }
    
    if (typeof addLog === 'function') {
        addLog('系统：语音对话面板已关闭', 'system');
    }
    
    // 更新入口按钮状态为"进入"
    updateRobotEntryButtonState(false);
};

// 初始化
console.log('[VoiceDialog] 语音对话模块已加载');
