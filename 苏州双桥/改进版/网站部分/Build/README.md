# Unity WebGL 构建文件放置说明

## 文件结构

将 Unity WebGL 构建文件按以下结构放置：

```
网站部分/
├── Build/
│   ├── Build.data.unityweb          # Unity 数据文件
│   ├── Build.wasm.code.unityweb     # WebAssembly 代码
│   ├── Build.wasm.framework.unityweb # WebAssembly 框架
│   └── UnityLoader.js               # Unity 加载器（如果使用旧版）
│   
│   # 或者新版本的 Unity WebGL 构建：
│   ├── Build.data.gz
│   ├── Build.framework.js.gz
│   ├── Build.wasm.gz
│   └── Build.loader.js
│
├── StreamingAssets/                 # Unity 流式资源（如果有）
│   └── ...
│
└── index.html
```

## 构建步骤

1. 在 Unity 中打开项目
2. 选择 `File` -> `Build Settings`
3. 选择 `WebGL` 平台
4. 点击 `Build`
5. 选择输出目录为本文件夹（`网站部分/Build/`）

## 配置说明

### 如果使用新版 Unity WebGL 构建（2020+）

修改 `index.html` 中的 `unityConfig` 对象：

```javascript
var unityConfig = {
    dataUrl: "Build/Build.data.gz",
    frameworkUrl: "Build/Build.framework.js.gz",
    codeUrl: "Build/Build.wasm.gz",
    streamingAssetsUrl: "StreamingAssets",
    companyName: "YourCompany",
    productName: "SuzhouShuangqiao",
    productVersion: "1.0"
};
```

### 如果使用旧版 Unity WebGL 构建

修改 `index.html` 中的 `unityConfig` 对象：

```javascript
var unityConfig = {
    dataUrl: "Build/Build.data.unityweb",
    frameworkUrl: "Build/Build.wasm.framework.unityweb",
    codeUrl: "Build/Build.wasm.code.unityweb",
    streamingAssetsUrl: "StreamingAssets",
    companyName: "YourCompany",
    productName: "SuzhouShuangqiao",
    productVersion: "1.0"
};
```

## Unity 端配置

在 Unity 项目中创建一个 `WebGLBridge.cs` 脚本：

```csharp
using UnityEngine;
using System.Runtime.InteropServices;

public class WebGLBridge : MonoBehaviour
{
    // 单例模式
    public static WebGLBridge Instance { get; private set; }
    
    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    // 接收来自网页的消息
    public void OnMessageFromWeb(string jsonMessage)
    {
        Debug.Log("[WebGL] 收到网页消息: " + jsonMessage);
        
        // 解析 JSON 并处理
        // 例如：切换季节、控制无人机等
    }
    
    // 接收网页就绪信号
    public void OnWebReady(string status)
    {
        Debug.Log("[WebGL] 网页已就绪: " + status);
    }
    
    // 接收浏览器窗口大小变化
    public void OnBrowserResize(string size)
    {
        Debug.Log("[WebGL] 浏览器大小变化: " + size);
    }
    
    // 向网页发送消息
    public void SendToWeb(string message)
    {
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendMessageToWeb(message);
        #else
        Debug.Log("[WebGL] 发送到网页: " + message);
        #endif
    }
    
    #if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void SendMessageToWeb(string message);
    #endif
}
```

同时在 `Plugins/WebGL` 文件夹下创建 `WebGLPlugin.jslib`：

```javascript
mergeInto(LibraryManager.library, {
    SendMessageToWeb: function(message) {
        var msg = Pointer_stringify(message);
        if (window.unityMessageReceiver) {
            window.unityMessageReceiver(msg);
        }
    }
});
```

## 注意事项

1. **Canvas 大小**：Unity WebGL 会自动适应容器大小
2. **输入焦点**：点击 Unity 区域会自动获取焦点
3. **性能**：确保 Unity 的 `WebGL Memory Size` 设置合理（默认 256MB）
4. **压缩**：建议使用 Gzip 压缩减少加载时间

## 测试

放置文件后打开 `index.html`，应该能看到：
- Unity 加载进度条
- 加载完成后 Unity 场景显示为背景
- 网页面板浮在 Unity 上方
