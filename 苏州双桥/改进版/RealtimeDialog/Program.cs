using System;
using System.Threading;
using System.Threading.Tasks;
using NAudio.Wave;

namespace RealtimeDialog
{
    class Program
    {
        // API 配置 —— ⚠️ 凭据一律从环境变量读取，不要写回源码
        //   VOICE_APP_ID / VOICE_ACCESS_TOKEN / VOICE_APP_KEY / VOICE_SECRET_KEY
        // 例如 PowerShell：
        //   $env:VOICE_APP_ID="..."; $env:VOICE_ACCESS_TOKEN="..."; $env:VOICE_APP_KEY="..."; dotnet run
        private static readonly string APP_ID = Environment.GetEnvironmentVariable("VOICE_APP_ID") ?? "";
        private static readonly string ACCESS_TOKEN = Environment.GetEnvironmentVariable("VOICE_ACCESS_TOKEN") ?? "";
        private static readonly string APP_KEY = Environment.GetEnvironmentVariable("VOICE_APP_KEY") ?? "";

        private static RealtimeDialogClient? _client;
        private static AudioRecorder? _audioRecorder;
        private static AudioPlayer? _audioPlayer;
        private static bool _isRunning = true;
        private static bool _isRecording = false;
        private static bool _isUserSpeaking = false;  // 用户是否正在说话
        private static readonly object _audioLock = new object();

        static async Task Main(string[] args)
        {
            Console.WriteLine("========================================");
            Console.WriteLine("       豆包语音对话系统 - 简化版        ");
            Console.WriteLine("========================================");
            Console.WriteLine();
            Console.WriteLine("功能：");
            Console.WriteLine("  1. 麦克风实时对话");
            Console.WriteLine("  2. 文字输入对话");
            Console.WriteLine();

            ShowMenu();

            while (_isRunning)
            {
                Console.Write("\n请输入命令: ");
                var input = Console.ReadLine()?.Trim().ToLower();

                switch (input)
                {
                    case "1":
                        await ConnectAsync();
                        break;

                    case "2":
                        await StartVoiceChatAsync();
                        break;

                    case "3":
                        await SendTextAsync();
                        break;

                    case "4":
                        await StopAsync();
                        break;

                    case "5":
                        await ExitAsync();
                        break;

                    case "help":
                    case "?":
                        ShowMenu();
                        break;

                    default:
                        Console.WriteLine("未知命令，输入 help 查看帮助");
                        break;
                }
            }
        }

        static void ShowMenu()
        {
            Console.WriteLine("---------------- 命令菜单 ----------------");
            Console.WriteLine("  1 - 连接到服务器");
            Console.WriteLine("  2 - 开始语音对话（麦克风）");
            Console.WriteLine("  3 - 发送文字消息");
            Console.WriteLine("  4 - 停止/断开");
            Console.WriteLine("  5 - 退出程序");
            Console.WriteLine("------------------------------------------");
        }

        static async Task ConnectAsync()
        {
            if (_client?.IsConnected == true)
            {
                Console.WriteLine("已经连接");
                return;
            }

            try
            {
                if (string.IsNullOrWhiteSpace(APP_ID) || string.IsNullOrWhiteSpace(ACCESS_TOKEN))
                {
                    Console.WriteLine("❌ 未配置语音凭据。请先设置环境变量：");
                    Console.WriteLine("     VOICE_APP_ID / VOICE_ACCESS_TOKEN / VOICE_APP_KEY");
                    Console.WriteLine("   （凭据不再写死在源码里，避免随交付包外泄）");
                    return;
                }

                var config = new ClientConfig
                {
                    AppId = APP_ID,
                    AccessToken = ACCESS_TOKEN,
                    AppKey = APP_KEY
                };

                _client = new RealtimeDialogClient(config);
                SetupEventHandlers();

                Console.WriteLine("正在连接...");
                await _client.ConnectAsync();
                Console.WriteLine("✓ 连接成功");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ 连接失败: {ex.Message}");
            }
        }

        static async Task StartVoiceChatAsync()
        {
            if (_client?.IsConnected != true)
            {
                Console.WriteLine("请先连接服务器 (输入 1)");
                return;
            }

            try
            {
                // 初始化音频播放
                _audioPlayer = new AudioPlayer();
                _audioPlayer.Initialize();

                // 初始化麦克风
                _audioRecorder = new AudioRecorder();
                _audioRecorder.AudioDataAvailable += (s, audioData) =>
                {
                    if (_client?.IsSessionActive == true && _isRecording)
                    {
                        _ = Task.Run(async () =>
                        {
                            try { await _client.SendAudioAsync(audioData); }
                            catch { }
                        });
                    }
                };

                // 启动会话
                var request = new StartSessionRequest
                {
                    Asr = new AsrConfig
                    {
                        AudioInfo = new AudioInfo { Format = "pcm", SampleRate = 16000, Channel = 1 },
                        Extra = new AsrExtra()  // 必须设置，不能为null
                    },
                    Tts = new TtsConfig
                    {
                        Speaker = VoiceSpeakers.Default,
                        AudioConfig = new TtsAudioConfig
                        {
                            Format = "pcm_s16le",
                            SampleRate = 24000,
                            Channel = 1
                        }
                    },
                    Dialog = new DialogConfig
                    {
                        BotName = "沧朔",
                        SystemRole = "本机器人是室外虚拟古桥场景专属的AI语音交流角色，功能仅围绕古桥历史与用户对话交流，不参与任何操作控制。整体形象设定可爱软萌，语音轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。它熟知古桥的建造年代、历史故事、民间传说与建筑变迁，能用轻松可爱的语气和用户聊天，耐心解答各种关于古桥历史的问题，讲解生动有趣，自带亲切感，让用户在愉快的对话中了解古桥的历史与文化。",
                        SpeakingStyle = "你说话可爱软萌、轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。",
                        Extra = new DialogExtra
                        {
                            InputMod = InputModes.KeepAlive,
                            Model = ModelVersions.O2_0
                        }
                    }
                };

                await _client.StartSessionAsync(request);
                
                // 发送开场白
                await Task.Delay(500); // 等待会话建立
                await _client.SayHelloAsync("你好呀～我是沧朔！是专门陪你聊古桥历史的小向导哦。不管是古桥的建造故事、年代变迁，还是和它有关的传说往事，我都可以慢慢讲给你听。快来和我聊聊你想知道的古桥历史吧～");

                // 开始录音
                _audioRecorder.StartRecording();
                _isRecording = true;

                Console.WriteLine("✓ 语音对话已开始，请说话...");
                Console.WriteLine("  （说话时AI会自动暂停，你说完AI会回复）");
                Console.WriteLine("  输入 4 停止对话");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ 启动失败: {ex.Message}");
            }
        }

        static async Task SendTextAsync()
        {
            if (_client?.IsConnected != true)
            {
                Console.WriteLine("请先连接服务器 (输入 1)");
                return;
            }

            // 如果没有活跃会话，先启动一个（纯文本模式）
            if (_client?.IsSessionActive != true)
            {
                try
                {
                    // 初始化音频播放
                    _audioPlayer = new AudioPlayer();
                    _audioPlayer.Initialize();

                    var request = new StartSessionRequest
                    {
                        Asr = new AsrConfig
                        {
                            AudioInfo = new AudioInfo { Format = "pcm", SampleRate = 16000, Channel = 1 },
                            Extra = new AsrExtra()  // 必须设置，不能为null
                        },
                        Tts = new TtsConfig
                        {
                            Speaker = VoiceSpeakers.Default,
                            AudioConfig = new TtsAudioConfig
                            {
                                Format = "pcm_s16le",
                                SampleRate = 24000,
                                Channel = 1
                            }
                        },
                        Dialog = new DialogConfig
                        {
                            BotName = "沧朔",
                            SystemRole = "本机器人是室外虚拟古桥场景专属的AI语音交流角色，功能仅围绕古桥历史与用户对话交流，不参与任何操作控制。整体形象设定可爱软萌，语音轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。它熟知古桥的建造年代、历史故事、民间传说与建筑变迁，能用轻松可爱的语气和用户聊天，耐心解答各种关于古桥历史的问题，讲解生动有趣，自带亲切感，让用户在愉快的对话中了解古桥的历史与文化。",
                            SpeakingStyle = "你说话可爱软萌、轻快温柔、语气俏皮亲切，像个懂历史的小向导，说话软糯有趣，不会生硬呆板。",
                            Extra = new DialogExtra
                            {
                                InputMod = InputModes.Text,
                                Model = ModelVersions.O2_0
                            }
                        }
                    };

                    if (_client != null)
                    {
                        await _client.StartSessionAsync(request);
                        Console.WriteLine("✓ 文字对话模式已启动");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"✗ 启动失败: {ex.Message}");
                    return;
                }
            }

            Console.Write("请输入文字: ");
            var text = Console.ReadLine();

            if (string.IsNullOrWhiteSpace(text))
            {
                Console.WriteLine("输入为空");
                return;
            }

            try
            {
                Console.WriteLine($">>> {text}");
                if (_client != null)
                {
                    await _client.SendChatTextQueryAsync(text);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ 发送失败: {ex.Message}");
            }

            // 继续输入，支持连续对话
            while (_client?.IsSessionActive == true)
            {
                Console.WriteLine();
                Console.Write("请输入文字 (或输入 exit 退出): ");
                var nextText = Console.ReadLine();

                if (string.IsNullOrWhiteSpace(nextText))
                    continue;

                if (nextText.ToLower() == "exit")
                {
                    Console.WriteLine("退出文字对话模式");
                    break;
                }

                try
                {
                    Console.WriteLine($">>> {nextText}");
                    await _client.SendChatTextQueryAsync(nextText);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"✗ 发送失败: {ex.Message}");
                }
            }
        }

        static async Task StopAsync()
        {
            if (_client?.IsSessionActive == true)
            {
                if (_isRecording)
                {
                    _audioRecorder?.StopRecording();
                    _isRecording = false;
                }

                // 停止音频播放
                _audioPlayer?.Clear();

                await _client.FinishSessionAsync();
                Console.WriteLine("✓ 对话已停止");
            }
            else if (_client?.IsConnected == true)
            {
                await _client.DisconnectAsync();
                _audioPlayer?.Dispose();
                _audioRecorder?.Dispose();
                Console.WriteLine("✓ 已断开连接");
            }
            else
            {
                Console.WriteLine("当前没有活跃连接");
            }
        }

        static async Task ExitAsync()
        {
            await StopAsync();
            _isRunning = false;
            Console.WriteLine("再见!");
        }

        static void SetupEventHandlers()
        {
            if (_client == null) return;

            // AI文本流式输出状态
            bool aiLineStarted = false;

            _client.SessionStarted += (s, e) =>
            {
                Console.WriteLine($"[系统] 会话已启动");
            };

            _client.SessionFinished += (s, e) =>
            {
                Console.WriteLine("[系统] 会话已结束");
                _isRecording = false;
            };

            // ASR识别结果
            _client.ASRResultReceived += (s, e) =>
            {
                if (e.IsInterim)
                {
                    // 临时结果 - 用户正在说话，打断AI
                    if (!_isUserSpeaking)
                    {
                        _isUserSpeaking = true;
                        Console.WriteLine("\n[打断] 检测到用户说话");
                        
                        // 清空音频实现打断
                        _audioPlayer?.Clear();

                        // 发送打断事件
                        _ = Task.Run(async () =>
                        {
                            try { await _client!.SendClientInterruptAsync(); }
                            catch { }
                        });
                    }
                }
                else
                {
                    // 最终结果
                    Console.WriteLine($"[你] {e.Text}");
                }
            };

            // AI回复文本 - 流式输出
            _client.ChatResponseReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Content))
                {
                    if (!aiLineStarted)
                    {
                        Console.Write("[AI] ");
                        aiLineStarted = true;
                    }
                    Console.Write(e.Content);
                }
            };

            // AI回复结束 - 换行
            _client.ChatEnded += (s, e) =>
            {
                if (aiLineStarted)
                {
                    Console.WriteLine();
                    aiLineStarted = false;
                }
            };

            // TTS音频播放
            _client.TTSAudioReceived += (s, e) =>
            {
                if (e.AudioData != null && e.AudioData.Length > 0)
                {
                    _audioPlayer?.Play(e.AudioData);
                }
            };

            // ASR结束 - 用户说话结束
            _client.ASREnded += (s, e) =>
            {
                _isUserSpeaking = false;
            };

            // AI回复结束 - 换行并重置状态
            _client.ChatEnded += (s, e) =>
            {
                _isUserSpeaking = false;
                if (aiLineStarted)
                {
                    Console.WriteLine();
                    aiLineStarted = false;
                }
            };

            _client.ErrorReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.StatusCode))
                {
                    Console.WriteLine($"[错误] {e.StatusCode}: {e.Message}");
                }
                else
                {
                    Console.WriteLine($"[错误] {e.Error}");
                }
            };
        }
    }
}
