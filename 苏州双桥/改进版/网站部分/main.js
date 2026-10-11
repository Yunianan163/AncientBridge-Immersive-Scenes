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
        { id: 'command-panel', handle: 'h3' },
        { id: 'model-intro-panel', handle: '.panel-header' },
        { id: 'task-panel', handle: 'h3' },
        { id: 'drone-guide-panel', handle: '.panel-header' },
        { id: 'voice-dialog-panel', handle: '.panel-header' },
        { id: 'history-panel', handle: 'h3' },
        { id: 'bottom-controls', handle: null }
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
    ws = new WebSocket('ws://127.0.0.1:8082/ws');

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
        addLog('系统：已完成全部网页前置交互，无人机已解锁！', 'system');
        showCenterMessage('🎉 无人机已解锁！');
        
        // 任务完成后立即隐藏任务面板
        hideTaskPanel();
    }

    if (!taskProgress.droneUnlocked) {
        showTaskPanel();
    }

    updateExtraControlButtons();
}

function showTaskPanel() {
    const panel = document.getElementById('task-panel');
    if (panel) {
        panel.style.display = 'block';
        panel.style.opacity = '1';
    }
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

    showTaskPanel();
    hideDroneGuide();
    hideArrowHint();
    hideUnlockIntroPanel();
    setUnlockIntroLockedState(false);
    hideRobotEntryButton();
    hideModelHoverTip();
    clearBridgeIntroPin();
    hideBridgeIntro(true);
    updateExtraControlButtons();

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
    const bottomControls = document.getElementById('bottom-controls');
    if (!bottomControls) return;

    const shouldShow = !!taskProgress.droneUnlocked;

    // 删除旧的第二行容器（如果存在）
    let oldSecondRow = document.getElementById('bottom-controls-second-row');
    if (oldSecondRow) {
        oldSecondRow.remove();
    }

    // 打开无人机指南按钮 - 插入到最左边
    let btnGuide = document.getElementById('btn-open-drone-guide');
    if (shouldShow && !btnGuide) {
        btnGuide = document.createElement('button');
        btnGuide.id = 'btn-open-drone-guide';
        btnGuide.className = 'control-btn img-btn';
        btnGuide.title = '打开无人机指南';
        btnGuide.onclick = reopenDroneGuide;
        const img = document.createElement('img');
        img.src = '打开无人机指南.png';
        img.alt = '打开无人机指南';
        btnGuide.appendChild(img);
        // 插入到第一个位置
        bottomControls.insertBefore(btnGuide, bottomControls.firstChild);
    } else if (!shouldShow && btnGuide) {
        btnGuide.remove();
    }

    // 更多历史介绍按钮 - 插入到最右边
    let btnIntro = document.getElementById('btn-open-unlock-intro');
    if (shouldShow && !btnIntro) {
        btnIntro = document.createElement('button');
        btnIntro.id = 'btn-open-unlock-intro';
        btnIntro.className = 'control-btn img-btn';
        btnIntro.title = '更多历史介绍';
        btnIntro.onclick = reopenUnlockIntro;
        const img = document.createElement('img');
        img.src = '更多历史介绍.png';
        img.alt = '更多历史介绍';
        btnIntro.appendChild(img);
        // 插入到最后
        bottomControls.appendChild(btnIntro);
    } else if (!shouldShow && btnIntro) {
        btnIntro.remove();
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

    panel.style.display = 'block';
    panel.classList.add('highlight');

    if (!isUnlockIntroUnlocked) {
        showArrowHint();
    }

    setTimeout(() => {
        panel.classList.remove('highlight');
    }, 2000);
}

function hideDroneGuide() {
    const panel = document.getElementById('drone-guide-panel');
    if (!panel) return;

    panel.style.display = 'none';
    panel.classList.remove('highlight');
}

function closeDroneGuidePanel() {
    isDroneGuidePanelManuallyClosed = true;
    hideDroneGuide();
    hideArrowHint();
    addLog('系统：已关闭无人机指南窗口', 'system');
}

// 箭头提示
function showArrowHint() {
    if (isDroneGuidePanelManuallyClosed || isArrowHintShowing || isUnlockIntroUnlocked) return;

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

// 更新机器人入口按钮文字状态
function updateRobotEntryButtonState(isActive) {
    const btn = document.getElementById('robot-entry-btn');
    if (!btn) return;
    
    isRobotVoiceDialogActive = isActive;
    
    if (isActive) {
        btn.innerHTML = '<img src="robot3.png" alt="机器人"> 关闭机器人语音对话';
        btn.classList.add('active');
    } else {
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
    
    addLog('系统：已关闭机器人语音对话并重置，通知Unity隐藏机器人并重置入场动画', 'system');
    showCenterMessage('机器人语音对话已关闭');
}

function openRobotVideo() {
    const overlay = document.getElementById('robot-video-overlay');
    const video = document.getElementById('robot-intro-video');
    if (!overlay || !video) return;

    overlay.style.display = 'flex';
    video.currentTime = 0;

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
    };

    video.play().catch(() => {
        // 自动播放可能被浏览器阻止，用户可手动点击播放
        console.log('视频自动播放被阻止，请手动点击播放');
    });

    addLog('系统：打开机器人介绍视频', 'system');
}

function closeRobotVideo() {
    const overlay = document.getElementById('robot-video-overlay');
    const video = document.getElementById('robot-intro-video');
    if (!overlay || !video) return;

    video.pause();
    overlay.style.display = 'none';
    addLog('系统：关闭机器人介绍视频', 'system');
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
            isDroneFlying = true;
            addLog('系统：无人机已起飞，继续显示"往前靠近桥可以解锁更多介绍"提示', 'system');

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
function sendCommand() {
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
    } else {
        clearBridgeIntroPin();
        hideBridgeIntro(true);
        hideModelHoverTip();
    }

    addLog(isModelPanelOpen ? '发送：打开模型面板' : '发送：关闭模型面板', 'web');
    showCenterMessage(isModelPanelOpen ? '模型面板已打开' : '模型面板已关闭');
}

function changeSeason(season, event) {
    console.log('[季节调试] 点击季节按钮: ' + season, event);

    const normalized = normalizeSeasonKey(season);
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

// 页面初始化
window.onload = () => {
    debugLog('页面加载完成，初始化中...');
    resetTaskPanelUI(false);
    connectWebSocket();
    hideBridgeIntro(true);
    hideModelHoverTip();
    bindModelIntroShield();
    initDraggablePanels();

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
    
    // 绑定鼠标点击效果（涟漪+船）
    document.addEventListener('click', (e) => {
        createRipple(e.clientX, e.clientY);
        createBoat(e.clientX, e.clientY);
    });
};

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
    
    panel.style.display = 'flex';
    addLog('系统：语音对话面板已显示', 'system');
    showCenterMessage('🎤 请点击"开始对话"与机器人交流');
    
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
}

// 语音对话应用类（简化版，与服务器通信）
class VoiceDialogApp {
    constructor() {
        this.isConnected = false;
        this.isRecording = false;
        this.ws = null;
        this.chatContainer = document.getElementById('voice-chat-container');
        this.statusEl = document.getElementById('voice-status');
        this.recordingIndicator = document.getElementById('voice-recording-indicator');
        this.btnConnect = document.getElementById('btn-voice-connect');
        this.btnStart = document.getElementById('btn-voice-start');
        this.btnStop = document.getElementById('btn-voice-stop');
        this.textInput = document.getElementById('voice-text-input');
        
        this.init();
    }
    
    init() {
        // 初始化消息显示
        this.addSystemMessage('欢迎与机器人沧朔对话！点击"开始对话"按钮开始。');
    }
    
    async connect() {
        if (this.isConnected) {
            this.addSystemMessage('已经连接了');
            return;
        }
        
        this.addSystemMessage('正在连接语音服务...');
        
        try {
            // 使用 WebSocket 连接到服务器的语音代理
            this.ws = new WebSocket('ws://127.0.0.1:8082/voice-proxy');
            
            this.ws.onopen = () => {
                this.isConnected = true;
                this.updateStatus('已连接', true);
                this.addSystemMessage('✅ 连接成功！可以开始语音对话了。');
                this.enableButton('btn-voice-start', true);
                this.enableButton('btn-voice-stop', true);
                this.enableButton('btn-voice-connect', false);
                
                // 通知 Unity 机器人已就绪
                sendToServer({
                    type: 'robotConversationReady',
                    from: 'web',
                    time: new Date().toISOString()
                });
            };
            
            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
            
            this.ws.onerror = (error) => {
                console.error('语音 WebSocket 错误:', error);
                this.addSystemMessage('❌ 连接错误，请检查网络');
                this.updateStatus('连接失败', false, true);
            };
            
            this.ws.onclose = () => {
                this.isConnected = false;
                this.updateStatus('未连接', false);
                this.enableButton('btn-voice-start', false);
                this.enableButton('btn-voice-stop', false);
                this.enableButton('btn-voice-connect', true);
                this.addSystemMessage('连接已关闭');
            };
            
        } catch (error) {
            console.error('连接失败:', error);
            this.addSystemMessage('❌ 连接失败: ' + error.message);
        }
    }
    
    handleMessage(data) {
        // 处理服务器返回的语音数据
        if (data instanceof Blob) {
            // 播放音频
            this.playAudio(data);
        } else {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'text') {
                    this.addMessage(msg.content, false);
                }
            } catch (e) {
                // 二进制数据或其他格式
            }
        }
    }
    
    startVoiceChat() {
        if (!this.isConnected) {
            this.addSystemMessage('请先连接服务器');
            return;
        }
        
        this.isRecording = true;
        this.recordingIndicator.style.display = 'flex';
        this.addSystemMessage('🎤 正在录音，请说话...');
        
        // 通知 Unity 机器人开始聆听
        sendToServer({
            type: 'robotStartListening',
            from: 'web',
            time: new Date().toISOString()
        });
        
        // 这里可以添加实际的音频录制逻辑
    }
    
    stop() {
        if (this.isRecording) {
            this.isRecording = false;
            this.recordingIndicator.style.display = 'none';
            this.addSystemMessage('录音已停止');
        }
        
        if (this.ws) {
            this.ws.close();
        }
    }
    
    sendText() {
        const text = this.textInput.value.trim();
        if (!text) return;
        
        if (!this.isConnected) {
            this.addSystemMessage('请先连接服务器');
            return;
        }
        
        this.addMessage(text, true);
        
        // 发送给服务器
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'text',
                content: text
            }));
        }
        
        this.textInput.value = '';
    }
    
    addMessage(text, isUser) {
        const msgEl = document.createElement('div');
        msgEl.className = 'voice-message ' + (isUser ? 'user' : 'ai');
        msgEl.textContent = text;
        this.chatContainer.appendChild(msgEl);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
    
    addSystemMessage(text) {
        const msgEl = document.createElement('div');
        msgEl.className = 'voice-message voice-message-system';
        msgEl.textContent = text;
        this.chatContainer.appendChild(msgEl);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
    
    updateStatus(text, connected, isError = false) {
        this.statusEl.textContent = text;
        this.statusEl.className = 'voice-status ' + (connected ? 'connected' : '') + (isError ? ' error' : '');
    }
    
    enableButton(btnId, enabled) {
        const btn = document.getElementById(btnId);
        if (btn) btn.disabled = !enabled;
    }
    
    playAudio(blob) {
        // 播放返回的音频
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
    }
}

// 初始化语音对话
function initVoiceDialog() {
    voiceDialogApp = new VoiceDialogApp();
}

// ============================= 语音对话面板控制 =============================
// 注意：完整的语音对话功能在 voice-dialog.js 模块中定义
// 以下函数作为占位符，实际功能由模块提供

if (typeof showVoiceDialog !== 'function') {
    window.showVoiceDialog = function() {
        console.log('[VoiceDialog] 等待语音对话模块加载...');
        const panel = document.getElementById('voice-dialog-panel');
        if (panel) {
            panel.style.display = 'flex';
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
            
        default:
            console.log('[Unity] 未知消息类型:', data.type);
    }
}

// Unity 就绪回调 - 由 index.html 中的 Unity 加载器调用
function onUnityReady(instance) {
    unityInstance = instance;
    isUnityReady = true;
    
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

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Main] 页面加载完成，等待 Unity...');
    
    // 初始化 WebSocket 连接
    setTimeout(function() {
        if (typeof initWebSocket === 'function') {
            initWebSocket();
        }
    }, 500);
    
    // 初始化语音对话
    if (typeof initVoiceDialog === 'function') {
        initVoiceDialog();
    }
});

// 页面卸载前清理
window.addEventListener('beforeunload', function() {
    isPageUnloading = true;
    if (ws) {
        ws.close();
    }
});
