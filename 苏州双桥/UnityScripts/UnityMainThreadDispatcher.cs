using UnityEngine;
using System;
using System.Collections.Generic;

/// <summary>
/// Unity 主线程调度器 - 确保 WebSocket 回调在主线程执行
/// </summary>
public class UnityMainThreadDispatcher : MonoBehaviour
{
    private static UnityMainThreadDispatcher _instance;
    private static Queue<Action> _actions = new Queue<Action>();
    private static object _lock = new object();

    void Awake()
    {
        if (_instance == null)
        {
            _instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }

    void Update()
    {
        lock (_lock)
        {
            while (_actions.Count > 0)
                _actions.Dequeue()?.Invoke();
        }
    }

    /// <summary>
    /// 将操作加入主线程队列
    /// </summary>
    public static void Enqueue(Action action)
    {
        if (_instance == null) return;
        lock (_lock) { _actions.Enqueue(action); }
    }
}