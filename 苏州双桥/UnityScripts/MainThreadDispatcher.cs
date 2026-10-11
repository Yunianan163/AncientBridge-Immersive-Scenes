using UnityEngine;
using System.Collections.Generic;
using System;

public class MainThreadDispatcher : MonoBehaviour
{
    private static MainThreadDispatcher _instance;
    private static readonly Queue<Action> _actions = new Queue<Action>();
    private static readonly object _lock = new object();

    public static MainThreadDispatcher Instance
    {
        get
        {
            if (_instance == null)
            {
                var obj = new GameObject("MainThreadDispatcher");
                _instance = obj.AddComponent<MainThreadDispatcher>();
                DontDestroyOnLoad(obj);
            }
            return _instance;
        }
    }

    void Update()
    {
        lock (_lock)
        {
            while (_actions.Count > 0)
            {
                _actions.Dequeue()?.Invoke();
            }
        }
    }

    public void Enqueue(Action action)
    {
        lock (_lock)
        {
            _actions.Enqueue(action);
        }
    }

    void OnDestroy()
    {
        _instance = null;
    }
}