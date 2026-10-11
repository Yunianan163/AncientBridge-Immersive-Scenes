using NAudio.Wave;
using System;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace RealtimeDialog
{
    /// <summary>
    /// 麦克风音频录制器
    /// </summary>
    public class AudioRecorder : IDisposable
    {
        private WaveInEvent? _waveIn;
        private readonly Channel<byte[]> _audioChannel;
        private readonly int _sampleRate;
        private readonly int _channels;
        private readonly int _packetDurationMs;
        private MemoryStream? _currentPacket;
        private readonly object _lockObj = new object();
        private bool _isRecording = false;

        /// <summary>
        /// 音频数据可用事件
        /// </summary>
        public event EventHandler<byte[]>? AudioDataAvailable;

        /// <summary>
        /// 录制状态改变事件
        /// </summary>
        public event EventHandler<bool>? RecordingStateChanged;

        /// <summary>
        /// 是否正在录制
        /// </summary>
        public bool IsRecording => _isRecording;

        /// <summary>
        /// 音频数据通道（用于流式读取）
        /// </summary>
        public ChannelReader<byte[]> AudioChannel => _audioChannel.Reader;

        public AudioRecorder(int sampleRate = 16000, int channels = 1, int packetDurationMs = 20)
        {
            _sampleRate = sampleRate;
            _channels = channels;
            _packetDurationMs = packetDurationMs;
            _audioChannel = Channel.CreateUnbounded<byte[]>();
        }

        /// <summary>
        /// 开始录制
        /// </summary>
        public void StartRecording()
        {
            if (_isRecording) return;

            lock (_lockObj)
            {
                if (_isRecording) return;

                _waveIn = new WaveInEvent
                {
                    WaveFormat = new WaveFormat(_sampleRate, 16, _channels),
                    BufferMilliseconds = _packetDurationMs
                };

                // 计算每包的字节数: sampleRate * channels * bytesPerSample * durationMs / 1000
                // 16000 * 1 * 2 * 20 / 1000 = 640 bytes
                int bytesPerPacket = _sampleRate * _channels * 2 * _packetDurationMs / 1000;
                _currentPacket = new MemoryStream(bytesPerPacket);

                _waveIn.DataAvailable += OnDataAvailable;
                _waveIn.RecordingStopped += OnRecordingStopped;

                _waveIn.StartRecording();
                _isRecording = true;
                
                RecordingStateChanged?.Invoke(this, true);
                Console.WriteLine($"[音频] 开始录制 ({_sampleRate}Hz, {_channels}ch, {_packetDurationMs}ms/包)");
            }
        }

        /// <summary>
        /// 停止录制
        /// </summary>
        public void StopRecording()
        {
            if (!_isRecording) return;

            lock (_lockObj)
            {
                if (!_isRecording) return;

                _waveIn?.StopRecording();
                _isRecording = false;
                
                // 发送剩余数据
                FlushRemainingData();
                
                RecordingStateChanged?.Invoke(this, false);
                Console.WriteLine("[音频] 停止录制");
            }
        }

        private void OnDataAvailable(object? sender, WaveInEventArgs e)
        {
            if (!_isRecording || e.Buffer == null || e.BytesRecorded == 0) return;

            // 将数据写入当前包
            _currentPacket?.Write(e.Buffer, 0, e.BytesRecorded);

            // 计算目标包大小
            int targetPacketSize = _sampleRate * _channels * 2 * _packetDurationMs / 1000;

            // 当积累足够数据时，发送一包
            while (_currentPacket != null && _currentPacket.Length >= targetPacketSize)
            {
                byte[] packet = new byte[targetPacketSize];
                _currentPacket.Position = 0;
                _currentPacket.Read(packet, 0, targetPacketSize);

                // 处理剩余数据
                byte[] remaining = new byte[_currentPacket.Length - targetPacketSize];
                if (remaining.Length > 0)
                {
                    _currentPacket.Position = targetPacketSize;
                    _currentPacket.Read(remaining, 0, remaining.Length);
                }

                _currentPacket.SetLength(0);
                if (remaining.Length > 0)
                {
                    _currentPacket.Write(remaining, 0, remaining.Length);
                }

                // 发送数据
                _audioChannel.Writer.TryWrite(packet);
                AudioDataAvailable?.Invoke(this, packet);
            }
        }

        private void FlushRemainingData()
        {
            if (_currentPacket == null || _currentPacket.Length == 0) return;

            byte[] remaining = _currentPacket.ToArray();
            if (remaining.Length > 0)
            {
                _audioChannel.Writer.TryWrite(remaining);
                AudioDataAvailable?.Invoke(this, remaining);
            }
            _currentPacket.SetLength(0);
        }

        private void OnRecordingStopped(object? sender, StoppedEventArgs e)
        {
            if (e.Exception != null)
            {
                Console.WriteLine($"[音频] 录制错误: {e.Exception.Message}");
            }
        }

        public void Dispose()
        {
            StopRecording();
            
            _waveIn?.Dispose();
            _waveIn = null;
            
            _currentPacket?.Dispose();
            _currentPacket = null;
            
            _audioChannel.Writer.TryComplete();
        }
    }
}
