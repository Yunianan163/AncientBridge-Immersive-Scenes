/**
 * voice.js — 葛镜桥「实时语音对话」（豆包实时语音 3.0 / Seeduplex）
 *
 * ## 它做什么
 *
 * 点右下角的语音按钮 → 连本机代理 → 建会话 → 麦克风持续上行 20 ms PCM →
 * 模型边听边说，回复的文字进面板、音频直接播出来。
 *
 * ## 为什么要走代理
 *
 * 连豆包上游要带凭据。浏览器拿到的 js 任何人都能下载，把密钥放这里等于公开
 * （苏州双桥当年就是这么泄的，见项目体检报告 H6）。所以浏览器只连本机
 * `ws://127.0.0.1:8124/voice-proxy`，凭据在 tools/voice-proxy.mjs 里。
 *
 * ## 协议要点（对应 Seeduplex 文档）
 *
 * 上下行都是 **JSON 文本帧**，按 `type` 派发：
 *   上行 session.create / input_audio_buffer.append / input_audio_mute.commit /
 *        input_audio_unmute.commit / response.cancel / session.close
 *   下行 session.created / conversation.item.input_audio_transcription.* /
 *        response.output_text.* / response.output_audio.* / response.done / error
 *
 * ## 两个容易踩的坑
 *
 * 1. **上行必须严格按实时节奏**：16k/int16 下每包 640 字节（20 ms），
 *    发快了发慢了服务端都报错。所以切片在 AudioWorklet 里按采样数切，
 *    不用定时器 —— 248 MB 高斯场景一卡，定时器就会飘。
 * 2. **模型靠上行音频流保活**：切到后台不再发音频时，必须主动发
 *    `input_audio_mute.commit`，否则服务端等不到音频会超时，模型就没反应了。
 *    这里用 visibilitychange 处理。
 */

/** 默认代理地址；换机器可用 ?voice=http://host:port 覆盖（与 snapshot.js 的 ?api= 同一套路） */
const DEFAULT_BASE = 'http://127.0.0.1:8124'

function proxyBase() {
    try {
        const override = new URLSearchParams(window.location.search).get('voice')
        if (override) return override.replace(/\/+$/, '')
    } catch (e) { /* 用默认值 */ }
    return DEFAULT_BASE
}

const base64FromBuffer = (buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    // 分块拼接：一次 apply 整个几万长度的数组会爆调用栈
    const STEP = 0x8000
    for (let i = 0; i < bytes.length; i += STEP) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP))
    }
    return btoa(binary)
}

const bytesFromBase64 = (b64) => {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

/**
 * 从下行事件里取文字。
 *
 * ⚠️ 字段名**不是唯一的**。这段兜底顺序是照官方 Web Demo 的 `extractEventText()` 抄的：
 *     event.text || event.delta || event.transcript || event.content || ""
 * 少写一个兜底不会报错，只会表现为「面板一片空白」，最难查。
 */
const extractEventText = (event) => event.text || event.delta || event.transcript || event.content || ''

/** 同上，取音频。官方顺序是 `audio` 在前、`delta` 在后 */
const extractEventAudio = (event) => event.audio || event.delta || ''

/* ============================================================== 对话会话 */

class VoiceDialog {
    /** @param {import('./ui.js').UI} ui */
    constructor(ui) {
        this.ui = ui
        this.ws = null
        this.cfg = null

        this.captureCtx = null
        this.micStream = null
        this.worklet = null
        this.silentGain = null

        this.playCtx = null
        this.playGain = null
        this.sources = []
        this.nextTime = 0

        this.log = []
        /**
         * 麦克风静音：静音期间**仍然每 20 ms 发一包**，只是内容换成静音帧。
         * 绝不能停发 —— 模型靠上行音频流保活（官方 Demo 就是这么做的）。
         */
        this.micMuted = false
        /** 下行音频格式只在第一包校验一次，免得每包都判 */
        this._audioFormatChecked = false
        /** 上一片上行音频的发出时刻，供保活看门狗判断音频线程是否卡住 */
        this._lastFrameAt = 0
        this._watchdog = null
        this.active = false
        this._meterAt = 0
        this._el = {
            panel: document.getElementById('voicepanel'),
            status: document.getElementById('voice-status'),
            log: document.getElementById('voice-log'),
            meter: document.getElementById('voice-meter'),
            dot: document.getElementById('voice-dot'),
            hangup: document.getElementById('voice-hangup'),
            close: document.getElementById('voice-close'),
            mic: document.getElementById('voice-mic'),
            commit: document.getElementById('voice-commit'),
        }
    }

    /* ------------------------------------------------------------ 生命周期 */

    async start() {
        if (this.active) return
        this.active = true
        this.log = []
        this.micMuted = false
        this._audioFormatChecked = false
        this._renderLog()
        this._syncMicButton()
        this._openPanel()
        this._setStatus('正在连接语音服务…', 'dim')

        try {
            this.cfg = await this._loadConfig()
        } catch (err) {
            this._fail('连不上本机语音代理（8124）。请确认已启动：node tools/voice-proxy.mjs')
            return
        }

        if (!this.cfg.configured) {
            this._fail('语音服务未配置：请在 贵州葛镜桥/.env 里填写 VOICE_API_KEY 后重启代理')
            return
        }

        try {
            await this._openSocket()
            await this._startMic()
            await this._startPlayback()
            this._startKeepaliveWatchdog()
        } catch (err) {
            this._fail(err && err.message ? err.message : String(err))
            return
        }

        this._sendSessionCreate()
        this._watchVisibility()
        this._setStatus('已连接，请开始说话', 'ok')
    }

    stop(reason = '已结束对话') {
        if (!this.active && !this.ws) return
        this.active = false
        this.micMuted = false
        this._syncMicButton()

        // 先礼貌地告诉服务端要关了，再拆本地资源
        try { this._send({ type: 'session.close' }) } catch (e) { /* 已经断了 */ }

        this._teardownMic()
        this._stopPlayback()
        this._closeSocket()

        if (this.playCtx) {
            this.playCtx.close().catch(() => {})
            this.playCtx = null
        }

        this._closePanel()
        this.ui.toast(reason)
    }

    /** 出错时统一收尾并给一句能照着做的提示 */
    _fail(message) {
        this.active = false
        this._teardownMic()
        this._stopPlayback()
        this._closeSocket()
        this._setStatus(message, 'bad')
        this.ui.toast(message, 4200)
        console.error('[Voice]', message)
    }

    /* -------------------------------------------------------------- 配置 */

    async _loadConfig() {
        const res = await fetch(proxyBase() + '/voice-config', { cache: 'no-store' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
    }

    /* ------------------------------------------------------------ WebSocket */

    _openSocket() {
        const wsUrl = proxyBase().replace(/^http/, 'ws') + '/voice-proxy'
        return new Promise((resolve, reject) => {
            let settled = false
            const ws = new WebSocket(wsUrl)
            this.ws = ws

            ws.onopen = () => {
                settled = true
                resolve()
            }
            ws.onmessage = (ev) => this._onEvent(ev.data)
            ws.onerror = () => {
                if (!settled) {
                    settled = true
                    reject(new Error('连不上本机语音代理（8124），请确认它已经启动'))
                }
            }
            ws.onclose = () => {
                if (!settled) {
                    settled = true
                    reject(new Error('语音代理提前断开，请查看代理窗口的日志'))
                    return
                }
                if (this.active) {
                    this._setStatus('连接已断开 —— 再点一次右上角话筒即可重连', 'warn')
                    this.active = false
                    this._teardownMic()
                    this._stopPlayback()
                    // 按钮回到「未通话」外观，否则用户不知道还能再点
                    document.getElementById('voicebtn')?.classList.remove('is-on')
                }
            }
        })
    }

    _closeSocket() {
        if (!this.ws) return
        const ws = this.ws
        this.ws = null
        try {
            if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'client hangup')
            else ws.close()
        } catch (e) { /* ignore */ }
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
    }

    _send(obj) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
        this.ws.send(JSON.stringify(obj))
        return true
    }

    /* ---------------------------------------------------------- 下行事件 */

    _onEvent(raw) {
        let msg
        try {
            msg = JSON.parse(raw)
        } catch (e) {
            console.warn('[Voice] 收到非 JSON 帧:', String(raw).slice(0, 200))
            return
        }

        const type = msg.type || ''

        // 代理自己合成的错误（凭据没配 / 上游连不上），不是豆包的协议事件
        if (type === 'error' && !msg.error) {
            this._fail(msg.message || '语音服务出错')
            return
        }

        switch (type) {
            case 'session.created':
                this._setStatus('已连接，请开始说话', 'ok')
                this._greet()
                break

            case 'session.updated':
            case 'session.closed':
                if (type === 'session.closed') this._setStatus('会话已关闭', 'dim')
                break

            case 'conversation.item.input_audio_transcription.started':
                // 检测到用户开口 —— 如果模型正在说话，就是打断，停掉本地播放并告知服务端
                if (this._isPlaying()) {
                    this._send({ type: 'response.cancel' })
                    this._stopPlayback()
                }
                this._setStatus('正在听你说…', 'ok')
                break

            case 'conversation.item.input_audio_transcription.delta':
                // 覆盖，不是追加 —— 服务端给的是累计快照（见 _setText 的注释）
                this._setText('user', extractEventText(msg))
                break

            case 'conversation.item.input_audio_transcription.completed':
                this._finishText('user', extractEventText(msg))
                break

            case 'conversation.item.input_audio_transcription.failed':
                this._setStatus('这段没听清，请再说一次', 'warn')
                break

            case 'response.output_text.delta':
                this._pushText('assistant', extractEventText(msg))
                this._setStatus('正在回答…', 'ok')
                break

            case 'response.output_text.done':
                this._finishText('assistant', extractEventText(msg))
                break

            case 'response.output_audio.started':
                this.nextTime = 0 // 新一轮回复，重置播放时钟
                this._setStatus('正在说话…', 'ok')
                break

            case 'response.output_audio.delta': {
                const b64 = extractEventAudio(msg)
                if (b64) this._playAudioChunk(b64)
                break
            }

            case 'response.output_audio.done':
                this._setStatus('在听你说…', 'ok')
                break

            case 'response.canceled':
                this._stopPlayback()
                this._setStatus('已打断，在听你说…', 'ok')
                break

            case 'response.done':
                // 兜底：万一上游只发 response.done、没发 output_text.done，
                // 也要把还在流式的那一行收尾，否则朱砂光标会一直闪。
                // 官方客户端同样在 response.done 里做了这一步。
                this._finalizeLiveLines()
                break

            case 'error': {
                const info = msg.error || {}
                const detail = info.message || info.code || '未知错误'
                this._setStatus('语音服务报错：' + detail, 'bad')
                console.error('[Voice] 上游错误:', msg)
                break
            }

            default:
                break
        }
    }

    /* ------------------------------------------------------------ 会话建立 */

    /**
     * 建会话。
     *
     * ⚠️ 这份结构是照**官方 Seeduplex Web Demo**（`web_duplex_demo/server.py` 的
     * `_build_session_create`）逐字段对齐的 —— 不要凭文档那份扁平列表去猜层级，
     * 我第一版就猜错了三处：
     *   - 采样率的键名是 `sample_rate`，**不是 `rate`**
     *   - `voice` / `speed` / `loudness` 都在 **`audio.output` 里面**，不是 session 的同级
     *   - `extension` 是 **`session` 的同级**，不在 session 里面
     */
    _sendSessionCreate() {
        const payload = {
            type: 'session.create',
            session: {
                model: this.cfg.model,
                instructions: this.cfg.instructions,
                audio: {
                    input: {
                        format: { type: this.cfg.input.format, sample_rate: this.cfg.input.rate },
                    },
                    output: {
                        format: { type: this.cfg.output.format, sample_rate: this.cfg.output.rate },
                        voice: this.cfg.voice,
                        speed: this.cfg.speed || 0,
                        loudness: this.cfg.loudness || 0,
                    },
                },
            },
            extension: { extra: { enable_proactive_speak: Boolean(this.cfg.proactiveSpeak) } },
        }
        this._send(payload)
        console.debug('[Voice] session.create →', payload)
    }

    /**
     * 开场白。
     *
     * 默认不开启（.env 里 VOICE_GREETING 留空）—— 先让模型自己说一句会自然很多，
     * 但这条上行事件我还没能在真机上验过，所以留成「配了才发」，避免给主链路引入风险。
     */
    _greet() {
        const text = (this.cfg && this.cfg.greeting) || ''
        if (!text) return
        this._send({ type: 'speech_text_buffer.commit', text })
    }

    /* ---------------------------------------------------------------- 麦克风 */

    async _startMic() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('当前浏览器不支持麦克风采集，请用最新版 Chrome / Edge')
        }

        this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,   // 关键：不然模型会听到自己说话，自己打断自己
                noiseSuppression: true,
                autoGainControl: true,
            },
        })

        // 指定 16 kHz：让浏览器替我们重采样，省掉手写重采样的误差
        this.captureCtx = new AudioContext({ sampleRate: this.cfg.input.rate })
        await this.captureCtx.audioWorklet.addModule('./js/pcm-worklet.js')

        const source = this.captureCtx.createMediaStreamSource(this.micStream)
        this.worklet = new AudioWorkletNode(this.captureCtx, 'pcm-chunker', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
        })
        this.worklet.port.onmessage = (ev) => this._onPcm(ev.data)

        /*
         * 工作线程必须挂到 destination 上才会被音频图持续驱动（否则 process() 不会被调用）。
         * 但麦克风不能真的放出来，所以串一个 0 增益的节点当「假负载」。
         */
        this.silentGain = this.captureCtx.createGain()
        this.silentGain.gain.value = 0
        source.connect(this.worklet)
        this.worklet.connect(this.silentGain)
        this.silentGain.connect(this.captureCtx.destination)

        if (this.captureCtx.state === 'suspended') await this.captureCtx.resume()
    }

    _teardownMic() {
        this._stopKeepaliveWatchdog()
        if (this.worklet) {
            this.worklet.port.onmessage = null
            try { this.worklet.disconnect() } catch (e) { /* ignore */ }
            this.worklet = null
        }
        if (this.silentGain) {
            try { this.silentGain.disconnect() } catch (e) { /* ignore */ }
            this.silentGain = null
        }
        if (this.micStream) {
            for (const track of this.micStream.getTracks()) track.stop()
            this.micStream = null
        }
        if (this.captureCtx) {
            this.captureCtx.close().catch(() => {})
            this.captureCtx = null
        }
    }

    /**
     * 收到一片 20 ms / 16 kHz / 单声道 PCM。
     *
     * 静音时**照发不误**，只是把内容换成同长度的全零帧 —— 这是官方 Demo 的做法。
     * 模型靠上行音频流保活：一旦停发，服务端等不到音频会超时，模型就不再响应了。
     * 所以宁可发静音，也绝不断流。
     */
    _onPcm(buffer) {
        if (!this.active) return

        // 电平指示（限流到约 10 Hz，否则每 20 ms 刷一次 DOM 没必要）
        const now = performance.now()
        if (now - this._meterAt > 100) {
            this._meterAt = now
            this._updateMeter(this.micMuted ? null : buffer)
        }

        const payload = this.micMuted ? new ArrayBuffer(buffer.byteLength) : buffer
        this._lastFrameAt = performance.now()
        this._send({
            type: 'input_audio_buffer.append',
            event_id: 'aud_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            audio: base64FromBuffer(payload),
        })
    }

    /**
     * 上行保活看门狗。
     *
     * 正常情况下上行由 AudioWorklet 在音频线程里按采样数产出，节奏最准，不需要干预。
     * 但**音频线程本身可能被卡住**：页面被节流、渲染进程过载、切后台等等，一旦停帧，
     * 上行就断了 —— 服务端等不到音频会直接关会话，报的正是这条：
     *     AudioServerNoAudioInputTooLongError (52000033)
     * 实测在无头浏览器里跑了约半分钟就撞上了这个，所以这里补一层兜底：
     * 只在「确实超过 200 ms 没有发帧」时才补发静音帧，**正常路径一行都不改**
     * （不改成定时器驱动，就是为了不破坏音频线程那套精确节奏）。
     */
    _startKeepaliveWatchdog() {
        if (this._watchdog) return
        this._lastFrameAt = performance.now()
        this._watchdog = window.setInterval(() => {
            if (!this.active) return
            const gap = performance.now() - this._lastFrameAt
            if (gap < 200) return

            // 一次最多补 0.5 秒，避免长时间卡顿后一次性灌进去一大段
            const frames = Math.min(25, Math.floor(gap / 20))
            console.warn(`[Voice] 音频线程停顿 ${Math.round(gap)}ms，补发 ${frames} 个静音帧保活`)
            for (let i = 0; i < frames; i++) this._sendSilenceFrame()
            this._lastFrameAt = performance.now()
        }, 100)
    }

    _stopKeepaliveWatchdog() {
        if (!this._watchdog) return
        window.clearInterval(this._watchdog)
        this._watchdog = null
    }

    /** 一个 20 ms / 16 kHz / 单声道的静音帧（320 采样 = 640 字节全零） */
    _sendSilenceFrame() {
        this._send({
            type: 'input_audio_buffer.append',
            event_id: 'ka_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            audio: base64FromBuffer(new ArrayBuffer(640)),
        })
    }

    /* ---------------------------------------------------------------- 播放 */

    async _startPlayback() {
        this.playCtx = new AudioContext({ sampleRate: this.cfg.output.rate })
        this.playGain = this.playCtx.createGain()
        this.playGain.gain.value = 1
        this.playGain.connect(this.playCtx.destination)
        if (this.playCtx.state === 'suspended') await this.playCtx.resume()
    }

    /**
     * 收一包下行音频。
     *
     * 第一包顺手验一下格式：官方 Demo 的默认输出是 **ogg_opus**，而我们在
     * session.create 里明确要的是 `pcm_s16le`。万一服务端忽略了请求仍然回 Opus，
     * 按 PCM 播出来只会是噪音 —— 与其让人对着噪音猜，不如明确报出来。
     */
    _playAudioChunk(b64) {
        const bytes = bytesFromBase64(b64)

        if (!this._audioFormatChecked) {
            this._audioFormatChecked = true
            const isOgg = bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53 // 'OggS'
            if (isOgg) {
                this._setStatus(
                    '服务端回的是 Ogg Opus 音频，而本播放链路只支持 PCM。' +
                    '请确认 .env 里 VOICE_OUTPUT_FORMAT=pcm_s16le（当前请求的是 ' + this.cfg.output.format + '）',
                    'bad',
                )
                console.error('[Voice] 收到 Ogg Opus，与请求的输出格式不符')
                return
            }
            if (!/^pcm/i.test(this.cfg.output.format)) {
                console.warn('[Voice] 输出格式不是 PCM，可能无法正确播放：', this.cfg.output.format)
            }
        }

        this._playPcm(bytes)
    }

    _playPcm(bytes) {
        const ctx = this.playCtx
        if (!ctx || !bytes.length) return

        // pcm_s16le：小端 16 位有符号。byteOffset 一定是 0（bytesFromBase64 新建的）
        const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
        const f32 = new Float32Array(pcm.length)
        for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768

        const buffer = ctx.createBuffer(1, f32.length, ctx.sampleRate)
        buffer.copyToChannel(f32, 0)

        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(this.playGain)

        const now = ctx.currentTime
        // 播放游标落后了就重新对齐（网络抖动后不要试图补播已经过去的音频）
        if (this.nextTime < now + 0.02) this.nextTime = now + 0.06
        source.start(this.nextTime)
        this.nextTime += buffer.duration

        this.sources.push(source)
        source.onended = () => {
            this.sources = this.sources.filter((s) => s !== source)
        }
    }

    _stopPlayback() {
        for (const source of this.sources) {
            try { source.stop() } catch (e) { /* 还没 start 或已结束 */ }
        }
        this.sources = []
        this.nextTime = 0
    }

    _isPlaying() {
        return this.sources.length > 0
    }

    /* -------------------------------------------------------------- 保活 */

    /**
     * 切到后台时自动静音。
     *
     * 刻意**不用**文档提到的 `input_audio_mute.commit` / `input_audio_unmute.commit` ——
     * 官方 Demo 全程只靠「每 20 ms 一包」保活，从不停发。这里跟它保持一致：
     * 静音时继续发静音帧，既守住心跳，又不会把后台的环境噪音送进模型。
     */
    _watchVisibility() {
        if (this._visBound) return
        this._visBound = true
        document.addEventListener('visibilitychange', () => {
            if (!this.active) return
            this.micMuted = document.visibilityState === 'hidden'
            this._syncMicButton()
            this._setStatus(
                this.micMuted ? '页面切到后台，已自动静音（仍保持连接）' : '已回到前台，请继续说话',
                this.micMuted ? 'warn' : 'ok',
            )
        })
    }

    /* ------------------------------------------------------------------ UI */

    _openPanel() {
        if (this._el.panel) this._el.panel.classList.add('is-visible')
        if (this._el.dot) this._el.dot.className = 'voicepanel__dot is-live'
    }

    _closePanel() {
        if (this._el.panel) this._el.panel.classList.remove('is-visible')
        if (this._el.dot) this._el.dot.className = 'voicepanel__dot'
        if (this._el.meter) this._el.meter.style.transform = 'scaleX(0)'
    }

    _setStatus(text, kind) {
        const el = this._el.status
        if (!el) return
        el.textContent = text
        el.dataset.kind = kind || 'dim'
    }

    _updateMeter(buffer) {
        const el = this._el.meter
        if (!el) return
        if (!buffer) {
            // 静音中：电平条归零，免得让人以为还在收音
            el.style.transform = 'scaleX(0)'
            return
        }
        const pcm = new Int16Array(buffer)
        let peak = 0
        for (let i = 0; i < pcm.length; i++) {
            const v = Math.abs(pcm[i])
            if (v > peak) peak = v
        }
        el.style.transform = 'scaleX(' + Math.min(1, peak / 12000).toFixed(3) + ')'
    }

    /**
     * 覆盖式写入某一行（ASR 的 delta 用它）。
     *
     * ⚠️ 这里有个很容易踩的坑：**上行语音识别的 delta 是「累计快照」，不是增量**。
     * 真实服务端发的是
     *     {"delta":"你"} → {"delta":"你好听"} → {"delta":"你好听得见"} → …
     * 每次都带**完整**文本；若按增量去拼，面板会显示成
     *     「你你好听你好听得你好听得见…」这种复读。
     * 而 `response.output_text.delta` 恰恰相反，是真正的增量，必须拼接 ——
     * 官方 Demo 也是这么区分的：ASR 用 setQuestion（覆盖），回复用 appendAnswer（追加）。
     */
    _setText(role, text) {
        if (!text) return
        const last = this.log[this.log.length - 1]
        if (last && last.role === role && !last.done) last.text = text
        else this.log.push({ role, text, done: false })
        this._renderLog()
    }

    /** 追加式写入某一行（模型回复的 delta 用它，那是真增量） */
    _pushText(role, text) {
        if (!text) return
        const last = this.log[this.log.length - 1]
        if (last && last.role === role && !last.done) last.text += text
        else this.log.push({ role, text, done: false })
        this._renderLog()
    }

    _finishText(role, full) {
        const last = this.log[this.log.length - 1]
        if (last && last.role === role && !last.done) {
            if (full) last.text = full
            last.done = true
        } else if (full) {
            this.log.push({ role, text: full, done: true })
        }
        this._renderLog()
    }

    _renderLog() {
        const el = this._el.log
        if (!el) return
        el.innerHTML = this.log.map((line) => (
            `<p class="voiceline voiceline--${line.role}${line.done ? '' : ' is-live'}">` +
            `<b>${line.role === 'user' ? '你' : '沧朔'}</b>${escapeHtml(line.text)}</p>`
        )).join('')
        el.scrollTop = el.scrollHeight
    }

    /** 把所有还在流式中的行标为完成（response.done 兜底用） */
    _finalizeLiveLines() {
        let changed = false
        for (const line of this.log) {
            if (!line.done) {
                line.done = true
                changed = true
            }
        }
        if (changed) this._renderLog()
    }

    /* ------------------------------------------------------------ 手动控制 */

    /**
     * 强制判停：模型没自动判停、迟迟不回复时才用（对应官方 Demo 的「强制判停」）。
     * 正常不用点 —— 模型会自己判断你说完了没有。
     */
    forceCommit() {
        if (!this.active) return
        this._send({ type: 'input_audio_buffer.commit' })
        this._setStatus('已强制提交本轮语音，等模型回复…', 'ok')
    }

    /** 麦克风静音开关。静音期间仍然每 20 ms 发一包，只是内容是静音帧，连接不断 */
    toggleMic() {
        if (!this.active) return
        this.micMuted = !this.micMuted
        this._syncMicButton()
        this._setStatus(
            this.micMuted ? '麦克风已静音（连接保持中）' : '麦克风已开启，请说话',
            this.micMuted ? 'warn' : 'ok',
        )
    }

    _syncMicButton() {
        const btn = this._el.mic
        if (!btn) return
        btn.classList.toggle('is-off', this.micMuted)
        btn.textContent = this.micMuted ? '取消静音' : '静音'
    }
}

/* ==================================================================== 入口 */

/**
 * 挂上语音按钮。按钮的显示时机由 ui.revealModel() 控制（与截图键一致：模型就绪才浮出）。
 *
 * @param {import('./ui.js').UI} ui
 */
export function initVoice(ui) {
    const btn = document.getElementById('voicebtn')
    if (!btn) {
        console.warn('[Voice] 找不到 #voicebtn，语音对话未启用');
        return
    }

    const dialog = new VoiceDialog(ui)

    btn.addEventListener('click', () => {
        if (dialog.active) dialog.stop('已结束对话')
        else dialog.start()
        btn.classList.toggle('is-on', dialog.active)
    })

    const hangup = document.getElementById('voice-hangup')
    if (hangup) {
        hangup.addEventListener('click', () => {
            dialog.stop()
            btn.classList.remove('is-on')
        })
    }
    const mic = document.getElementById('voice-mic')
    if (mic) mic.addEventListener('click', () => dialog.toggleMic())
    const commit = document.getElementById('voice-commit')
    if (commit) commit.addEventListener('click', () => dialog.forceCommit())
    const close = document.getElementById('voice-close')
    if (close) {
        close.addEventListener('click', () => dialog.stop())
    }

    // 关页面时礼貌收尾，别把上游连接晾在那儿
    window.addEventListener('pagehide', () => {
        if (dialog.active) dialog.stop('页面已关闭')
    })

    window.__voice = dialog // 便于调试
    console.log('[Voice] 语音对话模块已加载')
}
