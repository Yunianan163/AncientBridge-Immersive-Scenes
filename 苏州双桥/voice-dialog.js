// 语音对话模块 - 从 RealtimeDialog-Web 完整移植
// 使用 ES6 模块导入

import { RealtimeDialogClient, ClientEvents } from './RealtimeDialog-Web/RealtimeDialogClient.js';
import { AudioRecorder, isAudioRecordingSupported, requestMicrophonePermission } from './RealtimeDialog-Web/AudioRecorder.js';
import { AudioPlayer, isWebAudioSupported } from './RealtimeDialog-Web/AudioPlayer.js';
import { ClientConfig, VoiceSpeakers, InputModes, ModelVersions } from './RealtimeDialog-Web/config.js';
import { StartSessionRequest, AsrConfig, AudioInfo, AsrExtra, TtsConfig, TtsAudioConfig, DialogConfig, DialogExtra } from './RealtimeDialog-Web/events.js';

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
        this._micPermissionOverlay = null;

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

    _injectMicPermissionStyles() {
        if (document.getElementById('mic-permission-styles')) return;
        const style = document.createElement('style');
        style.id = 'mic-permission-styles';
        style.textContent = `
            #mic-permission-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .mic-permission-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
            }
            .mic-permission-modal {
                position: relative;
                background: #fff;
                border-radius: 16px;
                padding: 32px 28px;
                width: 90%;
                max-width: 420px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
                animation: micPermissionFadeIn 0.3s ease;
            }
            @keyframes micPermissionFadeIn {
                from { opacity: 0; transform: translateY(20px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .mic-permission-icon {
                font-size: 48px;
                margin-bottom: 12px;
            }
            .mic-permission-title {
                font-size: 20px;
                font-weight: 700;
                color: #333;
                margin: 0 0 10px;
            }
            .mic-permission-desc {
                font-size: 14px;
                color: #666;
                margin: 0 0 16px;
                line-height: 1.5;
            }
            .mic-permission-btn {
                display: block;
                width: 100%;
                padding: 12px;
                border: none;
                border-radius: 8px;
                font-size: 15px;
                font-weight: 600;
                cursor: pointer;
                margin-bottom: 10px;
                transition: all 0.2s;
            }
            .mic-permission-btn-primary {
                background: #4CAF50;
                color: #fff;
            }
            .mic-permission-btn-primary:hover {
                background: #43a047;
            }
            .mic-permission-btn-primary:disabled {
                background: #a5d6a7;
                cursor: not-allowed;
            }
            .mic-permission-btn-secondary {
                background: #f5f5f5;
                color: #666;
            }
            .mic-permission-btn-secondary:hover {
                background: #e0e0e0;
            }
            .mic-permission-alert {
                background: #fff3cd;
                border: 1px solid #ffc107;
                color: #856404;
                border-radius: 8px;
                padding: 10px 12px;
                font-size: 14px;
                font-weight: 600;
                margin-bottom: 12px;
            }
            .mic-permission-steps {
                text-align: left;
                background: #f8f9fa;
                border-radius: 8px;
                padding: 14px 18px;
                margin-bottom: 14px;
                font-size: 13px;
                color: #555;
                line-height: 1.6;
            }
            .mic-permission-steps p {
                margin: 0 0 8px;
                font-weight: 600;
                color: #333;
            }
            .mic-permission-steps ol {
                margin: 0;
                padding-left: 18px;
            }
            .mic-permission-steps li {
                margin-bottom: 4px;
            }
            .mic-state-block {
                display: none;
            }
            .mic-state-block.active {
                display: block;
            }
            .mic-diagnostic {
                margin-top: 16px;
                padding: 10px;
                background: #f0f0f0;
                border-radius: 6px;
                font-size: 11px;
                color: #666;
                line-height: 1.5;
                text-align: left;
                word-break: break-all;
            }
        `;
        document.head.appendChild(style);
    }

    async _showMicPermissionDialog(error = null) {
        return new Promise(async (resolve) => {
            this._injectMicPermissionStyles();
            this._removeMicPermissionDialog();

            // 收集诊断信息
            const isSecure = !!(window.isSecureContext);
            let permissionState = 'unknown';
            try {
                if (navigator.permissions && navigator.permissions.query) {
                    const result = await navigator.permissions.query({ name: 'microphone' });
                    permissionState = result.state;
                }
            } catch (e) {
                permissionState = 'query-failed';
            }

            // 判断默认显示哪个视图
            let defaultView = 'prompt';
            if (!isSecure) {
                defaultView = 'insecure';
            } else if (error) {
                if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                    defaultView = 'hardware';
                } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError') {
                    if (permissionState === 'denied') {
                        defaultView = 'denied';
                    } else {
                        defaultView = 'prompt';
                    }
                }
            } else if (permissionState === 'denied') {
                defaultView = 'denied';
            }

            const overlay = document.createElement('div');
            overlay.id = 'mic-permission-overlay';
            overlay.innerHTML = `
                <div class="mic-permission-backdrop"></div>
                <div class="mic-permission-modal">
                    <div class="mic-permission-content">
                        <div class="mic-permission-icon">🎤</div>
                        <h3 class="mic-permission-title">需要麦克风权限</h3>
                        <p class="mic-permission-desc">语音对话功能需要使用您的麦克风才能正常进行语音交流。</p>
                        
                        <div id="mic-state-prompt" class="mic-state-block ${defaultView === 'prompt' ? 'active' : ''}">
                            <button id="mic-permission-allow" class="mic-permission-btn mic-permission-btn-primary">开启麦克风权限</button>
                        </div>
                        
                        <div id="mic-state-denied" class="mic-state-block ${defaultView === 'denied' ? 'active' : ''}">
                            <div class="mic-permission-alert">⚠️ 麦克风权限已被浏览器阻止</div>
                            <div class="mic-permission-steps">
                                <p>请按以下步骤手动开启权限：</p>
                                <ol>
                                    <li>点击浏览器地址栏左侧的 <strong>🔒 锁形图标</strong>（或 <strong>ℹ️ 信息图标</strong>）</li>
                                    <li>找到"网站设置"或"权限"选项</li>
                                    <li>将<strong>麦克风</strong>权限改为<strong>"允许"</strong></li>
                                    <li>刷新当前页面后，重新点击"连接"</li>
                                </ol>
                            </div>
                            <button id="mic-permission-retry" class="mic-permission-btn mic-permission-btn-primary">我已开启，重新检测</button>
                        </div>
                        
                        <div id="mic-state-insecure" class="mic-state-block ${defaultView === 'insecure' ? 'active' : ''}">
                            <div class="mic-permission-alert">🔒 当前连接方式不支持麦克风</div>
                            <div class="mic-permission-steps">
                                <p>浏览器要求麦克风必须在安全环境中使用。</p>
                                <ol>
                                    <li>请在服务器本机使用 <strong>http://127.0.0.1:${window.location.port}</strong> 或 <strong>http://localhost:${window.location.port}</strong> 访问</li>
                                    <li>或者为网站配置 <strong>HTTPS</strong> 证书后通过 https:// 访问</li>
                                    <li>直接通过局域网 IP（如 192.168.x.x）访问不支持麦克风功能</li>
                                </ol>
                            </div>
                        </div>
                        
                        <div id="mic-state-hardware" class="mic-state-block ${defaultView === 'hardware' ? 'active' : ''}">
                            <div class="mic-permission-alert">🎤 未检测到麦克风设备</div>
                            <div class="mic-permission-steps">
                                <p>请检查以下问题：</p>
                                <ol>
                                    <li>确保电脑已连接麦克风或耳机</li>
                                    <li>检查麦克风是否被其他程序（如微信、Zoom）占用</li>
                                    <li>检查操作系统隐私设置中是否允许浏览器使用麦克风</li>
                                </ol>
                            </div>
                            <button id="mic-permission-retry-hardware" class="mic-permission-btn mic-permission-btn-primary">重新检测</button>
                        </div>
                        
                        <button id="mic-permission-cancel" class="mic-permission-btn mic-permission-btn-secondary">取消</button>
                        
                        <div class="mic-diagnostic">
                            <strong>诊断信息</strong>（如遇问题请截图此区域）<br>
                            当前地址: ${window.location.href}<br>
                            安全上下文: ${isSecure ? '是 ✅' : '否 ❌'}<br>
                            权限状态: ${permissionState}<br>
                            错误类型: ${error ? error.name : '无'}<br>
                            错误信息: ${error ? error.message : '无'}
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            this._micPermissionOverlay = overlay;

            const allowBtn = document.getElementById('mic-permission-allow');
            const retryBtn = document.getElementById('mic-permission-retry');
            const retryHardwareBtn = document.getElementById('mic-permission-retry-hardware');
            const cancelBtn = document.getElementById('mic-permission-cancel');

            const tryGetPermission = async (btn) => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(track => track.stop());
                    this._removeMicPermissionDialog();
                    resolve(true);
                } catch (err) {
                    console.error('[VoiceDialog] 请求麦克风权限失败:', err);
                    // 根据错误类型切换到对应视图
                    const promptBlock = document.getElementById('mic-state-prompt');
                    const deniedBlock = document.getElementById('mic-state-denied');
                    const hardwareBlock = document.getElementById('mic-state-hardware');
                    if (promptBlock) promptBlock.classList.remove('active');
                    if (deniedBlock) deniedBlock.classList.add('active');
                    if (hardwareBlock) hardwareBlock.classList.remove('active');
                    if (btn) {
                        btn.textContent = '权限被拒绝';
                        btn.disabled = true;
                        setTimeout(() => {
                            if (btn) {
                                btn.textContent = btn.id === 'mic-permission-retry' ? '我已开启，重新检测' : (btn.id === 'mic-permission-retry-hardware' ? '重新检测' : '开启麦克风权限');
                                btn.disabled = false;
                            }
                        }, 2500);
                    }
                }
            };

            if (allowBtn) {
                allowBtn.addEventListener('click', () => tryGetPermission(allowBtn));
            }

            if (retryBtn) {
                retryBtn.addEventListener('click', () => tryGetPermission(retryBtn));
            }

            if (retryHardwareBtn) {
                retryHardwareBtn.addEventListener('click', () => tryGetPermission(retryHardwareBtn));
            }

            cancelBtn.addEventListener('click', () => {
                this._removeMicPermissionDialog();
                this.addSystemMessage('已取消麦克风权限请求');
                resolve(false);
            });
        });
    }

    _removeMicPermissionDialog() {
        if (this._micPermissionOverlay) {
            this._micPermissionOverlay.remove();
            this._micPermissionOverlay = null;
        }
        const existing = document.getElementById('mic-permission-overlay');
        if (existing) existing.remove();
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
        // 关闭机器人出现在双桥上语音导览
        if (typeof window.closeRobotAppearedGuide === 'function') {
            window.closeRobotAppearedGuide();
        }

        if (this.client?.isConnected) {
            this.addSystemMessage('已经连接了');
            return;
        }

        try {
            this.updateConnectionStatus('正在连接...');

            // 请求麦克风权限
            let hasPermission = false;
            let micError = null;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                hasPermission = true;
            } catch (err) {
                micError = err;
                hasPermission = false;
            }
            
            if (!hasPermission) {
                this.addSystemMessage('需要麦克风权限才能进行语音对话');
                // 显示权限弹窗，等待用户交互后再次请求
                hasPermission = await this._showMicPermissionDialog(micError);
                if (!hasPermission) {
                    this.updateConnectionStatus('麦克风权限被拒绝', true);
                    return;
                }
            }

            // 创建配置和客户端
            const config = new ClientConfig();
            // 根据当前页面端口动态匹配语音代理端口
            const currentPort = window.location.port || '8082';
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            config.webSocketUrl = `${wsProtocol}//${window.location.host}/voice-proxy`;
            console.log('[VoiceDialog] 使用语音代理地址:', config.webSocketUrl);
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
            
            // 通知 Unity 机器人开始说话动画（Unity端有防抖，重复触发不会打断循环）
            if (typeof sendToServer === 'function') {
                sendToServer({
                    type: 'robotTalkStart',
                    from: 'web',
                    time: new Date().toISOString()
                });
            }
        });

        // TTS结束 - AI停止说话
        this.client.addEventListener(ClientEvents.TTSEnded, () => {
            this._ttsActiveCount = Math.max(0, this._ttsActiveCount - 1);
            
            // 延迟通知 Unity 停止说话动画，直到音频真正播放完毕，保证动作持续
            const tryStopTalk = () => {
                if (this.audioPlayer?.isPlaying) {
                    setTimeout(tryStopTalk, 100);
                    return;
                }
                
                // 通知 Unity 机器人停止说话动画
                if (typeof sendToServer === 'function') {
                    sendToServer({
                        type: 'robotTalkEnd',
                        from: 'web',
                        time: new Date().toISOString()
                    });
                }

                if (!this.isRecording && this._sessionReady) {
                    this._startRecordingSafe().catch(() => {});
                }
            };
            tryStopTalk();
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
    
    // 初始化应用（如果还没初始化或不是新实现实例）
    if (!window.voiceDialogApp || typeof window.voiceDialogApp.connect !== 'function') {
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
