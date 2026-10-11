import { RealtimeDialogClient, ClientEvents } from './RealtimeDialogClient.js';
import { AudioRecorder, isAudioRecordingSupported, requestMicrophonePermission } from './AudioRecorder.js';
import { AudioPlayer, isWebAudioSupported } from './AudioPlayer.js';
import { ClientConfig, VoiceSpeakers, InputModes, ModelVersions } from './config.js';
import { StartSessionRequest, AsrConfig, AudioInfo, AsrExtra, TtsConfig, TtsAudioConfig, DialogConfig, DialogExtra } from './events.js';

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

        this.initUI();
        this.checkBrowserSupport();
    }

    initUI() {
        this.btnConnect = document.getElementById('btnConnect');
        this.btnVoiceChat = document.getElementById('btnVoiceChat');
        this.btnStop = document.getElementById('btnStop');
        this.btnSendText = document.getElementById('btnSendText');
        this.textInput = document.getElementById('textInput');
        this.chatContainer = document.getElementById('chatContainer');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.connectionStatus = document.getElementById('connectionStatus');

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
            alert('浏览器兼容警告:' + warnings.join(''));
        }
    }

    updateConnectionStatus(status, isError = false) {
        if (this.connectionStatus) {
            this.connectionStatus.textContent = status;
            this.connectionStatus.className = isError ? 'status error' : (status === '已连接' ? 'status connected' : 'status');
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
                messageEl.className = 'message ' + (isUser ? 'user' : 'ai') + ' interim';
                this.chatContainer.appendChild(messageEl);
            }
            messageEl.textContent = text;
        } else {
            const tempEl = document.getElementById(existingId);
            if (tempEl) tempEl.remove();

            messageEl = document.createElement('div');
            messageEl.className = 'message ' + (isUser ? 'user' : 'ai');
            messageEl.textContent = text;
            this.chatContainer.appendChild(messageEl);
        }

        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        return messageEl;
    }

    addSystemMessage(text) {
        if (!this.chatContainer) return;
        const messageEl = document.createElement('div');
        messageEl.className = 'message system';
        messageEl.textContent = text;
        this.chatContainer.appendChild(messageEl);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    async connect() {
        if (this.client?.isConnected) {
            this.addSystemMessage('已经连接');
            return;
        }

        try {
            this.updateConnectionStatus('正在连接...');

            const hasPermission = await requestMicrophonePermission();
            if (!hasPermission) {
                alert('请允许麦克风权限以使用语音功能');
                this.updateConnectionStatus('麦克风权限被拒绝', true);
                return;
            }

            const config = new ClientConfig();
            this.client = new RealtimeDialogClient(config);
            this.setupEventHandlers();

            await this.client.connectAsync();
            this.updateConnectionStatus('已连接');
            this.addSystemMessage('✅ 连接成功，可以开始语音对话');
            this.btnVoiceChat.disabled = false;

        } catch (error) {
            this.updateConnectionStatus('连接失败', true);
            this.addSystemMessage('❌ 连接失败: ' + error.message);
            console.error('[App] 连接错误:', error);
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

            this.audioPlayer = new AudioPlayer();
            this.audioPlayer.initialize();

            this.audioRecorder = new AudioRecorder();
            this.audioRecorder.addEventListener('audioDataAvailable', (event) => {
                if (this.client?.isSessionActive && this.isRecording && this._sessionReady) {
                    this.client.sendAudioAsync(event.detail).catch(err => {
                        console.error('[App] 发送音频失败:', err);
                    });
                }
            });

            const request = new StartSessionRequest();

            request.asr = new AsrConfig();
            request.asr.audio_info = new AudioInfo();
            request.asr.audio_info.format = 'pcm';
            request.asr.audio_info.sample_rate = 16000;
            request.asr.audio_info.channel = 1;
            // 关键修改：启用双流式识别，这样才能收到临时识别结果用于打断
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
            this.btnVoiceChat.disabled = true;
            this.btnStop.disabled = false;

            this._startPlaybackMonitor();

        } catch (error) {
            this._pendingHello = false;
            this.addSystemMessage('❌ 启动失败: ' + error.message);
            console.error('[App] 启动语音对话失败:', error);
        }
    }

    async _sendHello() {
        if (!this._pendingHello || !this.client?.isSessionActive) return;

        this._pendingHello = false;

        try {
            await new Promise(resolve => setTimeout(resolve, 500));

            const helloText = '你好呀～我是沧朔！是专门陪你聊古桥历史的小向导哦。不管是古桥的建造故事、年代变迁，还是和它有关的传说往事，我都可以慢慢讲给你听。快来和我聊聊你想知道的古桥历史吧～';

            this.addMessage(helloText, false);
            await this.client.sayHelloAsync(helloText);
            console.log('[App] 开场白已发送');

            await this._startRecordingSafe();

        } catch (error) {
            console.error('[App] 发送开场白失败:', error);
            await this._startRecordingSafe();
        }
    }

    async _startRecordingSafe() {
        if (!this.audioRecorder || this.isRecording || !this._sessionReady) return;
        if (this.audioPlayer?.isPlaying) {
            return;
        }

        try {
            await this.audioRecorder.startRecording();
            this.isRecording = true;
            this.showRecordingStatus(true);
            console.log('[App] 开始录音');
        } catch (error) {
            console.error('[App] 开始录音失败:', error);
        }
    }

    _startPlaybackMonitor() {
        if (this._playbackMonitorInterval) return;
        this._playbackMonitorInterval = setInterval(() => this._handlePlaybackRecordingSync(), 50);
    }

    _stopPlaybackMonitor() {
        if (this._playbackMonitorInterval) {
            clearInterval(this._playbackMonitorInterval);
            this._playbackMonitorInterval = null;
        }
    }

    /**
     * 关键修改：AI播放时不暂停录音，否则无法检测用户打断
     * 回声消除由浏览器/服务端处理
     */
    _handlePlaybackRecordingSync() {
        if (!this.audioPlayer || !this.audioRecorder || !this._sessionReady) return;

        const isPlaying = this.audioPlayer.isPlaying;

        // 注释掉暂停录音的逻辑，保持始终录音以支持打断
        /*
        if (isPlaying && this.isRecording && !this._recordingPausedForPlayback) {
            this.audioRecorder.pauseRecording();
            this._recordingPausedForPlayback = true;
            this.showRecordingStatus(false);
            if (this._resumeDelayTimeout) clearTimeout(this._resumeDelayTimeout);

        } else if (!isPlaying && this._recordingPausedForPlayback && !this._resumeDelayTimeout) {
            this._resumeDelayTimeout = setTimeout(() => {
                this._resumeDelayTimeout = null;
                if (!this.audioPlayer?.isPlaying && this._recordingPausedForPlayback && this._sessionReady) {
                    this.audioRecorder.resumeRecording();
                    this._recordingPausedForPlayback = false;
                    this.showRecordingStatus(true);
                }
            }, 300);
        }
        */
        
        // 只更新录音指示器状态显示，不实际暂停录音
        if (isPlaying && this.isRecording) {
            // AI在播放时，隐藏录音指示器（但录音仍在进行）
            // 这样用户界面更合理，但后台仍在监听打断
            if (this.statusIndicator?.classList.contains('active')) {
                this.showRecordingStatus(false);
            }
        } else if (!isPlaying && this.isRecording && !this.statusIndicator?.classList.contains('active')) {
            // AI停止播放，显示录音指示器
            this.showRecordingStatus(true);
        }
    }

    /**
     * 智能打断处理
     */
    _handleUserInterruption(interimText) {
        // 只要检测到临时结果且AI在播放，就触发打断
        if (!this.isUserSpeaking && this.audioPlayer?.isPlaying) {
            this.isUserSpeaking = true;
            console.log('[App] [打断] 检测到用户说话:', interimText);
            this.addSystemMessage('[打断] 检测到语音');

            // 1. 立即清空音频播放队列（本地打断）
            this.audioPlayer?.clear();

            // 2. 向服务器发送打断事件
            this.client?.sendClientInterruptAsync().then(() => {
                console.log('[App] [打断] ClientInterrupt事件已发送');
            }).catch(err => {
                console.error('[App] [打断] 发送打断事件失败:', err);
            });
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
                request.dialog.system_role = '本机器人是室外虚拟古桥场景专属的AI语音交流角色...';
                request.dialog.speaking_style = '你说话可爱软萌...';
                request.dialog.extra = new DialogExtra();
                request.dialog.extra.input_mod = InputModes.Text;
                request.dialog.extra.model = ModelVersions.O2_0;

                await this.client.startSessionAsync(request);
                this.btnStop.disabled = false;
            }

            this.addMessage(text, true);
            this.textInput.value = '';
            await this.client.sendChatTextQueryAsync(text);

        } catch (error) {
            this.addSystemMessage('❌ 发送失败: ' + error.message);
            console.error('[App] 发送文本失败:', error);
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
                console.error('[App] 停止会话失败:', error);
            }

            this.showRecordingStatus(false);

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

        this.updateConnectionStatus('已断开');
        this.btnVoiceChat.disabled = false;
        this.btnStop.disabled = true;
    }

    setupEventHandlers() {
        if (!this.client) return;

        this.aiLineStarted = false;

        this.client.addEventListener(ClientEvents.SessionStarted, async (event) => {
            console.log('[App] 会话已启动', event.detail);
            this._sessionReady = true;
            this.isUserSpeaking = false;
            this.addSystemMessage('✅ 语音对话已就绪');

            await this._sendHello();
        });

        this.client.addEventListener(ClientEvents.SessionFinished, () => {
            console.log('[App] 会话已结束');
            this._sessionReady = false;
            this.isRecording = false;
            this.isUserSpeaking = false;
            this.showRecordingStatus(false);
        });

        this.client.addEventListener(ClientEvents.SessionFailed, (event) => {
            console.error('[App] 会话启动失败:', event.detail);
            this._sessionReady = false;
            this._pendingHello = false;
            this.addSystemMessage('❌ 会话失败: ' + (event.detail?.error || '未知错误'));
        });

        this.client.addEventListener(ClientEvents.TTSSentenceStart, (event) => {
            console.log('[App] TTS开始:', event.detail?.text);
            this._ttsActiveCount++;
        });

        this.client.addEventListener(ClientEvents.TTSEnded, () => {
            this._ttsActiveCount = Math.max(0, this._ttsActiveCount - 1);

            if (!this.isRecording && this._sessionReady && !this.audioPlayer?.isPlaying) {
                this._startRecordingSafe().catch(() => {});
            }
        });

        // ASR识别结果处理
        this.client.addEventListener(ClientEvents.ASRResultReceived, (event) => {
            const data = event.detail;
            console.log('[ASR事件] 收到识别结果:', data.text, 'isInterim:', data.isInterim);
            
            if (data.isInterim) {
                // 临时结果 - 用户正在说话，触发打断
                this._handleUserInterruption(data.text);
                this.addMessage(data.text, true, true);
            } else {
                // 最终结果 - 用户说话结束，重置打断状态
                console.log('[ASR事件] 最终结果，重置打断状态');
                this.addMessage(data.text, true);
                this.isUserSpeaking = false;
            }
        });

        this.client.addEventListener(ClientEvents.ChatResponseReceived, (event) => {
            const data = event.detail;
            if (data.content) {
                if (!this.aiLineStarted) {
                    this.aiLineStarted = true;
                }
                this.appendAIContent(data.content);
            }
        });

        this.client.addEventListener(ClientEvents.ChatEnded, () => {
            this.aiLineStarted = false;
            this.isUserSpeaking = false;
            this.finalizeAIMessage();
        });

        this.client.addEventListener(ClientEvents.TTSAudioReceived, (event) => {
            const data = event.detail;
            if (data.audioData && data.audioData.length > 0) {
                console.log('[App] 收到TTS音频数据:', data.audioData.length, 'bytes');
                this.audioPlayer?.play(data.audioData);
            }
        });

        // ASR结束 - 用户说话结束
        this.client.addEventListener(ClientEvents.ASREnded, () => {
            console.log('[ASR事件] ASR结束，用户停止说话');
            this.isUserSpeaking = false;
        });

        this.client.addEventListener(ClientEvents.ErrorReceived, (event) => {
            const data = event.detail;
            console.error('[App] 收到错误:', data);
            this.addSystemMessage('⚠️ ' + (data.statusCode || '') + ': ' + (data.message || data.error));
        });

        this.client.addEventListener(ClientEvents.ConnectionStarted, () => {
            console.log('[App] 连接已启动');
        });

        this.client.addEventListener(ClientEvents.ConnectionFailed, (event) => {
            console.error('[App] 连接失败:', event.detail);
            this.updateConnectionStatus('连接失败', true);
        });

        this.client.addEventListener(ClientEvents.ConnectionFinished, () => {
            console.log('[App] 连接已结束');
            this._sessionReady = false;
        });
    }

    appendAIContent(text) {
        if (!this.chatContainer) return;

        let aiMessageEl = document.getElementById('ai-current-text');
        if (!aiMessageEl) {
            const msg = document.createElement('div');
            msg.className = 'message ai streaming';
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

    showRecordingStatus(show) {
        if (this.statusIndicator) {
            this.statusIndicator.style.display = show ? 'flex' : 'none';
            if (show) {
                this.statusIndicator.classList.add('active');
            } else {
                this.statusIndicator.classList.remove('active');
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.voiceApp = new VoiceDialogApp();
    console.log('[App] 语音对话应用已初始化');
});