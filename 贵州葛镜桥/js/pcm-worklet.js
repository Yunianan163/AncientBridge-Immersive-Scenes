/**
 * pcm-worklet.js — 麦克风采集的音频工作线程
 *
 * 职责：把浏览器已经重采样到 16kHz 的浮点采样，按 **20 ms 一帧**切成
 * Int16 PCM（16kHz 单声道下正好 320 个采样 / 640 字节）再交给主线程。
 *
 * 为什么必须是 20 ms：
 *   Seeduplex 文档明确要求上行音频「以 20 ms 为单位（16k/int16 下每包 640 字节），
 *   并严格按照实时音频流的节奏发送，发送速率过快或过慢都将触发服务端错误」。
 *   所以切片必须在音频线程里按采样数精确切，不能在主线程用定时器凑 —— 定时器会被
 *   渲染卡顿带偏，速率一飘服务端就报错。
 *
 * 为什么不用 ScriptProcessorNode：它已废弃，且在主线程跑，248 MB 高斯场景一卡就会丢帧。
 *
 * 说明：AudioContext 是以 sampleRate: 16000 创建的，浏览器会把麦克风重采样到 16k，
 * 所以这里不需要自己写重采样。
 */

const TARGET_RATE = 16000
const CHUNK_MS = 20
const CHUNK_SAMPLES = (TARGET_RATE * CHUNK_MS) / 1000 // 320

class PcmChunker extends AudioWorkletProcessor {
    constructor() {
        super()
        this._buf = new Float32Array(CHUNK_SAMPLES)
        this._filled = 0
    }

    process(inputs) {
        const channel = inputs[0] && inputs[0][0]
        if (!channel) return true // 麦克风还没接上，保持节点存活

        for (let i = 0; i < channel.length; i++) {
            this._buf[this._filled++] = channel[i]

            if (this._filled === CHUNK_SAMPLES) {
                const pcm = new Int16Array(CHUNK_SAMPLES)
                for (let j = 0; j < CHUNK_SAMPLES; j++) {
                    const s = Math.max(-1, Math.min(1, this._buf[j]))
                    // 负半轴能到 -32768，正半轴到 32767，分开算避免削顶失真
                    pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff
                }
                // 转移所有权，避免每 20 ms 复制一次缓冲区
                this.port.postMessage(pcm.buffer, [pcm.buffer])
                this._filled = 0
            }
        }

        return true
    }
}

registerProcessor('pcm-chunker', PcmChunker)
