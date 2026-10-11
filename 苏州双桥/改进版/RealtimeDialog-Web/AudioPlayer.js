/**
 * 音频播放器 - 修复版
 * 专门处理 pcm_s16le (16位有符号小端序PCM) 格式
 */
export class AudioPlayer extends EventTarget {
    constructor() {
        super();
        this._audioContext = null;
        this._gainNode = null;
        this._audioQueue = [];
        this._activeSources = new Set();
        this._sampleRate = 24000;  // 与TTS输出一致
        this._channels = 1;
        this._prebufferMs = 300;   // 预缓冲300ms避免爆音
        this._bufferedMs = 0;
        this._started = false;
        this._nextStartTime = 0;
        this._playbackCheckInterval = null;
        this._isPlaying = false;
    }

    get isPlaying() {
        return this._isPlaying || this._activeSources.size > 0 || this._audioQueue.length > 0;
    }

    initialize() {
        this.stop();

        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this._audioContext = new AudioContextClass({ sampleRate: this._sampleRate });

            // 创建增益节点用于音量控制和平滑过渡
            this._gainNode = this._audioContext.createGain();
            this._gainNode.connect(this._audioContext.destination);
            this._gainNode.gain.value = 1.0;

            this._bufferedMs = 0;
            this._started = false;
            this._nextStartTime = 0;
            this._isPlaying = false;

            // 启动播放状态监控
            this._playbackCheckInterval = setInterval(() => this._checkPlaybackState(), 50);

            console.log('[AudioPlayer] 初始化完成，采样率:', this._sampleRate);
        } catch (error) {
            console.error('[AudioPlayer] 初始化失败:', error);
            throw error;
        }
    }

    /**
     * 播放PCM音频数据
     * @param {Uint8Array} audioData - PCM s16le 原始字节数据
     */
    play(audioData) {
        if (!audioData || audioData.length === 0 || !this._audioContext) {
            return;
        }

        try {
            // 将Uint8Array转换为Int16Array (pcm_s16le)
            // 注意：little endian 格式
            const int16Data = new Int16Array(audioData.buffer, audioData.byteOffset, 
                Math.floor(audioData.byteLength / 2));

            // 创建AudioBuffer
            const frameCount = int16Data.length / this._channels;
            const audioBuffer = this._audioContext.createBuffer(
                this._channels, 
                frameCount, 
                this._sampleRate
            );

            // 将Int16转换为Float32 (-1.0 到 1.0)
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < int16Data.length; i++) {
                // Int16范围是 -32768 到 32767，转换为 -1.0 到 1.0
                channelData[i] = int16Data[i] / 32768.0;
            }

            // 计算音频时长
            const durationMs = (frameCount / this._sampleRate) * 1000;

            // 加入队列
            this._audioQueue.push(audioBuffer);
            this._bufferedMs += durationMs;

            // 如果未开始播放且缓冲足够，开始播放
            if (!this._started && this._bufferedMs >= this._prebufferMs) {
                this._started = true;
                this._startPlayback();
            } else if (this._started) {
                this._schedulePlayback();
            }

        } catch (error) {
            console.error('[AudioPlayer] 播放失败:', error);
        }
    }

    _startPlayback() {
        if (!this._audioContext || !this._gainNode) return;

        // 恢复AudioContext（如果处于suspended状态）
        if (this._audioContext.state === 'suspended') {
            this._audioContext.resume();
        }

        this._isPlaying = true;
        this._schedulePlayback();
    }

    _schedulePlayback() {
        if (!this._audioContext || !this._gainNode) return;

        while (this._audioQueue.length > 0) {
            const audioBuffer = this._audioQueue.shift();

            // 创建BufferSource
            const source = this._audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this._gainNode);

            // 计算精确的播放时间
            const now = this._audioContext.currentTime;
            const startTime = Math.max(now, this._nextStartTime);

            // 播放
            source.start(startTime);
            this._activeSources.add(source);

            // 更新下一个音频的开始时间
            this._nextStartTime = startTime + audioBuffer.duration;

            // 播放结束后清理
            source.onended = () => {
                this._activeSources.delete(source);
            };
        }
    }

    _checkPlaybackState() {
        if (!this._audioContext) return;

        // 如果已经开始播放但队列为空且没有活跃source，重置状态
        if (this._started && this._audioQueue.length === 0 && this._activeSources.size === 0) {
            this._started = false;
            this._bufferedMs = 0;
            this._nextStartTime = 0;
            this._isPlaying = false;
        }
    }

    /**
     * 清空播放队列（用于打断）
     */
    clear() {
        // 停止所有活跃source
        for (const source of this._activeSources) {
            try {
                source.stop();
                source.disconnect();
            } catch {}
        }
        this._activeSources.clear();

        // 清空队列
        this._audioQueue = [];
        this._bufferedMs = 0;
        this._started = false;
        this._nextStartTime = 0;
        this._isPlaying = false;

        console.log('[AudioPlayer] 播放队列已清空');
    }

    /**
     * 停止播放并释放资源
     */
    stop() {
        this.clear();

        if (this._playbackCheckInterval) {
            clearInterval(this._playbackCheckInterval);
            this._playbackCheckInterval = null;
        }

        if (this._gainNode) {
            try {
                this._gainNode.disconnect();
            } catch {}
            this._gainNode = null;
        }

        if (this._audioContext) {
            try {
                this._audioContext.close();
            } catch {}
            this._audioContext = null;
        }
    }

    dispose() {
        this.stop();
    }
}

/**
 * 检查浏览器是否支持Web Audio API
 */
export function isWebAudioSupported() {
    return !!(window.AudioContext || window.webkitAudioContext);
}