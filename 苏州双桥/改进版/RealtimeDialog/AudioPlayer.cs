using NAudio.Wave;
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace RealtimeDialog
{
    /// <summary>
    /// 音频播放器 - 平滑启动避免爆音
    /// </summary>
    public class AudioPlayer : IDisposable
    {
        private WaveOutEvent? _waveOut;
        private BufferedWaveProvider? _audioBuffer;
        private readonly Queue<byte[]> _pendingAudio;
        private readonly object _lockObj = new object();
        private Task? _playbackTask;
        private CancellationTokenSource? _cts;
        
        private const int PREBUFFER_MS = 300;
        private int _bufferedMs = 0;
        private bool _started = false;
        private bool _isPlaying = false;

        public AudioPlayer()
        {
            _pendingAudio = new Queue<byte[]>();
        }

        public void Initialize()
        {
            Stop();

            // 创建30秒缓冲区
            _audioBuffer = new BufferedWaveProvider(new WaveFormat(24000, 16, 1))
            {
                BufferDuration = TimeSpan.FromSeconds(30),
                DiscardOnBufferOverflow = false
            };

            _waveOut = new WaveOutEvent
            {
                DesiredLatency = 200,
                NumberOfBuffers = 3
            };
            
            _waveOut.Init(_audioBuffer);
            
            // 先不播放，等缓冲完成
            // _waveOut.Play();
            _isPlaying = false;
            
            _bufferedMs = 0;
            _started = false;
            
            _cts = new CancellationTokenSource();
            _playbackTask = Task.Run(() => ProcessAudioLoop(_cts.Token));
            
            Console.WriteLine("[音频] 播放器已初始化 (30秒缓冲区)");
        }

        public void Play(byte[] audioData)
        {
            if (audioData == null || audioData.Length == 0) return;

            lock (_lockObj)
            {
                _pendingAudio.Enqueue(audioData);
            }
        }

        public void Clear()
        {
            lock (_lockObj)
            {
                _pendingAudio.Clear();
                _bufferedMs = 0;
                _started = false;
            }
            _audioBuffer?.ClearBuffer();
            
            // 暂停播放，下次重新缓冲
            if (_isPlaying)
            {
                _waveOut?.Stop();
                _isPlaying = false;
            }
        }

        private async Task ProcessAudioLoop(CancellationToken cancellationToken)
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    byte[]? data = null;
                    lock (_lockObj)
                    {
                        if (_pendingAudio.Count > 0)
                        {
                            data = _pendingAudio.Dequeue();
                        }
                    }

                    if (data != null && _audioBuffer != null)
                    {
                        int durationMs = (data.Length * 1000) / 48000;
                        
                        lock (_lockObj)
                        {
                            _bufferedMs += durationMs;
                        }
                        
                        try
                        {
                            _audioBuffer.AddSamples(data, 0, data.Length);
                        }
                        catch { }
                        
                        // 预缓冲完成后开始播放
                        if (!_started && _bufferedMs >= PREBUFFER_MS)
                        {
                            _started = true;
                            if (!_isPlaying)
                            {
                                _waveOut?.Play();
                                _isPlaying = true;
                            }
                        }
                    }
                    else
                    {
                        // 检查是否播放完了
                        if (_started && _audioBuffer != null && _audioBuffer.BufferedBytes == 0)
                        {
                            // 播放完成，重置状态
                            _started = false;
                            _bufferedMs = 0;
                            if (_isPlaying)
                            {
                                _waveOut?.Stop();
                                _isPlaying = false;
                            }
                        }
                        
                        await Task.Delay(10, cancellationToken);
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch { }
        }

        public void Stop()
        {
            _cts?.Cancel();
            try { _playbackTask?.Wait(TimeSpan.FromSeconds(1)); } catch { }
            
            _waveOut?.Stop();
            _waveOut?.Dispose();
            _waveOut = null;
            _audioBuffer = null;
            _isPlaying = false;
        }

        public void Dispose()
        {
            Stop();
            _cts?.Dispose();
        }
    }
}
