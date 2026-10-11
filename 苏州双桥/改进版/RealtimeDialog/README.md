# 豆包端到端实时语音对话系统 C# 客户端

基于豆包 Realtime API 开发的 C# 语音对话客户端，支持**麦克风实时语音对话**、语音打断、文本输入等多种交互方式。

## 🎙️ 主要功能

- ✅ **麦克风实时语音对话** - 直接说话与AI交流
- ✅ **语音打断** - 说话时自动暂停AI播放
- ✅ **WebSocket 实时通信**
- ✅ **自定义二进制协议编解码**
- ✅ **音频实时播放** (使用 NAudio)
- ✅ **完整的事件处理机制**
- ✅ **多种输入模式** (麦克风持续监听、按键说话、文本、录音文件)
- ✅ **支持多种音色选择**
- ✅ **支持上下文管理**

## 📋 环境要求

- .NET 8.0 或更高版本
- Windows 操作系统
- 麦克风设备

## 🚀 快速开始

### 1. 配置 API 凭证

⚠️ **凭据不再写死在 `Program.cs` 里**（原先硬编码的 appId / accessToken / secretKey 已清除，
避免随交付包一起外泄）。现在从**环境变量**读取：

| 变量 | 说明 |
| --- | --- |
| `VOICE_APP_ID` | 火山引擎 App ID |
| `VOICE_ACCESS_TOKEN` | Access Token |
| `VOICE_APP_KEY` | App Key（`X-Api-App-Key` 请求头） |
| `VOICE_SECRET_KEY` | Secret Key（如用到签名场景） |

PowerShell 示例：

```powershell
$env:VOICE_APP_ID      = "你的appId"
$env:VOICE_ACCESS_TOKEN = "你的accessToken"
$env:VOICE_APP_KEY     = "你的appKey"
dotnet run
```

> 未配置时程序会打印一条明确的提示后退出，而不是带着空凭据去连上游。
> Web 侧（`苏州双桥/server.js`）同理，凭据放在 `苏州双桥/.env`（已 gitignore）。

### 2. 运行程序

```bash
cd RealtimeDialog
dotnet run
```

### 3. 使用麦克风对话

```
1. 输入 1 或 connect     - 连接服务器
2. 输入 2 或 start       - 开始会话（持续监听模式）
3. 直接说话即可与AI对话
4. 说话时AI会自动暂停，说完后AI会回复
5. 输入 8 或 stop        - 结束会话
6. 输入 9 或 disconnect  - 断开连接
```

## 📖 命令说明

| 命令 | 说明 |
|-----|------|
| `1` / `connect` | 连接到服务器 |
| `2` / `start` | 开始会话（**持续监听模式** - 自动检测语音） |
| `3` / `start-push` | 开始会话（**按键说话模式** - 按 record 说话） |
| `4` / `record` | 开始/停止录制麦克风 |
| `5` / `text` | 发送文本查询 |
| `6` / `audio` | 发送音频文件 |
| `7` / `hello` | 发送打招呼消息 |
| `8` / `stop` | 结束会话 |
| `9` / `disconnect` | 断开连接 |
| `0` / `exit` | 退出程序 |

## 🎤 麦克风输入模式

### 模式一：持续监听模式 (Keep Alive)

```
输入: 2 或 start
特点: 自动检测用户说话，无需按键
      AI说话时用户说话会自动打断
```

### 模式二：按键说话模式 (Push To Talk)

```
输入: 3 或 start-push
特点: 输入 record 开始录音，再次输入停止
      适合需要精确控制录音时机的场景
```

## 🔊 语音打断功能

系统支持**双向打断**：

1. **用户打断AI**: 当AI正在说话时，用户开始说话会自动暂停AI播放
2. **客户端打断**: 发送 ClientInterrupt 事件通知服务端

打断触发时机：
- 检测到 ASRInfo 事件（用户开始说话）
- 自动清空音频播放缓冲区
- 发送打断事件给服务端

## 📁 项目结构

```
RealtimeDialog/
├── RealtimeDialog.csproj    # 项目文件
├── Program.cs               # 程序入口和交互式示例
├── RealtimeDialogClient.cs  # WebSocket客户端核心类
├── Protocol.cs              # 二进制协议编解码
├── Events.cs                # 事件定义和数据模型
├── Configuration.cs         # 配置类和常量
├── AudioRecorder.cs         # 麦克风录制器
└── README.md                # 使用文档
```

## 🔧 核心组件说明

### AudioRecorder (麦克风录制)

```csharp
// 创建录制器 (16kHz, 16bit, 单声道, 20ms/包)
var recorder = new AudioRecorder(sampleRate: 16000, channels: 1, packetDurationMs: 20);

// 订阅音频数据事件
recorder.AudioDataAvailable += (s, audioData) => {
    // 发送音频数据到服务器
    await client.SendAudioAsync(audioData);
};

// 开始/停止录制
recorder.StartRecording();
recorder.StopRecording();
```

### 音频分包发送

麦克风音频按照 **20ms/包** 发送：
- 16000Hz 采样率
- 16bit 位深
- 单声道
- 每包大小: 640 bytes

### 音频播放

AI返回的音频自动播放：
- 24000Hz 采样率
- 16bit 位深
- 单声道
- PCM_S16LE 格式

## 🎛️ 高级配置

### 自定义会话配置

```csharp
var request = new StartSessionRequest
{
    Asr = new AsrConfig
    {
        AudioInfo = new AudioInfo
        {
            Format = "pcm",        // 输入格式
            SampleRate = 16000,    // 输入采样率
            Channel = 1            // 单声道
        },
        Extra = new AsrExtra
        {
            EndSmoothWindowMs = 1500,   // 停止说话判断时间(毫秒)
            EnableCustomVad = false,    // 是否开启自定义VAD
            EnableAsrTwopass = false    // 是否开启二遍识别
        }
    },
    Tts = new TtsConfig
    {
        Speaker = VoiceSpeakers.XiaoHe,  // 选择音色
        AudioConfig = new TtsAudioConfig
        {
            Format = "pcm_s16le",   // 输出格式
            SampleRate = 24000,     // 输出采样率
            Channel = 1,
            SpeechRate = 0,         // 语速(-50~100)
            LoudnessRate = 0        // 音量(-50~100)
        }
    },
    Dialog = new DialogConfig
    {
        BotName = "豆包",
        SystemRole = "你是豆包，是一个有用的AI助手。",
        SpeakingStyle = "",
        Extra = new DialogExtra
        {
            Model = ModelVersions.O2_0,      // 模型版本
            InputMod = InputModes.KeepAlive, // 输入模式
            EnableVolcWebSearch = false,     // 联网搜索
            EnableMusic = false              // 唱歌能力
        }
    }
};
```

## 🎙️ 音色列表

### O2.0 版本音色

| 常量 | 音色名称 | 描述 |
|-----|---------|------|
| `VoiceSpeakers.VV` | zh_female_vv_jupiter_bigtts | vv音色，活泼灵动的女声 |
| `VoiceSpeakers.XiaoHe` | zh_female_xiaohe_jupiter_bigtts | xiaohe音色，甜美活泼的女声（台湾口音） |
| `VoiceSpeakers.YunZhou` | zh_male_yunzhou_jupiter_bigtts | yunzhou音色，清爽沉稳的男声 |
| `VoiceSpeakers.XiaoTian` | zh_male_xiaotian_jupiter_bigtts | xiaotian音色，清爽磁性的男声 |

## 📥 输入模式

| 模式 | 常量 | 说明 |
|-----|------|------|
| 持续监听 | `InputModes.KeepAlive` | 自动检测语音，支持打断 |
| 按键说话 | `InputModes.PushToTalk` | 手动控制录音开始/结束 |
| 纯文本 | `InputModes.Text` | 仅使用文本输入 |
| 音频文件 | `InputModes.AudioFile` | 上传录音文件 |

## 🤖 模型版本

| 版本 | 常量 | 说明 |
|-----|------|------|
| O2.0 | `ModelVersions.O2_0` | 1.2.1.1，支持唱歌、热修复 |
| SC2.0 | `ModelVersions.SC2_0` | 2.2.0.0，支持角色扮演、音色克隆 |

## 📡 事件处理

```csharp
// ASR识别结果
client.ASRResultReceived += (s, e) => {
    if (e.IsInterim)
        Console.Write($"识别中: {e.Text}");  // 临时结果
    else
        Console.WriteLine($"识别完成: {e.Text}");  // 最终结果
};

// AI回复文本
client.ChatResponseReceived += (s, e) => {
    Console.WriteLine($"AI: {e.Content}");
};

// TTS音频数据（自动播放）
client.TTSAudioReceived += (s, e) => {
    // 音频数据自动写入播放缓冲区
};

// 打断事件（用户说话时触发）
client.ASRInfoReceived += (s, e) => {
    // 暂停AI播放
    PauseAudioPlayback();
    // 发送打断事件
    await client.SendClientInterruptAsync();
};
```

## ⚠️ 注意事项

1. **麦克风权限**: 首次运行需要授权麦克风访问权限

2. **音频格式**:
   - 输入: PCM, 16000Hz, 16bit, 单声道
   - 输出: PCM_S16LE, 24000Hz, 16bit, 单声道

3. **网络要求**: 需要稳定的网络连接，建议使用有线网络

4. **资源释放**: 程序退出前会自动断开连接和释放资源

## 📦 依赖包

- Newtonsoft.Json (13.0.3) - JSON 序列化
- NAudio (2.2.1) - 音频录制和播放

## 📝 使用示例

### 最简单的麦克风对话

```csharp
// 1. 创建客户端
var client = new RealtimeDialogClient(config);

// 2. 连接服务器
await client.ConnectAsync();

// 3. 开始会话（持续监听模式）
await client.StartSessionAsync(new StartSessionRequest {
    Dialog = new DialogConfig {
        Extra = new DialogExtra {
            InputMod = InputModes.KeepAlive
        }
    }
});

// 4. 直接说话即可！
```

### 手动控制录音

```csharp
// 开始录音
await client.StartSessionAsync(new StartSessionRequest {
    Dialog = new DialogConfig {
        Extra = new DialogExtra {
            InputMod = InputModes.PushToTalk
        }
    }
});

// 按住说话
recorder.StartRecording();

// 松开停止
recorder.StopRecording();
await client.SendEndASRAsync();
```

## 🔗 相关链接

- [豆包 Realtime API 文档](https://www.volcengine.com/docs/6561/1305191)

## 📄 许可证

MIT License
