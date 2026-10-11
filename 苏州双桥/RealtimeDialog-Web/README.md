# 豆包语音对话系统 - 网页版

这是一个基于浏览器的语音对话系统，使用豆包（字节跳动）的实时对话API，支持语音输入和文字输入两种方式。

## 项目结构

```
RealtimeDialog-Web/
├── index.html              # 主页面
├── app.js                  # 应用主程序
├── RealtimeDialogClient.js # WebSocket客户端核心
├── AudioRecorder.js        # 音频录制（Web Audio API）
├── AudioPlayer.js          # 音频播放（Web Audio API）
├── protocol.js             # 协议编解码
├── events.js               # 事件模型定义
├── config.js               # 配置定义
└── README.md               # 本文档
```

## 功能特性

- 🎙️ **语音对话** - 使用麦克风进行实时语音交互
- ⌨️ **文字输入** - 支持键盘输入文字消息
- 🔊 **语音合成** - AI回复自动转换为语音播放
- 🛑 **智能打断** - 说话时可自动打断AI播放
- 📱 **响应式设计** - 支持桌面和移动设备

## 浏览器要求

- Chrome 60+
- Firefox 55+
- Safari 14+
- Edge 79+

需要支持以下API：
- WebSocket
- Web Audio API
- getUserMedia

## 快速开始

### 1. 配置API密钥

在 `app.js` 中修改以下配置：

```javascript
this.APP_ID = '您的AppId';
this.ACCESS_TOKEN = '您的AccessToken';
```

### 2. 启动服务

由于浏览器安全限制，需要通过HTTPS或localhost访问。可以使用以下方式启动本地服务器：

**使用 Python:**
```bash
cd RealtimeDialog-Web
python -m http.server 8080
```

**使用 Node.js:**
```bash
cd RealtimeDialog-Web
npx http-server -p 8080
```

**使用 VS Code:**
安装 Live Server 插件，右键点击 `index.html` 选择 "Open with Live Server"

### 3. 访问应用

打开浏览器访问 `http://localhost:8080`

## 使用说明

1. **连接服务器** - 点击"连接服务器"按钮建立WebSocket连接
2. **语音对话** - 点击"语音对话"开始语音交互
   - 点击后开始录音
   - 说话时会自动打断AI
   - AI回复会自动播放语音
3. **文字输入** - 在输入框中输入文字，按回车或点击发送
4. **停止** - 点击"停止"按钮结束当前对话

## 文件说明

### RealtimeDialogClient.js
WebSocket客户端核心，负责：
- 与服务器建立WebSocket连接
- 协议消息的编码和解码
- 事件分发和处理

### AudioRecorder.js
音频录制模块，使用Web Audio API：
- 获取麦克风权限
- 录制音频并转换为PCM格式
- 按指定时长分包发送

### AudioPlayer.js
音频播放模块，使用Web Audio API：
- 平滑播放接收到的PCM音频
- 预缓冲避免爆音
- 支持打断清空

### protocol.js
协议编解码模块：
- 定义消息类型和事件ID
- 消息编码（对象 → 二进制）
- 消息解码（二进制 → 对象）

### events.js
事件模型定义：
- 请求数据结构（StartSessionRequest等）
- 响应数据结构（ASRResponse等）
- 事件参数类

### config.js
配置定义：
- ClientConfig - 客户端配置
- VoiceSpeakers - 音色选项
- InputModes - 输入模式
- ModelVersions - 模型版本

## 事件列表

| 事件名 | 说明 |
|--------|------|
| connectionStarted | 连接已开始 |
| connectionFailed | 连接失败 |
| connectionFinished | 连接结束 |
| sessionStarted | 会话已启动 |
| sessionFinished | 会话已结束 |
| sessionFailed | 会话启动失败 |
| asrInfoReceived | 收到ASR信息 |
| asrResultReceived | 收到ASR识别结果 |
| asrEnded | ASR识别结束 |
| chatResponseReceived | 收到AI回复（流式） |
| chatEnded | AI回复结束 |
| ttsAudioReceived | 收到TTS音频 |
| errorReceived | 收到错误 |

## 注意事项

1. **HTTPS要求** - 由于使用了getUserMedia API，在非localhost环境下需要通过HTTPS访问
2. **麦克风权限** - 首次使用需要授权麦克风访问权限
3. **CORS限制** - 如果直接通过file协议打开HTML文件，某些功能可能无法正常工作
4. **音频格式** - 输入音频为16kHz 16位单声道PCM，输出音频为24kHz 16位单声道PCM

## 与Unity版本的区别

| 功能 | Unity (C#) | 网页版 (JavaScript) |
|------|------------|---------------------|
| WebSocket | ClientWebSocket | 原生WebSocket |
| 音频录制 | NAudio WaveIn | Web Audio API |
| 音频播放 | NAudio WaveOut | Web Audio API |
| 事件系统 | C# EventHandler | EventTarget |
| 线程 | 多线程 | 单线程（异步） |
| 部署 | 需要运行时 | 直接浏览器运行 |

## 许可证

MIT License
