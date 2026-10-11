mergeInto(LibraryManager.library, {
    // 发送消息从 Unity 到网页
    SendMessageToWeb: function(message) {
        var buffer = Module._malloc(message.length + 1);
        Module.writeStringToMemory(message, buffer);
        var msg = Module.UTF8ToString(buffer);
        Module._free(buffer);
        
        // 调用网页的接收函数
        if (window.unityMessageReceiver) {
            window.unityMessageReceiver(msg);
        } else {
            console.log('[Unity] 发送到网页的消息:', msg);
        }
    }
});
