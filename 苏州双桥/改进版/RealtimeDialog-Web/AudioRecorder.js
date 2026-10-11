/**
 * 音频录制器 - 使用Web Audio API
 * 参照RealtimeDialog C#版本的AudioRecorder实现
 */
export class AudioRecorder extends EventTarget {
    /**
     * @param {Object} options 
     * @param {number} [options.sampleRate=16000] 
     * @param {number} [options.channels=1] 
     * @param {number} [options.packetDurationMs=20] 
     */
    constructor(options = {}) {
        super();
        
        this._sampleRate = options.sampleRate || 16000;
        this._channels = options.channels || 1;
        this._packetDurationMs = options.packetDurationMs || 20;
        
        /** @private @type {MediaStream|null} */
        this._mediaStream = null;
        
        /** @private @type {AudioContext|null} */
        this._audioContext = null;
        
        /** @private @type {ScriptProcessorNode|null} */
        this._scriptProcessor = null;
        
        /** @private @type {MediaStreamAudioSourceNode|null} */
        this._sourceNode = null;
        
        /** @private @type {boolean} */
        this._isRecording = false;

        /** @private @type {boolean} */
        this._isPaused = false;
        
        /** @private @type {Array<Int16Array>} */
        this._audioBuffer = [];
        
        /** @private @type {number} */
        this._bufferedSamples = 0;
        
        /** @private @type {number} */
        this._targetSamplesPerPacket = Math.floor(this._sampleRate * this._packetDurationMs / 1000);
    }
    
    /**
     * 是否正在录制
     * @returns {boolean}
     */
    get isRecording() {
        return this._isRecording;
    }

    /**
     * 是否已暂停
     * @returns {boolean}
     */
    get isPaused() {
        return this._isPaused;
    }
    
    /**
     * 开始录制
     * @returns {Promise<void>}
     */
    async startRecording() {
        if (this._isRecording) return;
        
        try {
            // 获取麦克风权限
            this._mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: this._sampleRate,
                    channelCount: this._channels,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // 创建AudioContext
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this._audioContext = new AudioContextClass({
                sampleRate: this._sampleRate
            });
            
            // 创建音频源
            this._sourceNode = this._audioContext.createMediaStreamSource(this._mediaStream);
            
            // 创建ScriptProcessorNode用于处理音频数据
            const bufferSize = 4096;
            this._scriptProcessor = this._audioContext.createScriptProcessor(
                bufferSize, 
                this._channels, 
                this._channels
            );
            
            // 处理音频数据
            this._scriptProcessor.onaudioprocess = (event) => {
                if (!this._isRecording || this._isPaused) return;
                
                const inputData = event.inputBuffer.getChannelData(0);
                this._processAudioData(inputData);
            };
            
            // 连接节点
            this._sourceNode.connect(this._scriptProcessor);
            this._scriptProcessor.connect(this._audioContext.destination);
            
            this._isRecording = true;
            this._isPaused = false;
            this._emit('recordingStateChanged', true);
            console.log(`[AudioRecorder] 开始录制 (${this._sampleRate}Hz, ${this._channels}ch, ${this._packetDurationMs}ms/包)`);
            
        } catch (error) {
            console.error('[AudioRecorder] 启动录制失败:', error);
            throw error;
        }
    }

    /**
     * 暂停录制（不释放资源）
     */
    pauseRecording() {
        if (!this._isRecording || this._isPaused) return;
        
        this._isPaused = true;
        console.log('[AudioRecorder] 录制已暂停');
        this._emit('recordingStateChanged', { recording: true, paused: true });
    }

    /**
     * 恢复录制
     */
    resumeRecording() {
        if (!this._isRecording || !this._isPaused) return;
        
        // 清空暂停前可能积累的缓冲区，避免发送旧数据
        this._audioBuffer = [];
        this._bufferedSamples = 0;
        
        this._isPaused = false;
        console.log('[AudioRecorder] 录制已恢复');
        this._emit('recordingStateChanged', { recording: true, paused: false });
    }
    
    /**
     * 停止录制
     */
    stopRecording() {
        if (!this._isRecording) return;
        
        this._isRecording = false;
        this._isPaused = false;
        
        // 发送剩余数据
        this._flushRemainingData();
        
        // 清理资源
        if (this._scriptProcessor) {
            this._scriptProcessor.disconnect();
            this._scriptProcessor = null;
        }
        
        if (this._sourceNode) {
            this._sourceNode.disconnect();
            this._sourceNode = null;
        }
        
        if (this._audioContext) {
            this._audioContext.close();
            this._audioContext = null;
        }
        
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(track => track.stop());
            this._mediaStream = null;
        }
        
        this._audioBuffer = [];
        this._bufferedSamples = 0;
        
        this._emit('recordingStateChanged', false);
        console.log('[AudioRecorder] 停止录制');
    }
    
    /**
     * @private
     * @param {Float32Array} inputData 
     */
    _processAudioData(inputData) {
        // 将Float32Array转换为Int16Array (16位PCM)
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // 添加到缓冲区
        this._audioBuffer.push(int16Data);
        this._bufferedSamples += int16Data.length;
        
        // 当积累足够数据时，发送一包
        while (this._bufferedSamples >= this._targetSamplesPerPacket) {
            this._sendPacket();
        }
    }
    
    /**
     * @private
     */
    _sendPacket() {
        // 合并缓冲区中的数据
        const mergedData = new Int16Array(this._bufferedSamples);
        let offset = 0;
        for (const chunk of this._audioBuffer) {
            mergedData.set(chunk, offset);
            offset += chunk.length;
        }
        this._audioBuffer = [];
        this._bufferedSamples = 0;
        
        // 提取目标大小的包
        const packetData = mergedData.slice(0, this._targetSamplesPerPacket);
        const remainingData = mergedData.slice(this._targetSamplesPerPacket);
        
        // 将剩余数据放回缓冲区
        if (remainingData.length > 0) {
            this._audioBuffer.push(remainingData);
            this._bufferedSamples = remainingData.length;
        }
        
        // 将Int16Array转换为Uint8Array (小端序)
        const byteArray = new Uint8Array(packetData.buffer);
        
        // 触发事件
        this._emit('audioDataAvailable', byteArray);
    }
    
    /**
     * @private
     */
    _flushRemainingData() {
        if (this._bufferedSamples === 0) return;
        
        // 合并剩余数据
        const mergedData = new Int16Array(this._bufferedSamples);
        let offset = 0;
        for (const chunk of this._audioBuffer) {
            mergedData.set(chunk, offset);
            offset += chunk.length;
        }
        
        // 将Int16Array转换为Uint8Array
        const byteArray = new Uint8Array(mergedData.buffer);
        
        // 触发事件
        this._emit('audioDataAvailable', byteArray);
        
        this._audioBuffer = [];
        this._bufferedSamples = 0;
    }
    
    /**
     * @private
     * @param {string} eventName 
     * @param {any} data 
     */
    _emit(eventName, data) {
        this.dispatchEvent(new CustomEvent(eventName, { detail: data }));
    }
    
    /**
     * 释放资源
     */
    dispose() {
        this.stopRecording();
    }
}

/**
 * 检查浏览器是否支持音频录制
 * @returns {boolean}
 */
export function isAudioRecordingSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * 请求麦克风权限
 * @returns {Promise<boolean>}
 */
export async function requestMicrophonePermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch {
        return false;
    }
}
