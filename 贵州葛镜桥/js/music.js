/**
 * music.js — 背景音乐控制
 *
 * 曲目：徐梦圆 - CHINA-孤舟（music/徐梦圆-CHINA-孤舟_624237536.mp3）
 * 行为：点按钮播放、再点暂停；图标随状态切换（播放 ▶ / 暂停 ‖‖）。
 *
 * 浏览器自动播放策略要求「用户手势触发」，所以不在加载时自动播 ——
 * 让用户主动点一下，既合规又不打扰。
 */
export function initMusic() {
    const btn = document.getElementById('musicbtn');
    const audio = document.getElementById('bgm');
    if (!btn || !audio) return;

    audio.volume = 0.5;       // 别太响，盖过环境音就喧宾夺主了
    audio.loop = true;       // 循环播放，长场景不会断

    const sync = (on) => {
        btn.classList.toggle('is-on', on);
        const label = on ? '暂停背景音乐' : '播放背景音乐';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    };

    btn.addEventListener('click', () => {
        if (audio.paused) {
            // play() 返回 Promise；自动播放被拒或文件损坏时 reject，要接住
            audio.play().then(() => sync(true)).catch(() => sync(false));
        } else {
            audio.pause();
            sync(false);
        }
    });

    // 音频事件也同步状态（防止别的代码 / 系统媒体键把状态带偏）
    audio.addEventListener('play', () => sync(true));
    audio.addEventListener('pause', () => sync(false));
    audio.addEventListener('ended', () => sync(false));   // loop 下基本不触发，兜底
}
