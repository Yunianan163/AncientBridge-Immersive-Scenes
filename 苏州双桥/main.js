// ============================= 面板拖拽功能 =============================
function makeDraggable(panel, handleSelector) {
    if (!panel) return;
    const handle = handleSelector ? panel.querySelector(handleSelector) : panel;
    if (!handle) return;

    let isDragging = false;
    let hasMoved = false;
    let startX, startY, startLeft, startTop;

    handle.style.cursor = 'move';
    handle.style.userSelect = 'none';
    handle.style.webkitUserSelect = 'none';

    handle.addEventListener('mousedown', function(e) {
        if (e.target.closest('button, input, a, textarea, select, [onclick]')) return;

        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = panel.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(panel);

        if (computedStyle.transform && computedStyle.transform !== 'none') {
            panel.style.setProperty('transform', 'none', 'important');
        }
        if (computedStyle.right !== 'auto') {
            panel.style.setProperty('right', 'auto', 'important');
        }
        if (computedStyle.bottom !== 'auto') {
            panel.style.setProperty('bottom', 'auto', 'important');
        }

        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';

        startLeft = rect.left;
        startTop = rect.top;

        panel.dataset.dragged = 'true';
        panel.classList.add('dragging-panel');

        e.preventDefault();

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            hasMoved = true;
        }
        panel.style.left = (startLeft + dx) + 'px';
        panel.style.top = (startTop + dy) + 'px';
    }

    function onMouseUp() {
        isDragging = false;
        panel.classList.remove('dragging-panel');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    handle.addEventListener('click', function(e) {
        if (hasMoved) {
            e.stopImmediatePropagation();
            hasMoved = false;
        }
    }, true);
}

function initDraggablePanels() {
    const panelConfigs = [
        { id: 'unlock-intro-panel', handle: '.panel-header' },
        { id: 'model-intro-panel', handle: '.panel-header' },
        { id: 'drone-guide-panel', handle: '.panel-header' },
        { id: 'voice-dialog-panel', handle: '.panel-header' },
        { id: 'history-panel', handle: 'h3' },
        { id: 'bottom-controls', handle: null },
        { id: 'audio-control', handle: '.audio-control-header' }
    ];

    panelConfigs.forEach(({ id, handle }) => {
        const panel = document.getElementById(id);
        if (panel) {
            makeDraggable(panel, handle);
        }
    });
}
// ============================= WebSocket 客户端 =============================
// WebSocket 连接（与 Unity 通信）
let ws = null;
let isConnected = false;
let reconnectTimer = null;
let isPageUnloading = false;

// 模型面板状态
let isModelPanelOpen = false;

// 模型介绍交互状态
let bridgeIntroPinned = false;
let pinnedBridgeType = '';
let currentHoverBridgeType = '';

// 更多历史介绍窗口状态
let isUnlockIntroUnlocked = false;
let isUnlockIntroPanelManuallyClosed = false;

// 无人机指南窗口状态
let isDroneGuidePanelManuallyClosed = false;

// 无人机起飞状态
let isDroneFlying = false;

// 箭头提示显示状态
let isArrowHintShowing = false;

// 事件拦截是否已绑定
let modelIntroShieldBound = false;

// 调试模式
const DEBUG = true;

// 防止季节切换消息循环
let lastSeasonReceived = {
    season: null,
    time: 0,
    from: null
};

// 任务进度状态
let taskProgress = {
    viewedModel: false,
    seasonsVisited: {
        spring: false,
        summer: false,
        autumn: false,
        winter: false
    },
    droneUnlocked: false
};

// 调试日志
function debugLog(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}

// WebSocket 连接（与 Unity 本地服务器通信）
// 关键修复：端口改为与 server.js 一致的 8082
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    debugLog('正在连接 WebSocket...');
    // 修复：端口从 8802 改为 8082，与 server.js 保持一致
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(wsProtocol + '//' + window.location.host + '/ws');

    ws.onopen = () => {
        console.log('✅ WebSocket 已连接');
        isConnected = true;
        addLog('系统：WebSocket 连接成功', 'system');

        sendToServer({
            type: 'register',
            client: 'web',
            from: 'web',
            resetSession: true,
            time: new Date().toISOString()
        });

        showCenterMessage('网页端已连接服务器');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📨 收到消息:', data.type, data);
            handleServerMessage(data);
        } catch (err) {
            console.error('❌ 消息解析失败:', err, event.data);
            addLog('错误：收到无法解析的消息', 'error');
        }
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket 错误:', error);
        addLog('错误：WebSocket 连接失败', 'error');
    };

    ws.onclose = () => {
        console.log('🔌 WebSocket 关闭');
        isConnected = false;

        if (isPageUnloading) return;

        addLog('系统：连接断开，5秒后重连...', 'system');
        resetTaskPanelUI(false);

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        reconnectTimer = setTimeout(() => {
            connectWebSocket();
        }, 5000);
    };
}

// 辅助函数
function normalizeSeasonKey(season) {
    if (!season) return '';
    const s = String(season).trim().toLowerCase();

    switch (s) {
        case 'spring':
        case '春':
        case '春天':
            return 'spring';

        case 'summer':
        case '夏':
        case '夏天':
            return 'summer';

        case 'autumn':
        case 'fall':
        case '秋':
        case '秋天':
            return 'autumn';

        case 'winter':
        case '冬':
        case '冬天':
            return 'winter';

        default:
            return '';
    }
}

function getSeasonDisplayName(season) {
    const map = {
        spring: '春',
        summer: '夏',
        autumn: '秋',
        winter: '冬'
    };
    return map[normalizeSeasonKey(season)] || season;
}

function normalizeBridgeType(type) {
    if (!type) return 'shide';
    const s = String(type).trim().toLowerCase();

    if (s === 'shide' || s === '世德桥' || s === '世德') return 'shide';
    if (s === 'yongan' || s === '永安桥' || s === '永安') return 'yongan';

    return 'shide';
}

// 提示和 UI 函数
function showModelHoverTip() {
    const tip = document.getElementById('model-hover-tip');
    if (!tip) return;

    tip.style.display = 'block';
    setTimeout(() => tip.classList.add('show'), 10);
}

function hideModelHoverTip() {
    const tip = document.getElementById('model-hover-tip');
    if (!tip) return;

    tip.classList.remove('show');
    setTimeout(() => {
        tip.style.display = 'none';
    }, 200);
}

function pinBridgeIntro(type) {
    bridgeIntroPinned = true;
    pinnedBridgeType = normalizeBridgeType(type);
    currentHoverBridgeType = pinnedBridgeType;
    showBridgeIntro(pinnedBridgeType, true);
    updateModelIntroPinnedUI();
    showCenterMessage('已固定 ' + (normalizeBridgeType(type) === 'yongan' ? '永安桥' : '世德桥') + ' 介绍面板');
}

function clearBridgeIntroPin() {
    bridgeIntroPinned = false;
    pinnedBridgeType = '';
    currentHoverBridgeType = '';
    updateModelIntroPinnedUI();
}

function updateModelIntroPinnedUI() {
    const badge = document.getElementById('model-intro-lock-badge');
    const panel = document.getElementById('model-intro-panel');

    if (!badge || !panel) return;

    badge.style.display = bridgeIntroPinned ? 'inline-flex' : 'none';
    panel.classList.toggle('intro-pinned', bridgeIntroPinned);
}

// 事件拦截
function bindModelIntroShield() {
    if (modelIntroShieldBound) return;

    const panel = document.getElementById('model-intro-panel');
    if (!panel) return;

    const stopToUnity = (e) => {
        e.stopPropagation();
        e.preventDefault();
    };

    ['wheel', 'mousedown', 'mouseup', 'click', 'dblclick', 'scroll'].forEach(evt => {
        panel.addEventListener(evt, stopToUnity, true);
    });

    const allElements = panel.querySelectorAll('*');
    allElements.forEach(el => {
        ['wheel', 'mousedown', 'mouseup', 'click', 'dblclick', 'scroll'].forEach(evt => {
            el.addEventListener(evt, stopToUnity, true);
        });
    });

    modelIntroShieldBound = true;
    debugLog('模型介绍面板事件拦截已绑定');
}

// 任务进度 UI
function setTaskState(elementId, completed) {
    const row = document.getElementById(elementId);
    if (!row) return;

    const stateEl = row.classList.contains('task-state') ? row : row.querySelector('.task-state');
    if (!stateEl) return;

    // 任务完成后不显示文字
    stateEl.textContent = '';
    stateEl.classList.toggle('done', completed);
    stateEl.classList.toggle('pending', !completed);
    
    // 给任务项添加/移除完成状态类
    row.classList.toggle('completed', completed);
}

// 关键修复：自动解锁并通知Unity
function updateTaskPanel() {
    setTaskState('task-view-model', taskProgress.viewedModel);
    setTaskState('task-spring', taskProgress.seasonsVisited.spring);
    setTaskState('task-summer', taskProgress.seasonsVisited.summer);
    setTaskState('task-autumn', taskProgress.seasonsVisited.autumn);
    setTaskState('task-winter', taskProgress.seasonsVisited.winter);

    const seasonCount = Object.values(taskProgress.seasonsVisited).filter(Boolean).length;

    // 关键修复：自动检查并解锁无人机，并通知Unity
    const allRequirementsMet = taskProgress.viewedModel && seasonCount === 4;
    if (allRequirementsMet && !taskProgress.droneUnlocked) {
        taskProgress.droneUnlocked = true;

        // 关键：发送解锁消息给Unity！
        sendToServer({
            type: 'droneUnlocked',
            data: '任务完成，解锁无人机',
            from: 'web'
        });

        showDroneGuide();
        showDroneGuidePanel();
        addLog('系统：已完成全部网页前置交互，无人机已解锁！', 'system');
        showCenterMessage('🎉 无人机已解锁！');
    }

    updateExtraControlButtons();
    positionDroneAudioControl();
}

function showTaskPanel() {
    const panel = document.getElementById('task-panel');
    if (panel) {
        panel.style.display = 'block';
        panel.style.opacity = '1';
    }
    positionDroneAudioControl();
}

function hideTaskPanel() {
    const panel = document.getElementById('task-panel');
    if (!panel) return;

    panel.style.transition = 'opacity 0.5s ease';
    panel.style.opacity = '0';

    setTimeout(() => {
        panel.style.display = 'none';
    }, 500);
}

function resetTaskPanelUI(showLog = true) {
    taskProgress.viewedModel = false;
    taskProgress.seasonsVisited = {
        spring: false,
        summer: false,
        autumn: false,
        winter: false
    };
    taskProgress.droneUnlocked = false;

    isDroneFlying = false;
    isArrowHintShowing = false;
    isUnlockIntroUnlocked = false;

    ['task-view-model', 'task-spring', 'task-summer', 'task-autumn', 'task-winter'].forEach(id => setTaskState(id, false));

    const summaryEl = document.getElementById('task-summary-text');
    if (summaryEl) {
        summaryEl.textContent = '请先完成"查看模型及介绍"以及春、夏、秋、冬四季交互，完成后将解锁无人机。';
    }

    isUnlockIntroPanelManuallyClosed = false;
    isDroneGuidePanelManuallyClosed = false;

    hideDroneGuide();
    hideArrowHint();
    hideUnlockIntroPanel();
    setUnlockIntroLockedState(false);
    hideRobotEntryButton();
    hideModelHoverTip();
    clearBridgeIntroPin();
    hideBridgeIntro(true);
    closeModelGuide();
    closeSeasonGuide();
    closeAutumnGuide();
    closeWinterGuide();
    closeBridgeUnlockGuide();
    closeRobotActionGuide();
    closeRobotAppearedGuide();
    hasShownSeasonGuide = false;
    hasShownBridgeUnlockGuide = false;
    hasShownRobotActionGuide = false;
    hasShownRobotAppearedGuide = false;
    updateExtraControlButtons();

    const welcomeHint = document.getElementById('welcome-hint');
    if (welcomeHint) {
        welcomeHint.style.display = 'block';
        welcomeHint.classList.remove('hide');
    }

    document.querySelectorAll('#bottom-controls .control-btn').forEach(btn => {
        if (!btn.classList.contains('extra-control-btn')) {
            btn.classList.remove('active');
        }
    });

    isModelPanelOpen = false;

    if (showLog) {
        addLog('系统：任务进度已重置为初始状态', 'system');
    }
}

// 底部按钮
function updateExtraControlButtons() {
    const shouldShow = !!taskProgress.droneUnlocked;

    // 打开无人机指南按钮 - 显示/隐藏
    const btnGuide = document.getElementById('btn-open-drone-guide');
    if (btnGuide) {
        btnGuide.style.display = shouldShow ? 'flex' : 'none';
    }

    // 更多历史介绍按钮 - 显示/隐藏
    const btnIntro = document.getElementById('btn-open-unlock-intro');
    if (btnIntro) {
        btnIntro.style.display = shouldShow ? 'flex' : 'none';
    }
}

function reopenDroneGuide() {
    isDroneGuidePanelManuallyClosed = false;
    showDroneGuidePanel();
    addLog('系统：重新打开无人机指南窗口', 'system');
}

function reopenUnlockIntro() {
    isUnlockIntroPanelManuallyClosed = false;
    showUnlockIntroPanel();
    addLog('系统：重新打开更多历史介绍窗口', 'system');
}

// 无人机指南
function showDroneGuide() {
    // 任务完成后显示"无人机指南"按钮
    const btn = document.getElementById('btn-drone-guide');
    if (btn) {
        btn.style.display = 'block';
    }
}

function showDroneGuidePanel() {
    const panel = document.getElementById('drone-guide-panel');
    if (!panel) return;

    panel.style.opacity = '1';
    if (panel.dataset.dragged === 'true') {
        panel.style.transform = 'scale(1)';
    } else {
        panel.style.transform = 'translate(-50%, -50%) scale(1)';
    }
    panel.style.pointerEvents = 'auto';
    panel.classList.add('highlight');

    setTimeout(() => {
        panel.classList.remove('highlight');
    }, 2000);
}

function hideDroneGuide() {
    const panel = document.getElementById('drone-guide-panel');
    if (!panel) return;

    panel.style.opacity = '0';
    if (panel.dataset.dragged === 'true') {
        panel.style.transform = 'scale(0.7)';
    } else {
        panel.style.transform = 'translate(-50%, -50%) scale(0.7)';
    }
    panel.style.pointerEvents = 'none';
    panel.classList.remove('highlight');
}

function closeDroneGuidePanel() {
    isDroneGuidePanelManuallyClosed = true;
    hideDroneGuide();
    hideArrowHint();
    addLog('系统：已关闭无人机指南窗口', 'system');
}

function confirmDroneGuide() {
    hideDroneGuide();
    addLog('系统：已确认无人机指南，请操控无人机靠近桥梁', 'system');
    if (!isUnlockIntroUnlocked) {
        showArrowHint();
    }
}

// 箭头提示
function showArrowHint() {
    if (isArrowHintShowing || isUnlockIntroUnlocked) return;

    const hint = document.getElementById('arrow-hint');
    if (!hint) return;

    isArrowHintShowing = true;
    hint.style.display = 'flex';
    hint.style.opacity = '0';

    setTimeout(() => {
        hint.style.transition = 'opacity 0.5s ease';
        hint.style.opacity = '1';
    }, 100);

    addLog('系统：显示前进提示箭头（直到触发 BridgeUnlockZone 才隐藏）', 'system');
}

function hideArrowHint() {
    const hint = document.getElementById('arrow-hint');
    if (!hint) return;

    isArrowHintShowing = false;
    hint.style.transition = 'opacity 0.5s ease';
    hint.style.opacity = '0';

    setTimeout(() => {
        hint.style.display = 'none';
    }, 500);

    addLog('系统：隐藏前进提示箭头', 'system');
}

// 更多历史介绍窗口
function showUnlockIntroPanel() {
    if (isUnlockIntroPanelManuallyClosed) return;

    const panel = document.getElementById('unlock-intro-panel');
    if (!panel) {
        debugLog('错误：找不到 unlock-intro-panel 元素');
        return;
    }

    panel.style.display = 'block';
    panel.style.opacity = '1';
    panel.classList.add('highlight');

    setTimeout(() => {
        panel.classList.remove('highlight');
    }, 2000);

    addLog('系统：显示更多历史介绍窗口', 'system');
}

function hideUnlockIntroPanel() {
    const panel = document.getElementById('unlock-intro-panel');
    if (!panel) return;

    panel.style.display = 'none';
    panel.style.opacity = '0';
    addLog('系统：隐藏更多历史介绍窗口', 'system');
}

function closeUnlockIntroPanel() {
    isUnlockIntroPanelManuallyClosed = true;
    hideUnlockIntroPanel();
    addLog('系统：已关闭更多历史介绍窗口', 'system');
}

function setUnlockIntroLockedState(unlocked) {
    debugLog('设置解锁状态:', unlocked, '当前状态:', isUnlockIntroUnlocked);
    isUnlockIntroUnlocked = !!unlocked;

    const panel = document.getElementById('unlock-intro-panel');
    const overlay = document.getElementById('unlock-lock-overlay');
    const badge = document.getElementById('unlock-status-badge');
    const tabs = document.getElementById('unlock-intro-tabs');
    const content = document.getElementById('unlock-intro-content');

    if (!panel) {
        debugLog('错误：找不到 unlock-intro-panel');
        return;
    }

    if (unlocked) {
        panel.classList.remove('locked-panel');
        panel.classList.add('unlocked-panel');

        if (overlay) {
            overlay.style.display = 'none';
            debugLog('已隐藏锁定遮罩');
        }

        if (badge) {
            badge.textContent = '已解锁';
            badge.classList.remove('locked');
            badge.classList.add('unlocked');
        }

        if (tabs) tabs.classList.remove('tabs-disabled');
        if (content) content.classList.remove('content-locked');

        addLog('🎉 系统：更多历史介绍已解锁！', 'system');
        showCenterMessage('🎉 已到达桥旁，更多历史介绍已解锁！');

        showUnlockIntroPanel();

        // 显示进入机器人语音对话按钮
        showRobotEntryButton();
    } else {
        panel.classList.remove('unlocked-panel');
        panel.classList.add('locked-panel');

        if (overlay) overlay.style.display = 'flex';

        if (badge) {
            badge.textContent = '待解锁';
            badge.classList.remove('unlocked');
            badge.classList.add('locked');
        }

        if (tabs) tabs.classList.add('tabs-disabled');
        if (content) content.classList.add('content-locked');
    }
}

// ============================= 机器人语音对话入口 =============================

// 机器人语音对话状态
let isRobotVoiceDialogActive = false;

// 无人机音效音量状态（0~1）
let droneAudioVolume = 0.2;
let droneAudioMuted = false;
let droneVolumeBeforeMute = 0.2;

function updateDroneAudioControlUI() {
    const slider = document.getElementById('drone-volume-slider');
    const valueEl = document.getElementById('drone-volume-value');
    const muteIcon = document.getElementById('drone-mute-icon');
    const muteBtn = document.getElementById('drone-audio-mute-btn');

    if (slider) {
        slider.value = droneAudioMuted ? 0 : Math.round(droneAudioVolume * 100);
    }
    if (valueEl) {
        valueEl.textContent = (droneAudioMuted ? 0 : Math.round(droneAudioVolume * 100)) + '%';
    }
    if (muteIcon) {
        muteIcon.textContent = droneAudioMuted ? '🔇' : '🔊';
    }
    if (muteBtn) {
        muteBtn.title = droneAudioMuted ? '取消静音' : '静音';
    }
}

function setDroneVolume(volume) {
    volume = Math.max(0, Math.min(1, volume));
    droneAudioVolume = volume;
    if (volume > 0 && droneAudioMuted) {
        droneAudioMuted = false;
    }
    if (volume > 0) {
        droneVolumeBeforeMute = volume;
    }

    updateDroneAudioControlUI();

    sendToServer({
        type: 'droneVolume',
        volume: droneAudioMuted ? 0 : droneAudioVolume,
        from: 'web',
        time: new Date().toISOString()
    });

    addLog('系统：无人机音效音量调整为 ' + Math.round((droneAudioMuted ? 0 : droneAudioVolume) * 100) + '%', 'system');
}

function toggleDroneMute() {
    if (droneAudioMuted) {
        droneAudioMuted = false;
        droneAudioVolume = droneVolumeBeforeMute > 0 ? droneVolumeBeforeMute : 0.2;
    } else {
        droneVolumeBeforeMute = droneAudioVolume > 0 ? droneAudioVolume : 0.2;
        droneAudioMuted = true;
    }
    updateDroneAudioControlUI();

    sendToServer({
        type: 'droneVolume',
        volume: droneAudioMuted ? 0 : droneAudioVolume,
        from: 'web',
        time: new Date().toISOString()
    });

    addLog(droneAudioMuted ? '系统：已静音无人机音效' : '系统：已恢复无人机音效', 'system');
}

// 背景音乐音量状态（0~1）
let bgmAudioVolume = 0.3;
let bgmAudioMuted = false;
let bgmVolumeBeforeMute = 0.3;

function applyBgmAudioVolume() {
    const audio = document.getElementById('bgm-audio');
    if (audio) {
        audio.volume = bgmAudioMuted ? 0 : bgmAudioVolume;
    }
}

let bgmAutoPlayAttempted = false;

function initBgmAudio() {
    const audio = document.getElementById('bgm-audio');
    if (!audio || bgmAutoPlayAttempted) return;
    bgmAutoPlayAttempted = true;

    const src = audio.querySelector('source')?.src || audio.src;
    console.log('[BGM] 初始化背景音乐, 路径:', src, 'readyState:', audio.readyState);

    audio.onerror = (e) => {
        console.error('[BGM] 音频加载失败, error code:', audio.error?.code,
            '(1= aborted, 2= network, 3= decode, 4= unsupported), 路径:', src);
    };

    const tryPlay = () => {
        audio.volume = bgmAudioMuted ? 0 : bgmAudioVolume;
        console.log('[BGM] 尝试播放, volume:', audio.volume);
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log('[BGM] 背景音乐已开始播放');
            }).catch((err) => {
                console.log('[BGM] 自动播放被浏览器阻止, 等待用户交互:', err.name, err.message);
                const resumeAudio = () => {
                    audio.play().then(() => {
                        console.log('[BGM] 用户交互后已开始播放背景音乐');
                    }).catch((e) => {
                        console.warn('[BGM] 用户交互后播放仍失败:', e);
                    });
                };
                document.addEventListener('click', resumeAudio, { once: true });
                document.addEventListener('keydown', resumeAudio, { once: true });
            });
        }
    };

    if (audio.readyState >= 2) {
        // 音频已有当前帧数据, 直接播放
        tryPlay();
    } else {
        // 等待音频加载完成
        audio.addEventListener('canplaythrough', tryPlay, { once: true });
        // 备选: loadedmetadata 后如果 duration 有效也尝试
        audio.addEventListener('loadedmetadata', () => {
            console.log('[BGM] 音频元数据已加载, duration:', audio.duration);
            if (audio.readyState >= 2) tryPlay();
        }, { once: true });
    }
}

function updateBgmAudioControlUI() {
    const slider = document.getElementById('bgm-volume-slider');
    const valueEl = document.getElementById('bgm-volume-value');
    const muteIcon = document.getElementById('bgm-mute-icon');
    const muteBtn = document.getElementById('bgm-mute-btn');

    if (slider) {
        slider.value = bgmAudioMuted ? 0 : Math.round(bgmAudioVolume * 100);
    }
    if (valueEl) {
        valueEl.textContent = (bgmAudioMuted ? 0 : Math.round(bgmAudioVolume * 100)) + '%';
    }
    if (muteIcon) {
        muteIcon.textContent = bgmAudioMuted ? '🔇' : '🔊';
    }
    if (muteBtn) {
        muteBtn.title = bgmAudioMuted ? '取消静音' : '静音';
    }

    applyBgmAudioVolume();
}

function setBgmVolume(volume) {
    volume = Math.max(0, Math.min(1, volume));
    bgmAudioVolume = volume;
    if (volume > 0 && bgmAudioMuted) {
        bgmAudioMuted = false;
    }
    if (volume > 0) {
        bgmVolumeBeforeMute = volume;
    }

    updateBgmAudioControlUI();

    sendToServer({
        type: 'bgmVolume',
        volume: bgmAudioMuted ? 0 : bgmAudioVolume,
        from: 'web',
        time: new Date().toISOString()
    });

    addLog('系统：背景音乐音量调整为 ' + Math.round((bgmAudioMuted ? 0 : bgmAudioVolume) * 100) + '%', 'system');
}

function toggleBgmMute() {
    if (bgmAudioMuted) {
        bgmAudioMuted = false;
        bgmAudioVolume = bgmVolumeBeforeMute > 0 ? bgmVolumeBeforeMute : 0.3;
    } else {
        bgmVolumeBeforeMute = bgmAudioVolume > 0 ? bgmAudioVolume : 0.3;
        bgmAudioMuted = true;
    }
    updateBgmAudioControlUI();

    sendToServer({
        type: 'bgmVolume',
        volume: bgmAudioMuted ? 0 : bgmAudioVolume,
        from: 'web',
        time: new Date().toISOString()
    });

    addLog(bgmAudioMuted ? '系统：已静音背景音乐' : '系统：已恢复背景音乐', 'system');
}

function toggleAudioControl() {
    const panel = document.getElementById('audio-control');
    if (!panel) return;
    panel.classList.toggle('expanded');
}

function positionDroneAudioControl() {
    // 音量控制面板已固定到左上角，无需动态定位
}

function showRobotEntryButton() {
    const btn = document.getElementById('robot-entry-btn');
    const hint = document.getElementById('robot-location-hint');
    if (btn) {
        btn.style.display = 'block';
        btn.classList.add('ready');
    }
    // 显示机器人位置提示
    if (hint) {
        hint.style.display = 'flex';
        hint.classList.add('show');
    }
    // 显示机器人朝向提示
    showRobotDirectionHint();
    addLog('系统：机器人语音对话入口已激活，机器人将出现在世德桥上', 'system');
}

function hideRobotEntryButton() {
    const btn = document.getElementById('robot-entry-btn');
    const hint = document.getElementById('robot-location-hint');
    if (btn) {
        btn.style.display = 'none';
        btn.classList.remove('ready');
    }
    // 隐藏机器人位置提示
    if (hint) {
        hint.style.display = 'none';
        hint.classList.remove('show');
    }
    // 隐藏机器人朝向提示
    closeRobotDirectionHint();
}

function showRobotDirectionHint() {
    const hint = document.getElementById('robot-direction-hint');
    if (hint) {
        hint.style.display = 'flex';
    }
}

function closeRobotDirectionHint() {
    const hint = document.getElementById('robot-direction-hint');
    if (hint) {
        hint.style.display = 'none';
    }
}

function showRobotActionHint() {
    const dirHint = document.getElementById('robot-direction-hint');
    const actionHint = document.getElementById('robot-action-hint');
    const btn = document.getElementById('robot-entry-btn');
    if (dirHint) dirHint.style.display = 'none';
    if (actionHint) actionHint.style.display = 'flex';
    if (btn) btn.classList.add('highlight');
}

function closeRobotActionHint() {
    const actionHint = document.getElementById('robot-action-hint');
    const btn = document.getElementById('robot-entry-btn');
    if (actionHint) actionHint.style.display = 'none';
    if (btn) btn.classList.remove('highlight');
    // 关闭靠近古桥彩蛋语音导览，并显示下一个语音导览
    closeBridgeUnlockGuide();
    showRobotActionGuide();
}

// 隐藏机器人位置提示（Unity机器人出现时调用）
function hideRobotLocationHint() {
    const hint = document.getElementById('robot-location-hint');
    if (hint) {
        hint.style.display = 'none';
        hint.classList.remove('show');
        addLog('系统：机器人已出现在世德桥上', 'system');
    }
}

// 更新机器人入口按钮状态
function updateRobotEntryButtonState(isActive) {
    const btn = document.getElementById('robot-entry-btn');
    if (!btn) return;
    
    isRobotVoiceDialogActive = isActive;
    
    if (isActive) {
        // 语音对话打开后，隐藏入口按钮（通过面板顶部的×来关闭）
        btn.style.display = 'none';
        btn.classList.add('active');
    } else {
        // 语音对话关闭后，显示入口按钮，文字固定为"进入"
        btn.style.display = 'block';
        btn.innerHTML = '<img src="robot3.png" alt="机器人"> 进入机器人语音对话';
        btn.classList.remove('active');
    }
}

// ============================= 麦克风权限前置弹窗 =============================

function showMicPermissionPrompt() {
    // 如果已经有权限，直接打开视频
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then(result => {
            if (result.state === 'granted') {
                openRobotVideo();
            } else {
                _createMicPermissionModal();
            }
        }).catch(() => {
            _createMicPermissionModal();
        });
    } else {
        _createMicPermissionModal();
    }
}

function _createMicPermissionModal() {
    const existing = document.getElementById('mic-permission-overlay');
    if (existing) existing.remove();

    if (!document.getElementById('mic-permission-styles-main')) {
        const style = document.createElement('style');
        style.id = 'mic-permission-styles-main';
        style.textContent = `
            #mic-permission-overlay {
                position: fixed;
                top: 0; left: 0;
                width: 100%; height: 100%;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .mic-permission-backdrop {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
            }
            .mic-permission-modal {
                position: relative;
                background: #fff;
                border-radius: 16px;
                padding: 32px 28px;
                width: 90%;
                max-width: 420px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
                animation: micPermissionFadeIn 0.3s ease;
            }
            @keyframes micPermissionFadeIn {
                from { opacity: 0; transform: translateY(20px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .mic-permission-icon { font-size: 48px; margin-bottom: 12px; }
            .mic-permission-title { font-size: 20px; font-weight: 700; color: #333; margin: 0 0 10px; }
            .mic-permission-desc { font-size: 14px; color: #666; margin: 0 0 20px; line-height: 1.5; }
            .mic-permission-btn {
                display: block; width: 100%; padding: 12px;
                border: none; border-radius: 8px;
                font-size: 15px; font-weight: 600;
                cursor: pointer; margin-bottom: 10px;
                transition: all 0.2s;
            }
            .mic-permission-btn-primary { background: #4CAF50; color: #fff; }
            .mic-permission-btn-primary:hover { background: #43a047; }
            .mic-permission-btn-secondary { background: #f5f5f5; color: #666; }
            .mic-permission-btn-secondary:hover { background: #e0e0e0; }
            .mic-permission-alert {
                background: #fff3cd; border: 1px solid #ffc107;
                color: #856404; border-radius: 8px;
                padding: 10px 12px; font-size: 13px;
                margin-bottom: 12px; text-align: left;
            }
        `;
        document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'mic-permission-overlay';
    overlay.innerHTML = `
        <div class="mic-permission-backdrop"></div>
        <div class="mic-permission-modal">
            <div class="mic-permission-icon">🎤</div>
            <h3 class="mic-permission-title">需要麦克风权限</h3>
            <p class="mic-permission-desc">语音对话功能需要使用您的麦克风，请点击下方按钮开启权限。</p>
            <button id="mic-permission-allow" class="mic-permission-btn mic-permission-btn-primary">🎤 开启麦克风权限</button>
            <button id="mic-permission-cancel" class="mic-permission-btn mic-permission-btn-secondary">取消</button>
            <div id="mic-permission-error" style="display:none;"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('mic-permission-allow').addEventListener('click', () => {
        _tryGetMicAndOpenVideo();
    });

    document.getElementById('mic-permission-cancel').addEventListener('click', () => {
        overlay.remove();
        addLog('系统：用户取消了麦克风权限请求', 'system');
    });

    overlay.querySelector('.mic-permission-backdrop').addEventListener('click', () => {
        overlay.remove();
    });
}

function _tryGetMicAndOpenVideo() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
        const overlay = document.getElementById('mic-permission-overlay');
        if (overlay) overlay.remove();
        addLog('系统：麦克风权限已获取', 'system');
        openRobotVideo();
    }).catch(err => {
        console.error('[MicPermission] 获取麦克风权限失败:', err);
        const errorDiv = document.getElementById('mic-permission-error');
        const allowBtn = document.getElementById('mic-permission-allow');
        if (errorDiv) {
            let msg = '麦克风权限请求失败。';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                msg = '⚠️ 麦克风权限已被拒绝。请在浏览器地址栏点击 🔒 图标，将麦克风权限改为"允许"，然后刷新页面重试。';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                msg = '🎤 未检测到麦克风设备，请确保已连接麦克风或耳机。';
            } else if (!window.isSecureContext) {
                msg = '🔒 当前页面不是安全连接（HTTPS/localhost），浏览器不允许使用麦克风。';
            }
            errorDiv.innerHTML = '<div class="mic-permission-alert">' + msg + '</div>';
            errorDiv.style.display = 'block';
        }
        if (allowBtn) {
            allowBtn.textContent = '权限被拒绝，请重试';
            setTimeout(() => {
                if (allowBtn) allowBtn.textContent = '🎤 开启麦克风权限';
            }, 2500);
        }
    });
}

// 切换机器人语音对话状态
function toggleRobotVoiceDialog() {
    // 关闭机器人操作提示后语音导览
    closeRobotActionGuide();

    if (isRobotVoiceDialogActive) {
        // 当前是激活状态，点击则关闭
        closeRobotVoiceDialogFull();
    } else {
        // 当前是关闭状态，先请求麦克风权限
        showMicPermissionPrompt();
    }
}

// 完全关闭机器人语音对话（包括隐藏Unity机器人）
function closeRobotVoiceDialogFull() {
    // 重置语音对话内容（完全重置，清空聊天记录和状态）
    if (window.voiceDialogApp) {
        window.voiceDialogApp.reset();
    }
    
    // 隐藏语音对话面板
    const panel = document.getElementById('voice-dialog-panel');
    if (panel) {
        panel.style.display = 'none';
    }
    
    // 发送消息给Unity重置机器人动画（包含入场动画重置和隐藏机器人）
    sendToServer({
        type: 'robotReset',
        from: 'web',
        time: new Date().toISOString()
    });
    
    // 更新按钮状态
    updateRobotEntryButtonState(false);
    
    // 恢复底层按钮
    showRobotEntryButton();
    const backBtn = document.getElementById('back-home-btn');
    if (backBtn) backBtn.style.display = 'block';
    
    addLog('系统：已关闭机器人语音对话并重置，通知Unity隐藏机器人并重置入场动画', 'system');
    showCenterMessage('机器人语音对话已关闭');
}

// 暂停 Unity WebGL 渲染以释放 GPU 给视频解码
function pauseUnityRender() {
    if (window.unityInstance && window.unityInstance.Module) {
        try {
            if (typeof window.unityInstance.Module.pauseMainLoop === 'function') {
                window.unityInstance.Module.pauseMainLoop();
                console.log('[Unity] 已暂停主循环渲染');
            }
        } catch (e) {
            console.warn('[Unity] 暂停渲染失败:', e);
        }
    }
}

// 恢复 Unity WebGL 渲染
function resumeUnityRender() {
    if (window.unityInstance && window.unityInstance.Module) {
        try {
            if (typeof window.unityInstance.Module.resumeMainLoop === 'function') {
                window.unityInstance.Module.resumeMainLoop();
                console.log('[Unity] 已恢复主循环渲染');
            }
        } catch (e) {
            console.warn('[Unity] 恢复渲染失败:', e);
        }
    }
}

function openRobotVideo() {
    const overlay = document.getElementById('robot-video-overlay');
    const video = document.getElementById('robot-intro-video');
    if (!overlay || !video) return;

    overlay.style.display = 'flex';
    video.currentTime = 0;
    video.preload = 'auto';
    video.playbackRate = 1.0;
    video.controls = true;

    // 关键优化：暂停 Unity 渲染，把 GPU 资源让给视频解码
    pauseUnityRender();

    // 通知 Unity 视频开始播放，以便 Unity 端可降低渲染负载避免卡顿
    sendToServer({
        type: 'videoPlaying',
        state: 'start',
        from: 'web',
        time: new Date().toISOString()
    });

    // 视频播放结束时，触发机器人出场并显示语音对话面板
    video.onended = () => {
        console.log('[Robot] 视频播放结束，触发机器人出场并显示语音对话面板');
        // 发送消息给 Unity 触发机器人出场动画
        sendToServer({
            type: 'playRobotEntrance',
            from: 'web',
            time: new Date().toISOString()
        });
        addLog('系统：视频播放结束，通知 Unity 播放机器人出场动画', 'system');
        // 自动关闭视频播放器
        closeRobotVideo();
        // 显示语音对话面板并更新按钮状态
        showVoiceDialog();
        updateRobotEntryButtonState(true);
        // 显示机器人出现在双桥上语音导览
        showRobotAppearedGuide();
    };

    const playPromise = video.play();
    if (playPromise) {
        playPromise.catch(() => {
            // 自动播放可能被浏览器阻止，用户可手动点击播放
            console.log('视频自动播放被阻止，请手动点击播放');
        });
    }

    addLog('系统：打开机器人介绍视频（已暂停 Unity 渲染）', 'system');
}

function closeRobotVideo() {
    const overlay = document.getElementById('robot-video-overlay');
    const video = document.getElementById('robot-intro-video');
    if (!overlay || !video) return;

    video.pause();
    overlay.style.display = 'none';
    addLog('系统：关闭机器人介绍视频（已恢复 Unity 渲染）', 'system');

    // 关键优化：恢复 Unity 渲染
    resumeUnityRender();

    // 通知 Unity 视频已停止播放，恢复正常渲染
    sendToServer({
        type: 'videoPlaying',
        state: 'stop',
        from: 'web',
        time: new Date().toISOString()
    });

    // 关闭视频后自动打开语音对话窗口
    showVoiceDialog();
    updateRobotEntryButtonState(true);
}

function closeRobotVideoOnBackdrop(event) {
    // 只有点击背景（overlay本身）时才关闭，点击视频或按钮不关闭
    if (event.target === event.currentTarget) {
        closeRobotVideo();
    }
}





function switchUnlockIntroTab(type) {
    if (!isUnlockIntroUnlocked) {
        showCenterMessage('该介绍内容待解锁，请先操控无人机到达桥旁');
        return;
    }

    document.querySelectorAll('.unlock-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.unlock-intro-section').forEach(section => section.classList.remove('active'));

    const tabMap = {
        basic: 'unlock-basic',
        history: 'unlock-history',
        culture: 'unlock-culture',
        structure: 'unlock-structure',
        environment: 'unlock-environment'
    };

    const targetSection = document.getElementById(tabMap[type]);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    const buttons = document.querySelectorAll('.unlock-tab-btn');
    const typeMap = ['basic', 'history', 'culture', 'structure', 'environment'];
    const index = typeMap.indexOf(type);

    if (index >= 0 && buttons[index]) {
        buttons[index].classList.add('active');
    }

    addLog('切换更多历史介绍标签：' + type, 'system');
}

// 消息处理
function applyMissionProgress(progress) {
    taskProgress.viewedModel = !!progress.modelViewed;
    taskProgress.seasonsVisited = {
        spring: false,
        summer: false,
        autumn: false,
        winter: false
    };

    if (Array.isArray(progress.seasonsCompleted)) {
        progress.seasonsCompleted.forEach((season) => {
            const normalized = normalizeSeasonKey(season);
            if (normalized) {
                taskProgress.seasonsVisited[normalized] = true;
            }
        });
    }

    taskProgress.droneUnlocked = !!progress.droneUnlocked;
    updateTaskPanel();

    if (taskProgress.droneUnlocked) {
        showDroneGuide();
    } else {
        hideDroneGuide();
        hideUnlockIntroPanel();
        setUnlockIntroLockedState(false);
    }
}

function sendToServer(data) {
    const payload = {
        ...data,
        time: data.time || new Date().toISOString()
    };

    // 1. 通过 WebSocket 发送（如果已连接）
    if (ws && ws.readyState === WebSocket.OPEN) {
        debugLog('通过 WebSocket 发送消息:', payload);
        ws.send(JSON.stringify(payload));
    }
    
    // 2. 通过 Unity WebGL 发送（如果已就绪）
    if (isUnityReady && unityInstance) {
        debugLog('通过 Unity WebGL 发送消息:', payload);
        try {
            unityInstance.SendMessage('WebGLBridge', 'OnMessageFromWeb', JSON.stringify(payload));
        } catch (e) {
            console.warn('[Unity] 发送消息失败:', e);
        }
    }
    
    // 如果两者都不可用，记录日志
    if ((!ws || ws.readyState !== WebSocket.OPEN) && (!isUnityReady || !unityInstance)) {
        addLog('警告：WebSocket 和 Unity 都未连接，消息仅在本地处理', 'error');
        debugLog('本地消息:', payload);
    }
}

function handleServerMessage(data) {
    if (!data || !data.type) {
        debugLog('收到无效消息:', data);
        return;
    }

    debugLog('处理消息:', data.type, data);

    switch (data.type) {
        case 'log':
            addLog('[Unity] ' + data.data, 'unity');
            break;

        case 'status':
            updateStatus(data.data);
            break;

        case 'modelOpened':
        case 'viewModel':
            addLog('Unity: 模型查看器已响应', 'unity');
            if (data.data === 'true' || data.show === true) {
                showCenterMessage('模型查看器已打开');
            }
            break;

        case 'season':
        case 'seasonChanged':
        case 'season_changed': {
            const seasonName = getSeasonDisplayName(data.data);
            const now = Date.now();

            console.log('[季节调试] 收到季节消息: type=' + data.type + ', data=' + data.data + ', from=' + data.from + ', seasonName=' + seasonName);

            if (lastSeasonReceived.season === seasonName && 
                now - lastSeasonReceived.time < 1000) {
                debugLog('忽略重复的季节消息:', seasonName);
                break;
            }

            lastSeasonReceived = {
                season: seasonName,
                time: now,
                from: data.from
            };

            if (data.from === 'unity') {
                addLog('Unity: 已切换到 ' + seasonName, 'unity');
                showCenterMessage('当前季节：' + seasonName);

                const normalizedKey = normalizeSeasonKey(data.data);
                if (normalizedKey && !taskProgress.seasonsVisited[normalizedKey]) {
                    taskProgress.seasonsVisited[normalizedKey] = true;
                    updateTaskPanel();
                    console.log('[季节调试] 已更新 ' + normalizedKey + ' 进度为已完成');
                }
            }
            break;
        }

        case 'missionProgress':
            applyMissionProgress(data);
            break;

        case 'droneUnlocked':
            debugLog('收到无人机解锁消息');
            taskProgress.droneUnlocked = true;
            updateTaskPanel();
            showDroneGuide();
            addLog('系统：无人机已解锁', 'system');
            showCenterMessage('无人机已解锁，请根据提示开始操作');
            break;

        case 'droneLocked':
            debugLog('收到无人机锁定消息');
            taskProgress.droneUnlocked = false;
            isDroneFlying = false;
            updateTaskPanel();
            hideDroneGuide();

            if (isUnlockIntroUnlocked) {
                hideArrowHint();
            }

            hideUnlockIntroPanel();
            setUnlockIntroLockedState(false);
            addLog('Unity: ' + (data.data || '无人机仍处于锁定状态'), 'unity');
            break;

        case 'droneTakeoff':
        case 'droneFlying':
        case 'droneStart':
        case 'takeoff':
        case 'fly':
            debugLog('收到无人机起飞消息:', data.type);
            console.log('[WinterGuide] WebSocket 收到无人机起飞消息，尝试关闭冬天语音导览');
            isDroneFlying = true;
            addLog('系统：无人机已起飞，继续显示"往前靠近桥可以解锁更多介绍"提示', 'system');

            // 启动无人机时关闭冬天语音导览
            closeWinterGuide();

            if (!isUnlockIntroUnlocked && taskProgress.droneUnlocked && !isDroneGuidePanelManuallyClosed) {
                showArrowHint();
            }
            break;

        case 'droneLand':
        case 'droneStop':
        case 'droneLanded':
        case 'land':
        case 'stop':
            debugLog('收到无人机降落消息:', data.type);
            isDroneFlying = false;
            addLog('系统：无人机已降落', 'system');

            if (!isUnlockIntroUnlocked && taskProgress.droneUnlocked && !isDroneGuidePanelManuallyClosed) {
                showArrowHint();
            }
            break;

        case 'bridgeUnlocked':
        case 'bridgeUnlock':
        case 'unlockBridge':
        case 'reachedBridge':
        case 'atBridge':
        case 'bridge':
            console.log('收到桥旁解锁消息:', data.type, data);
            addLog('🎯 Unity: 无人机已进入 BridgeUnlockZone，解锁更多介绍', 'unity');

            setUnlockIntroLockedState(true);
            hideArrowHint();
            showCenterMessage('🎉 已到达桥旁，更多历史介绍已解锁！');
            showBridgeUnlockGuide();
            break;

        case 'bridgeHover':
        case 'hoverBridge':
        case 'bridgeIntro':
        case 'showBridgeIntro':
        case 'bridgeHighlight': {
            if (!isModelPanelOpen || bridgeIntroPinned) break;

            const bridgeType = normalizeBridgeType(
                data.bridgeType || data.bridge || data.target || data.name || data.data
            );
            currentHoverBridgeType = bridgeType;
            showBridgeIntro(bridgeType, false);
            addLog('Unity: 悬浮桥梁介绍同步 -> ' + bridgeType, 'unity');
            break;
        }

        case 'bridgeClick':
        case 'clickBridge':
        case 'bridgeSelected':
        case 'selectBridge':
        case 'pinBridgeIntro':
        case 'lockBridgeIntro': {
            if (!isModelPanelOpen) break;

            const bridgeType = normalizeBridgeType(
                data.bridgeType || data.bridge || data.target || data.name || data.data
            );
            pinBridgeIntro(bridgeType);
            addLog('Unity: 点击桥梁，切换并固定介绍 -> ' + bridgeType, 'unity');
            break;
        }

        case 'bridgeHoverExit':
        case 'hideBridgeIntro':
        case 'bridgeLeave': {
            if (!isModelPanelOpen || bridgeIntroPinned) break;

            currentHoverBridgeType = '';
            hideBridgeIntro();
            addLog('Unity: 鼠标离开桥梁，隐藏介绍面板', 'unity');
            break;
        }

        case 'robotAppeared':
        case 'robotEntranceCompleted':
            debugLog('Unity机器人已出现，隐藏位置提示');
            hideRobotLocationHint();
            showCenterMessage('🤖 机器人已出现在世德桥上！');
            break;

        case 'pong':
            debugLog('收到 pong');
            break;

        case 'heartbeat':
            debugLog('收到心跳:', data);
            break;

        default:
            debugLog('收到未处理消息类型:', data.type);
            addLog('收到消息：' + data.type + ' ' + (data.data || ''), 'system');
            break;
    }
}

// 其他功能函数
function showWelcomeHint() {
    const hint = document.getElementById('welcome-hint');
    if (hint) {
        hint.style.display = 'block';
        hint.classList.remove('hide');
    }
}

function hideWelcomeHint() {
    const hint = document.getElementById('welcome-hint');
    if (hint) {
        hint.classList.add('hide');
    }
}

function sendCommand() {
    hideWelcomeHint();
    const input = document.getElementById('cmd-input');
    if (!input) return;

    const value = input.value.trim();
    if (!value) return;

    sendToServer({
        type: 'command',
        data: value,
        from: 'web'
    });

    addLog('发送指令：' + value, 'web');
    showCenterMessage('指令：' + value);
    input.value = '';
}

function viewModel(event) {
    hideWelcomeHint();
    closeVoiceGuide();
    isModelPanelOpen = !isModelPanelOpen;
    const btn = document.getElementById('btn-view-model');

    if (btn) {
        btn.classList.toggle('active', isModelPanelOpen);
    }

    if (isModelPanelOpen && !taskProgress.viewedModel) {
        taskProgress.viewedModel = true;
        updateTaskPanel();
    }

    sendToServer({
        type: 'viewModel',
        show: isModelPanelOpen,
        data: isModelPanelOpen ? 'true' : 'false',
        from: 'web'
    });

    if (isModelPanelOpen) {
        clearBridgeIntroPin();
        hideBridgeIntro(true);
        showModelHoverTip();
        bindModelIntroShield();
        // 关闭其他语音导览
        closeSeasonGuide();
        closeAutumnGuide();
        closeWinterGuide();
        // 显示查看模型及介绍语音导览
        showModelGuide();
    } else {
        clearBridgeIntroPin();
        hideBridgeIntro(true);
        hideModelHoverTip();
        // 关闭查看模型及介绍语音导览
        closeModelGuide();
        // 关闭秋天语音导览
        closeAutumnGuide();
        // 关闭冬天语音导览
        closeWinterGuide();
        // 显示四季引导语音导览
        showSeasonGuide();
    }

    addLog(isModelPanelOpen ? '发送：打开模型面板' : '发送：关闭模型面板', 'web');
    showCenterMessage(isModelPanelOpen ? '模型面板已打开' : '模型面板已关闭');
}

function changeSeason(season, event) {
    hideWelcomeHint();

    const normalized = normalizeSeasonKey(season);

    // 点击春按钮时关闭四季引导语音导览
    if (normalized === 'spring') {
        closeSeasonGuide();
    }

    // 点击秋按钮时显示秋天语音导览
    if (normalized === 'autumn') {
        showAutumnGuide();
    }

    // 点击冬按钮时关闭秋天语音导览，显示冬天语音导览
    if (normalized === 'winter') {
        console.log('[WinterGuide] 点击冬按钮，准备显示冬天语音导览');
        closeAutumnGuide();
        showWinterGuide();
    }

    console.log('[季节调试] 点击季节按钮: ' + season, event);
    console.log('[季节调试] 标准化结果: ' + normalized);

    if (!normalized) {
        addLog('错误：无法识别的季节值 ' + season, 'error');
        console.error('[季节调试] 标准化失败: ' + season);
        return;
    }

    document.querySelectorAll('#bottom-controls .control-btn').forEach(btn => {
        if (!btn.classList.contains('extra-control-btn')) {
            btn.classList.remove('active');
        }
    });

    if (event && event.target) {
        let targetBtn = event.target;
        while (targetBtn && !targetBtn.classList.contains('control-btn') && targetBtn !== document.body) {
            targetBtn = targetBtn.parentElement;
        }

        if (targetBtn && targetBtn.classList.contains('control-btn')) {
            targetBtn.classList.add('active');
            console.log('[季节调试] 已激活按钮:' + targetBtn.textContent);
        } else {
            event.target.classList.add('active');
        }
    }

    console.log('[季节调试] 准备发送季节消息: ' + normalized);

    if (taskProgress.seasonsVisited[normalized] !== true) {
        taskProgress.seasonsVisited[normalized] = true;
        console.log('[季节调试] 本地更新季节进度: ' + normalized + ' = true');
        updateTaskPanel();
    }

    sendToServer({
        type: 'season',
        data: normalized,
        season: normalized,
        from: 'web'
    });

    addLog('发送：切换季节 - ' + getSeasonDisplayName(normalized), 'web');
    showCenterMessage('切换到 ' + getSeasonDisplayName(normalized) + ' 季');
}

function toggleHistory() {
    const panel = document.getElementById('history-panel');
    if (!panel) return;

    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function updateStatus(data) {
    if (!data) return;

    let statusData = data;
    if (typeof data === 'string') {
        try {
            statusData = JSON.parse(data);
        } catch (e) {
            return;
        }
    }

}

function addLog(msg, type) {
    const area = document.getElementById('log-area');
    if (!area) return;

    const item = document.createElement('div');
    item.className = 'log-item ' + type;
    item.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    area.appendChild(item);
    area.scrollTop = area.scrollHeight;
}

function showCenterMessage(text) {
    const msg = document.getElementById('center-message');
    if (!msg) return;

    msg.textContent = text;
    msg.classList.add('show');

    setTimeout(() => {
        msg.classList.remove('show');
    }, 3000);
}

// ==================== 鼠标点击涟漪特效 ====================
function createRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    
    // 主涟漪环
    const inner = document.createElement('div');
    inner.className = 'ripple-inner';
    ripple.appendChild(inner);
    
    // 外圈波纹
    const wave = document.createElement('div');
    wave.className = 'ripple-wave';
    ripple.appendChild(wave);
    
    document.body.appendChild(ripple);
    
    // 动画结束后移除元素
    setTimeout(() => {
        ripple.remove();
    }, 800);
}

// ==================== 鼠标点击船特效 ====================
function createBoat(x, y) {
    const boat = document.createElement('div');
    boat.className = 'click-boat';
    boat.style.left = x + 'px';
    boat.style.top = y + 'px';
    
    const img = document.createElement('img');
    img.src = '船.png';
    img.alt = '船';
    boat.appendChild(img);
    
    document.body.appendChild(boat);
    
    // 0.6秒后开始淡出
    setTimeout(() => {
        boat.classList.add('fade-out');
    }, 600);
    
    // 动画结束后移除元素
    setTimeout(() => {
        boat.remove();
    }, 1100);
}

// ============================= 语音导览 =============================
const VOICE_GUIDE_TEXT = '哈喽哈喽！我是你的古桥小向导沧朔～欢迎来到苏州双桥！右上角可以查看模型介绍，还能切换四季，完成右上角任务后即可解锁无人机哦！并且还能点击截图按钮一键截图，把喜欢的画面传到文创商品店，直接印到商品上。现在你可以等待Unity加载成功后开始点击右上方的查看模型及介绍面板哦！';

let voiceGuideAudio = null;
let voiceGuideTypeInterval = null;
let isVoiceGuidePlaying = false;

function initVoiceGuide() {
    voiceGuideAudio = document.getElementById('voice-guide-audio');
}

function showVoiceGuide() {
    const panel = document.getElementById('voice-guide-panel');
    const textEl = document.getElementById('voice-guide-text');
    if (!panel || !textEl) return;

    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('show'), 10);

    isVoiceGuidePlaying = true;

    // 播放音频
    if (voiceGuideAudio) {
        voiceGuideAudio.currentTime = 0;
        const playPromise = voiceGuideAudio.play();
        if (playPromise) {
            playPromise.catch(err => {
                console.log('[VoiceGuide] 音频自动播放被阻止，等待用户交互:', err && err.message);
            });
        }
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    if (voiceGuideTypeInterval) clearInterval(voiceGuideTypeInterval);
    voiceGuideTypeInterval = setInterval(() => {
        if (!isVoiceGuidePlaying) {
            clearInterval(voiceGuideTypeInterval);
            return;
        }
        textEl.textContent += VOICE_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= VOICE_GUIDE_TEXT.length) {
            clearInterval(voiceGuideTypeInterval);
            textEl.classList.remove('typing');
        }
    }, speed);

    addLog('系统：语音导览已开始', 'system');
}

function closeVoiceGuide() {
    const panel = document.getElementById('voice-guide-panel');
    const textEl = document.getElementById('voice-guide-text');
    if (!panel) return;

    isVoiceGuidePlaying = false;

    if (voiceGuideTypeInterval) {
        clearInterval(voiceGuideTypeInterval);
        voiceGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    if (voiceGuideAudio) {
        voiceGuideAudio.pause();
        voiceGuideAudio.currentTime = 0;
    }

    panel.classList.remove('show');
    setTimeout(() => {
        panel.style.display = 'none';
    }, 400);

    addLog('系统：语音导览已关闭', 'system');
}

// ============================= 查看模型及介绍语音导览 =============================
const MODEL_GUIDE_TEXT = '现在你可以把鼠标移到桥上轻轻一点，左边就会跳出详细介绍，还能360度旋转查看，连桥底的青苔石缝都清清楚楚哦～眼前这座双桥啊，始建于明万历年间，一横一竖的\'钥匙桥\'造型可是咱们中国造桥史上的绝妙一笔！横的是圆拱桥，竖的是方拱桥，圆中带方，正应了苏州人\'外圆内方\'的处世智慧。四百多年来，陈逸飞先生的一幅《故乡的回忆》，更让这双桥成为了江南文化走向世界的名片呢！';

let modelGuideAudio = null;
let modelGuideTypeInterval = null;
let isModelGuidePlaying = false;

function initModelGuide() {
    modelGuideAudio = document.getElementById('model-guide-audio');
}

function showModelGuide() {
    const panel = document.getElementById('model-guide-panel');
    const textEl = document.getElementById('model-guide-text');
    if (!panel || !textEl) return;

    // 关闭进入场景的语音导览（如果还在显示）
    closeVoiceGuide();

    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('show'), 10);

    isModelGuidePlaying = true;

    // 播放音频
    if (modelGuideAudio) {
        modelGuideAudio.currentTime = 0;
        const playPromise = modelGuideAudio.play();
        if (playPromise) {
            playPromise.catch(err => {
                console.log('[ModelGuide] 音频自动播放被阻止，等待用户交互:', err && err.message);
            });
        }
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    if (modelGuideTypeInterval) clearInterval(modelGuideTypeInterval);
    modelGuideTypeInterval = setInterval(() => {
        if (!isModelGuidePlaying) {
            clearInterval(modelGuideTypeInterval);
            return;
        }
        textEl.textContent += MODEL_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= MODEL_GUIDE_TEXT.length) {
            clearInterval(modelGuideTypeInterval);
            textEl.classList.remove('typing');
        }
    }, speed);

    addLog('系统：查看模型及介绍语音导览已开始', 'system');
}

function closeModelGuide() {
    const panel = document.getElementById('model-guide-panel');
    const textEl = document.getElementById('model-guide-text');
    if (!panel) return;

    isModelGuidePlaying = false;

    if (modelGuideTypeInterval) {
        clearInterval(modelGuideTypeInterval);
        modelGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    if (modelGuideAudio) {
        modelGuideAudio.pause();
        modelGuideAudio.currentTime = 0;
    }

    panel.classList.remove('show');
    setTimeout(() => {
        panel.style.display = 'none';
    }, 400);

    addLog('系统：查看模型及介绍语音导览已关闭', 'system');
}

// ============================= 四季引导语音导览 =============================
const SEASON_GUIDE_TEXT = '桥的故事先看到这儿～现在可以点点右上角的\'春夏秋冬\'，带你看看双桥在四季里的不同模样。';

let seasonGuideAudio = null;
let seasonGuideTypeInterval = null;
let isSeasonGuidePlaying = false;
let hasShownSeasonGuide = false;

function initSeasonGuide() {
    seasonGuideAudio = document.getElementById('season-guide-audio');
}

function showSeasonGuide() {
    if (hasShownSeasonGuide) return;
    hasShownSeasonGuide = true;

    const panel = document.getElementById('season-guide-panel');
    const textEl = document.getElementById('season-guide-text');
    if (!panel || !textEl) return;

    // 关闭其他语音导览
    closeVoiceGuide();
    closeModelGuide();

    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('show'), 10);

    isSeasonGuidePlaying = true;

    // 播放音频
    if (seasonGuideAudio) {
        seasonGuideAudio.currentTime = 0;
        const playPromise = seasonGuideAudio.play();
        if (playPromise) {
            playPromise.catch(err => {
                console.log('[SeasonGuide] 音频自动播放被阻止，等待用户交互:', err && err.message);
            });
        }
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    if (seasonGuideTypeInterval) clearInterval(seasonGuideTypeInterval);
    seasonGuideTypeInterval = setInterval(() => {
        if (!isSeasonGuidePlaying) {
            clearInterval(seasonGuideTypeInterval);
            return;
        }
        textEl.textContent += SEASON_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= SEASON_GUIDE_TEXT.length) {
            clearInterval(seasonGuideTypeInterval);
            textEl.classList.remove('typing');
        }
    }, speed);

    addLog('系统：四季引导语音导览已开始', 'system');
}

function closeSeasonGuide() {
    const panel = document.getElementById('season-guide-panel');
    const textEl = document.getElementById('season-guide-text');
    if (!panel) return;

    isSeasonGuidePlaying = false;

    if (seasonGuideTypeInterval) {
        clearInterval(seasonGuideTypeInterval);
        seasonGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    if (seasonGuideAudio) {
        seasonGuideAudio.pause();
        seasonGuideAudio.currentTime = 0;
    }

    panel.classList.remove('show');
    setTimeout(() => {
        panel.style.display = 'none';
    }, 400);

    addLog('系统：四季引导语音导览已关闭', 'system');
}

// ============================= 秋天语音导览 =============================
const AUTUMN_GUIDE_TEXT = '呼——秋风起啦！你看桥边的树叶悄悄换上了金黄衣裳，天空也收起了蓝裙子，裹上一层柔柔的薄云，像给双桥盖了床轻纱被。这时候的江南啊，连空气里都飘着桂花的甜香呢！';

let autumnGuideAudio = null;
let autumnGuideTypeInterval = null;
let isAutumnGuidePlaying = false;

function initAutumnGuide() {
    autumnGuideAudio = document.getElementById('autumn-guide-audio');
}

function showAutumnGuide() {
    const panel = document.getElementById('autumn-guide-panel');
    const textEl = document.getElementById('autumn-guide-text');
    if (!panel || !textEl) return;

    // 关闭其他语音导览
    closeVoiceGuide();
    closeModelGuide();
    closeSeasonGuide();

    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('show'), 10);

    isAutumnGuidePlaying = true;

    // 播放音频
    if (autumnGuideAudio) {
        autumnGuideAudio.currentTime = 0;
        const playPromise = autumnGuideAudio.play();
        if (playPromise) {
            playPromise.catch(err => {
                console.log('[AutumnGuide] 音频自动播放被阻止，等待用户交互:', err && err.message);
            });
        }
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    if (autumnGuideTypeInterval) clearInterval(autumnGuideTypeInterval);
    autumnGuideTypeInterval = setInterval(() => {
        if (!isAutumnGuidePlaying) {
            clearInterval(autumnGuideTypeInterval);
            return;
        }
        textEl.textContent += AUTUMN_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= AUTUMN_GUIDE_TEXT.length) {
            clearInterval(autumnGuideTypeInterval);
            textEl.classList.remove('typing');
        }
    }, speed);

    addLog('系统：秋天语音导览已开始', 'system');
}

function closeAutumnGuide() {
    const panel = document.getElementById('autumn-guide-panel');
    const textEl = document.getElementById('autumn-guide-text');
    if (!panel) return;

    isAutumnGuidePlaying = false;

    if (autumnGuideTypeInterval) {
        clearInterval(autumnGuideTypeInterval);
        autumnGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    if (autumnGuideAudio) {
        autumnGuideAudio.pause();
        autumnGuideAudio.currentTime = 0;
    }

    panel.classList.remove('show');
    setTimeout(() => {
        panel.style.display = 'none';
    }, 400);

    addLog('系统：秋天语音导览已关闭', 'system');
}

// ============================= 冬天语音导览 =============================
const WINTER_GUIDE_TEXT = '无人机解锁成功啦！快看看弹出来的操作指南，WASD控制飞行，带你从空中重新认识双桥～对了，还有好几段历史故事没解锁呢，飞得越远，秘密揭晓越多，快向前靠近古桥去当一回空中探险家吧！';

let winterGuideAudio = null;
let winterGuideTypeInterval = null;
let isWinterGuidePlaying = false;
let winterGuideHideTimeout = null;

function initWinterGuide() {
    // winterGuideAudio 现在由 showWinterGuide() 动态创建，不再需要初始化 HTML audio 元素
}

function showWinterGuide() {
    const panel = document.getElementById('winter-guide-panel');
    const textEl = document.getElementById('winter-guide-text');
    if (!panel || !textEl) {
        console.error('[WinterGuide] 面板元素不存在，无法显示');
        return;
    }

    console.log('[WinterGuide] ===== showWinterGuide() 开始 =====');

    // 【关键修复】清除任何遗留的隐藏定时器，防止 setTimeout 把刚显示的面板又隐藏掉
    if (winterGuideHideTimeout) {
        clearTimeout(winterGuideHideTimeout);
        winterGuideHideTimeout = null;
        console.log('[WinterGuide] 已清除遗留的隐藏定时器');
    }

    // 关闭其他语音导览
    closeVoiceGuide();
    closeModelGuide();
    closeSeasonGuide();
    closeAutumnGuide();

    // 重置自身状态
    isWinterGuidePlaying = false;
    if (winterGuideTypeInterval) {
        clearInterval(winterGuideTypeInterval);
        winterGuideTypeInterval = null;
    }
    if (winterGuideAudio) {
        winterGuideAudio.pause();
        winterGuideAudio = null;
    }

    // 重置面板状态并立即显示
    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.classList.remove('show');
    panel.style.display = 'block';
    // 强制浏览器重绘，确保 display:block 生效后再添加 show class
    void panel.offsetWidth;
    panel.classList.add('show');

    isWinterGuidePlaying = true;

    // 播放音频
    winterGuideAudio = new Audio('/robot-voice/点击冬天.mp3');
    const playPromise = winterGuideAudio.play();
    if (playPromise) {
        playPromise.then(() => {
            console.log('[WinterGuide] 音频开始播放');
        }).catch(err => {
            console.log('[WinterGuide] 音频自动播放被阻止:', err && err.message);
        });
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    winterGuideTypeInterval = setInterval(() => {
        if (!isWinterGuidePlaying) {
            clearInterval(winterGuideTypeInterval);
            winterGuideTypeInterval = null;
            return;
        }
        textEl.textContent += WINTER_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= WINTER_GUIDE_TEXT.length) {
            clearInterval(winterGuideTypeInterval);
            winterGuideTypeInterval = null;
            textEl.classList.remove('typing');
        }
    }, speed);

    console.log('[WinterGuide] ===== showWinterGuide() 完成，面板已显示 =====');
    addLog('系统：冬天语音导览已开始', 'system');
}

function closeWinterGuide() {
    const panel = document.getElementById('winter-guide-panel');
    const textEl = document.getElementById('winter-guide-text');

    console.log('[WinterGuide] closeWinterGuide() 被调用');

    isWinterGuidePlaying = false;

    if (winterGuideTypeInterval) {
        clearInterval(winterGuideTypeInterval);
        winterGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    // 彻底停止并丢弃音频对象
    if (winterGuideAudio) {
        winterGuideAudio.pause();
        winterGuideAudio.src = '';
        winterGuideAudio.load();
        winterGuideAudio = null;
    }

    if (panel) {
        panel.classList.remove('show');
        // 【关键修复】记录定时器 ID，方便 showWinterGuide() 在需要时清除
        winterGuideHideTimeout = setTimeout(() => {
            if (panel) panel.style.display = 'none';
            winterGuideHideTimeout = null;
        }, 400);
    }

    console.log('[WinterGuide] 冬天语音导览已关闭');
    addLog('系统：冬天语音导览已关闭', 'system');
}

// ============================= 靠近古桥彩蛋语音导览 =============================
const BRIDGE_UNLOCK_GUIDE_TEXT = '恭喜你已经解锁隐藏彩蛋：更多历史故事和机器人语音对话功能悄悄打开了哦～知道吗？这双桥啊，原名\'永安桥\'和\'太平桥\'，一圆一方，圆的是满月团圆，方的是天下太平，古人把最好的祝福都砌进桥洞里啦！';

let bridgeUnlockGuideAudio = null;
let bridgeUnlockGuideTypeInterval = null;
let isBridgeUnlockGuidePlaying = false;
let hasShownBridgeUnlockGuide = false;

function initBridgeUnlockGuide() {
    // 音频由 showBridgeUnlockGuide() 动态创建
}

function showBridgeUnlockGuide() {
    if (hasShownBridgeUnlockGuide) return;
    hasShownBridgeUnlockGuide = true;

    const panel = document.getElementById('bridge-unlock-guide-panel');
    const textEl = document.getElementById('bridge-unlock-guide-text');
    if (!panel || !textEl) return;

    // 关闭其他语音导览
    closeVoiceGuide();
    closeModelGuide();
    closeSeasonGuide();
    closeAutumnGuide();
    closeWinterGuide();

    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('show'), 10);

    isBridgeUnlockGuidePlaying = true;

    // 播放音频
    bridgeUnlockGuideAudio = new Audio('/robot-voice/靠近古桥.mp3');
    const playPromise = bridgeUnlockGuideAudio.play();
    if (playPromise) {
        playPromise.then(() => {
            console.log('[BridgeUnlockGuide] 音频开始播放');
        }).catch(err => {
            console.log('[BridgeUnlockGuide] 音频自动播放被阻止:', err && err.message);
        });
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    if (bridgeUnlockGuideTypeInterval) clearInterval(bridgeUnlockGuideTypeInterval);
    bridgeUnlockGuideTypeInterval = setInterval(() => {
        if (!isBridgeUnlockGuidePlaying) {
            clearInterval(bridgeUnlockGuideTypeInterval);
            bridgeUnlockGuideTypeInterval = null;
            return;
        }
        textEl.textContent += BRIDGE_UNLOCK_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= BRIDGE_UNLOCK_GUIDE_TEXT.length) {
            clearInterval(bridgeUnlockGuideTypeInterval);
            bridgeUnlockGuideTypeInterval = null;
            textEl.classList.remove('typing');
        }
    }, speed);

    addLog('系统：靠近古桥彩蛋语音导览已开始', 'system');
}

function closeBridgeUnlockGuide() {
    const panel = document.getElementById('bridge-unlock-guide-panel');
    const textEl = document.getElementById('bridge-unlock-guide-text');
    if (!panel) return;

    isBridgeUnlockGuidePlaying = false;

    if (bridgeUnlockGuideTypeInterval) {
        clearInterval(bridgeUnlockGuideTypeInterval);
        bridgeUnlockGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    if (bridgeUnlockGuideAudio) {
        bridgeUnlockGuideAudio.pause();
        bridgeUnlockGuideAudio.src = '';
        bridgeUnlockGuideAudio.load();
        bridgeUnlockGuideAudio = null;
    }

    panel.classList.remove('show');
    setTimeout(() => {
        panel.style.display = 'none';
    }, 400);

    addLog('系统：靠近古桥彩蛋语音导览已关闭', 'system');
}

// ============================= 机器人操作提示后语音导览 =============================
const ROBOT_ACTION_GUIDE_TEXT = '好了，现在你可以调整左上角无人机音效和背景音乐的音量，点击右下角的进入机器人语音对话按钮，我就终于可以真正现身，从声音变成实体来到你身边啦！';

let robotActionGuideAudio = null;
let robotActionGuideTypeInterval = null;
let isRobotActionGuidePlaying = false;
let hasShownRobotActionGuide = false;

function initRobotActionGuide() {
    // 音频由 showRobotActionGuide() 动态创建
}

function showRobotActionGuide() {
    if (hasShownRobotActionGuide) return;
    hasShownRobotActionGuide = true;

    const panel = document.getElementById('robot-action-guide-panel');
    const textEl = document.getElementById('robot-action-guide-text');
    if (!panel || !textEl) return;

    // 关闭其他语音导览
    closeVoiceGuide();
    closeModelGuide();
    closeSeasonGuide();
    closeAutumnGuide();
    closeWinterGuide();
    closeBridgeUnlockGuide();

    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('show'), 10);

    isRobotActionGuidePlaying = true;

    // 播放音频
    robotActionGuideAudio = new Audio('/robot-voice/点击最后一个确定.mp3');
    const playPromise = robotActionGuideAudio.play();
    if (playPromise) {
        playPromise.then(() => {
            console.log('[RobotActionGuide] 音频开始播放');
        }).catch(err => {
            console.log('[RobotActionGuide] 音频自动播放被阻止:', err && err.message);
        });
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    if (robotActionGuideTypeInterval) clearInterval(robotActionGuideTypeInterval);
    robotActionGuideTypeInterval = setInterval(() => {
        if (!isRobotActionGuidePlaying) {
            clearInterval(robotActionGuideTypeInterval);
            robotActionGuideTypeInterval = null;
            return;
        }
        textEl.textContent += ROBOT_ACTION_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= ROBOT_ACTION_GUIDE_TEXT.length) {
            clearInterval(robotActionGuideTypeInterval);
            robotActionGuideTypeInterval = null;
            textEl.classList.remove('typing');
        }
    }, speed);

    addLog('系统：机器人操作提示后语音导览已开始', 'system');
}

function closeRobotActionGuide() {
    const panel = document.getElementById('robot-action-guide-panel');
    const textEl = document.getElementById('robot-action-guide-text');
    if (!panel) return;

    isRobotActionGuidePlaying = false;

    if (robotActionGuideTypeInterval) {
        clearInterval(robotActionGuideTypeInterval);
        robotActionGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    if (robotActionGuideAudio) {
        robotActionGuideAudio.pause();
        robotActionGuideAudio.src = '';
        robotActionGuideAudio.load();
        robotActionGuideAudio = null;
    }

    panel.classList.remove('show');
    setTimeout(() => {
        panel.style.display = 'none';
    }, 400);

    addLog('系统：机器人操作提示后语音导览已关闭', 'system');
}

// ============================= 机器人出现在双桥上语音导览 =============================
const ROBOT_APPEARED_GUIDE_TEXT = '终于看到你了，现在我就站在双桥上，你可以跟我对话哦！';

let robotAppearedGuideAudio = null;
let robotAppearedGuideTypeInterval = null;
let isRobotAppearedGuidePlaying = false;
let hasShownRobotAppearedGuide = false;

function initRobotAppearedGuide() {
    // 音频由 showRobotAppearedGuide() 动态创建
}

function showRobotAppearedGuide() {
    if (hasShownRobotAppearedGuide) return;
    hasShownRobotAppearedGuide = true;

    const panel = document.getElementById('robot-appeared-guide-panel');
    const textEl = document.getElementById('robot-appeared-guide-text');
    if (!panel || !textEl) return;

    // 关闭其他语音导览
    closeVoiceGuide();
    closeModelGuide();
    closeSeasonGuide();
    closeAutumnGuide();
    closeWinterGuide();
    closeBridgeUnlockGuide();
    closeRobotActionGuide();

    textEl.textContent = '';
    textEl.classList.add('typing');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('show'), 10);

    isRobotAppearedGuidePlaying = true;

    // 播放音频
    robotAppearedGuideAudio = new Audio('/robot-voice/机器人出现在双桥上.mp3');
    const playPromise = robotAppearedGuideAudio.play();
    if (playPromise) {
        playPromise.then(() => {
            console.log('[RobotAppearedGuide] 音频开始播放');
        }).catch(err => {
            console.log('[RobotAppearedGuide] 音频自动播放被阻止:', err && err.message);
        });
    }

    // 打字机效果
    let index = 0;
    const speed = 80; // 每字间隔 ms
    if (robotAppearedGuideTypeInterval) clearInterval(robotAppearedGuideTypeInterval);
    robotAppearedGuideTypeInterval = setInterval(() => {
        if (!isRobotAppearedGuidePlaying) {
            clearInterval(robotAppearedGuideTypeInterval);
            robotAppearedGuideTypeInterval = null;
            return;
        }
        textEl.textContent += ROBOT_APPEARED_GUIDE_TEXT.charAt(index);
        index++;
        if (index >= ROBOT_APPEARED_GUIDE_TEXT.length) {
            clearInterval(robotAppearedGuideTypeInterval);
            robotAppearedGuideTypeInterval = null;
            textEl.classList.remove('typing');
        }
    }, speed);

    addLog('系统：机器人出现在双桥上语音导览已开始', 'system');
}

function closeRobotAppearedGuide() {
    const panel = document.getElementById('robot-appeared-guide-panel');
    const textEl = document.getElementById('robot-appeared-guide-text');
    if (!panel) return;

    isRobotAppearedGuidePlaying = false;

    if (robotAppearedGuideTypeInterval) {
        clearInterval(robotAppearedGuideTypeInterval);
        robotAppearedGuideTypeInterval = null;
    }

    if (textEl) {
        textEl.classList.remove('typing');
    }

    if (robotAppearedGuideAudio) {
        robotAppearedGuideAudio.pause();
        robotAppearedGuideAudio.src = '';
        robotAppearedGuideAudio.load();
        robotAppearedGuideAudio = null;
    }

    panel.classList.remove('show');
    setTimeout(() => {
        panel.style.display = 'none';
    }, 400);

    addLog('系统：机器人出现在双桥上语音导览已关闭', 'system');
}

// 页面初始化
window.onload = () => {
    debugLog('页面加载完成，初始化中...');
    resetTaskPanelUI(false);
    connectWebSocket();
    hideBridgeIntro(true);
    hideModelHoverTip();
    bindModelIntroShield();
    initDraggablePanels();

    // 初始化音量控制台
    updateDroneAudioControlUI();
    updateBgmAudioControlUI();
    initBgmAudio();
    positionDroneAudioControl();
    // 发送初始音量到 Unity（连接建立后延迟发送，确保 ws 已 open）
    setTimeout(() => {
        sendToServer({
            type: 'droneVolume',
            volume: droneAudioMuted ? 0 : droneAudioVolume,
            from: 'web',
            time: new Date().toISOString()
        });
        sendToServer({
            type: 'bgmVolume',
            volume: bgmAudioMuted ? 0 : bgmAudioVolume,
            from: 'web',
            time: new Date().toISOString()
        });
    }, 800);

    const input = document.getElementById('cmd-input');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendCommand();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 't' || e.key === 'T') {
            debugLog('手动测试解锁');
            setUnlockIntroLockedState(true);
        }
    });

    // 【关键修复】捕获阶段监听空格键，确保即使 Unity WebGL 捕获了键盘事件也能触发
    // 用于关闭冬天语音导览（无人机起飞时的备用方案）
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return; // 忽略按住不放时的重复触发
        if (e.key === ' ' || e.key === 'Spacebar') {
            console.log('[WinterGuide] 捕获到空格键，关闭冬天语音导览');
            closeWinterGuide();
        }
    }, true);
    
    // 绑定鼠标点击效果（涟漪+船）
    document.addEventListener('click', (e) => {
        createRipple(e.clientX, e.clientY);
        createBoat(e.clientX, e.clientY);
    });

    // 初始化并显示语音导览（延迟一点确保音频元素就绪）
    initVoiceGuide();
    initModelGuide();
    initSeasonGuide();
    initAutumnGuide();
    initWinterGuide();
    initBridgeUnlockGuide();
    initRobotActionGuide();
    initRobotAppearedGuide();
    setTimeout(() => {
        showVoiceGuide();
    }, 600);
};

window.addEventListener('resize', () => {
    positionDroneAudioControl();
});

window.addEventListener('beforeunload', () => {
    isPageUnloading = true;

    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'resetMissionProgress',
                from: 'web',
                time: new Date().toISOString()
            }));
        }
    } catch (e) {
        console.warn('beforeunload 发送 reset 失败:', e);
    }

    try {
        if (ws) ws.close();
    } catch (e) {
        console.warn('关闭 ws 失败:', e);
    }
});

// 模型介绍面板
function switchModelIntroTab(type) {
    const normalizedType = normalizeBridgeType(type);

    const shideTab = document.getElementById('tab-shide');
    const yonganTab = document.getElementById('tab-yongan');
    const shideContent = document.getElementById('intro-shide');
    const yonganContent = document.getElementById('intro-yongan');

    if (!shideTab || !yonganTab || !shideContent || !yonganContent) return;

    shideTab.classList.remove('active');
    yonganTab.classList.remove('active');
    shideContent.classList.remove('active');
    yonganContent.classList.remove('active');

    if (normalizedType === 'yongan') {
        yonganTab.classList.add('active');
        yonganContent.classList.add('active');
    } else {
        shideTab.classList.add('active');
        shideContent.classList.add('active');
    }
}

function showBridgeIntro(type, pinned = false) {
    if (!isModelPanelOpen) return;

    switchModelIntroTab(type);
    const panel = document.getElementById('model-intro-panel');
    if (!panel) return;

    panel.style.display = 'block';
    panel.classList.add('highlight');
    panel.classList.toggle('intro-pinned', pinned);

    setTimeout(() => {
        panel.classList.remove('highlight');
    }, 1500);

    updateModelIntroPinnedUI();
}

function hideBridgeIntro(force = false) {
    const panel = document.getElementById('model-intro-panel');
    if (!panel) return;

    if (bridgeIntroPinned && !force) return;

    panel.style.display = 'none';
    panel.classList.remove('highlight', 'intro-pinned');
}

// ============================= 语音对话面板控制 =============================

let voiceDialogApp = null;

function showVoiceDialog() {
    const panel = document.getElementById('voice-dialog-panel');
    if (!panel) {
        console.error('语音对话面板不存在');
        return;
    }
    
    panel.style.display = 'block';
    addLog('系统：语音对话面板已显示', 'system');
    showCenterMessage('🎤 请点击"开始对话"与机器人交流');
    
    // 语音面板显示时隐藏底层按钮，避免右下角重叠
    hideRobotEntryButton();
    const backBtn = document.getElementById('back-home-btn');
    if (backBtn) backBtn.style.display = 'none';
    
    // 初始化语音对话应用
    if (!voiceDialogApp && typeof VoiceDialogApp !== 'undefined') {
        initVoiceDialog();
    }
}

function closeVoiceDialog() {
    const panel = document.getElementById('voice-dialog-panel');
    if (!panel) return;
    
    panel.style.display = 'none';
    addLog('系统：语音对话面板已关闭', 'system');
    
    // 语音面板关闭后恢复底层按钮
    showRobotEntryButton();
    const backBtn = document.getElementById('back-home-btn');
    if (backBtn) backBtn.style.display = 'block';
}

// 初始化语音对话（由 voice-dialog.js 模块接管）
function initVoiceDialog() {
    // 不再预先创建实例，由 showVoiceDialog 在首次显示时自动初始化
    console.log('[VoiceDialog] 等待 voice-dialog.js 模块加载...');
}

// ============================= 语音对话面板控制 =============================
// 注意：完整的语音对话功能在 voice-dialog.js 模块中定义
// 以下函数作为占位符，实际功能由模块提供

if (typeof showVoiceDialog !== 'function') {
    window.showVoiceDialog = function() {
        console.log('[VoiceDialog] 等待语音对话模块加载...');
        const panel = document.getElementById('voice-dialog-panel');
        if (panel) {
            panel.style.display = 'block';
            addLog('系统：语音对话面板已显示', 'system');
        } else {
            console.error('语音对话面板不存在');
        }
    };
}

if (typeof closeVoiceDialog !== 'function') {
    window.closeVoiceDialog = function() {
        const panel = document.getElementById('voice-dialog-panel');
        if (panel) {
            panel.style.display = 'none';
            addLog('系统：语音对话面板已关闭', 'system');
        }
    };
}

// ============================= Unity WebGL 集成 =============================

let unityInstance = null;
let isUnityReady = false;

// 接收 Unity 发送的消息（由 JavaScript 插件调用）
window.unityMessageReceiver = function(message) {
    console.log('[Unity] 收到消息:', message);
    
    try {
        var data = JSON.parse(message);
        handleUnityMessage(data);
    } catch (e) {
        console.log('[Unity] 收到非 JSON 消息:', message);
    }
};

// 处理 Unity 消息
function handleUnityMessage(data) {
    switch (data.type) {
        case 'unityReady':
            console.log('[Unity] Unity 端已就绪');
            break;
            
        case 'modelClicked':
            // Unity 中模型被点击
            if (data.modelType) {
                showModelIntro(data.modelType);
            }
            break;
            
        case 'dronePosition':
            // 无人机位置更新
            if (data.isNearBridge) {
                showArrowHint();
            }
            break;
            
        case 'seasonChanged':
            // Unity 端季节切换完成通知
            console.log('[Unity] 季节切换完成:', data.season);
            break;

        case 'droneTakeoff':
        case 'droneFlying':
        case 'droneStart':
        case 'takeoff':
        case 'fly':
            console.log('[Unity] 收到无人机起飞消息:', data.type);
            isDroneFlying = true;
            closeWinterGuide();
            break;
            
        default:
            console.log('[Unity] 未知消息类型:', data.type);
    }
}

// Unity 就绪回调 - 由 index.html 中的 Unity 加载器调用
function onUnityReady(instance) {
    unityInstance = instance;
    isUnityReady = true;

    showWelcomeHint();
    
    if (instance) {
        console.log('[Unity] WebGL 已就绪，可以发送消息');
        addLog('系统：Unity WebGL 已加载完成', 'system');
        
        // 通知 Unity 网页已就绪（如果 Unity 中有对应的接收函数）
        try {
            instance.SendMessage('WebGLBridge', 'OnWebReady', 'ready');
        } catch (e) {
            // Unity 中可能没有 WebGLBridge，忽略错误
        }
    } else {
        console.log('[Unity] WebGL 未部署，以离线模式运行');
        addLog('系统：Unity WebGL 未部署，网页功能以模拟模式运行', 'system');
    }
}

// 向 Unity 发送消息的封装函数
function sendToUnity(message) {
    if (!isUnityReady || !unityInstance) {
        console.warn('[Unity] 未就绪，消息未发送:', message);
        return false;
    }
    
    try {
        if (typeof message === 'object') {
            unityInstance.SendMessage('WebGLBridge', 'OnMessageFromWeb', JSON.stringify(message));
        } else {
            unityInstance.SendMessage('WebGLBridge', 'OnMessageFromWeb', message);
        }
        return true;
    } catch (error) {
        console.error('[Unity] 发送消息失败:', error);
        return false;
    }
}

// 向 Unity 发送指令（兼容原有 sendCommand 代码）
function sendUnityCommand(commandType, data) {
    const message = {
        type: commandType,
        data: data,
        from: 'web',
        time: new Date().toISOString()
    };
    return sendToUnity(message);
}

// ============================= 页面初始化 =============================

// 说明：这里原来还有一段 DOMContentLoaded 初始化，调用了 `initWebSocket()` —— 该函数
// 全项目从未定义（真实函数名是 `connectWebSocket`），所以那段分支永远静默失败；它顺带调的
// `initVoiceDialog()` 也只是打印一句日志的空壳。真正的初始化在下面的 window.onload 里，
// 已经会调 connectWebSocket()，因此这段死代码已删除。若将来要恢复 DOMContentLoaded
// 时机，请调用 connectWebSocket()（注意与 onload 的调用做重复判定）。

// 页面卸载前清理
window.addEventListener('beforeunload', function() {
    isPageUnloading = true;
    if (ws) {
        ws.close();
    }
});
