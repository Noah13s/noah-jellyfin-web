import { currentVideo } from './policy';
/* Accumulated seeking for Jellyfin Web; brightness gesture reserved for an APK. */
(() => {
  if (window.__seerrPlayerControls === 4) return;
  window.__seerrPlayerControls = 4;

  const STEP_SECONDS = 10;
  const TAP_WINDOW_MS = 430;
  const ENABLE_BRIGHTNESS_GESTURE = false;
  const BRIGHTNESS_KEY = 'noah-stream-picture-brightness';
  const CONTROL_SELECTOR = 'button, a, input, select, textarea, [role="button"], .osdControls, .osdHeader, .videoOsdBottom, .osdPositionSlider';
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const french = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  let down = null;
  let taps = { side: '', at: 0, count: 0 };
  let pending = null;
  let seekTimer;
  let feedbackTimer;
  let suppressClickUntil = 0;
  let brightness = 1;
  try {
    brightness = clamp(Number(localStorage.getItem(BRIGHTNESS_KEY)) || 1, 0.4, 1.6);
  } catch { /* Private browsing may disable storage. */ }

  const activeVideo = () => {
    const video = currentVideo;
    return video && video.getBoundingClientRect().width >= 100 ? video : null;
  };
  const isControl = (target) => target instanceof Element && Boolean(target.closest(CONTROL_SELECTOR));
  const sideAt = (video, x) => {
    const rect = video.getBoundingClientRect();
    const fraction = (x - rect.left) / rect.width;
    return fraction < 0.34 ? 'left' : fraction > 0.66 ? 'right' : '';
  };

  const style = document.createElement('style');
  style.id = 'seerr-player-controls-style';
  style.textContent = `
    .videoPlayerContainer video { touch-action: none; }
    .headerSyncButton, .headerSyncButton.syncButton, button[aria-label="SyncPlay"] { display: none !important; }
    .seerr-player-feedback { position: fixed; z-index: 10000; top: 43%; min-width: 6rem; padding: .7rem .9rem; border-radius: 999px; background: rgba(10,15,25,.83); color: #fff; font: 700 clamp(1.1rem,2vw,1.8rem)/1.2 sans-serif; text-align: center; pointer-events: none; opacity: 0; transform: translateY(8px) scale(.94); transition: opacity .16s ease, transform .16s ease; box-shadow: 0 8px 28px rgba(0,0,0,.3); }
    .seerr-player-feedback.is-visible { opacity: 1; transform: translateY(0) scale(1); }
    .seerr-player-feedback.is-left { left: 12%; } .seerr-player-feedback.is-right { right: 12%; }
    .seerr-brightness-feedback { position: fixed; z-index: 10000; left: max(1rem,env(safe-area-inset-left)); top: 34%; display: flex; flex-direction: column; align-items: center; gap: .5rem; width: 3.3rem; padding: .7rem .4rem; border-radius: 1.2rem; color: #fff; background: rgba(10,15,25,.83); font: 700 .8rem/1.1 sans-serif; pointer-events: none; opacity: 0; transition: opacity .16s ease; }
    .seerr-brightness-feedback.is-visible { opacity: 1; }
    .seerr-brightness-track { position: relative; height: 7rem; width: .3rem; overflow: hidden; border-radius: 1rem; background: #64748b; }
    .seerr-brightness-fill { position: absolute; inset: auto 0 0; border-radius: 1rem; background: #a5b4fc; }
    @media (max-width:600px) { .seerr-player-feedback { top: 42%; min-width: 4.5rem; padding: .6rem .7rem; font-size: 1.05rem; } .seerr-player-feedback.is-left { left: 6%; } .seerr-player-feedback.is-right { right: 6%; } }
    @media (prefers-reduced-motion:reduce) { .seerr-player-feedback,.seerr-brightness-feedback { transition: none; } }
  `;
  document.head.appendChild(style);

  const seekBadge = () => {
    let badge = document.getElementById('seerr-player-seek-feedback');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'seerr-player-seek-feedback';
      badge.className = 'seerr-player-feedback';
      badge.setAttribute('aria-live', 'polite');
      document.body.appendChild(badge);
    }
    return badge;
  };
  const brightnessBadge = () => {
    let badge = document.getElementById('seerr-picture-brightness-feedback');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'seerr-picture-brightness-feedback';
      badge.className = 'seerr-brightness-feedback';
      badge.setAttribute('aria-live', 'polite');
      badge.innerHTML = '<span aria-hidden="true">Ã¢Ëœâ‚¬</span><span class="seerr-brightness-track"><span class="seerr-brightness-fill"></span></span><span class="seerr-brightness-value"></span>';
      badge.setAttribute('aria-label', french ? 'LuminositÃƒÂ© de lÃ¢â‚¬â„¢image' : 'Picture brightness');
      document.body.appendChild(badge);
    }
    return badge;
  };
  const showSeek = (side, seconds) => {
    const badge = seekBadge();
    badge.className = `seerr-player-feedback is-${side} is-visible`;
    badge.textContent = `${side === 'left' ? 'Ã¢â€ Â¶ Ã¢Ë†â€™' : 'Ã¢â€ Â· +'}${seconds}s`;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => badge.classList.remove('is-visible'), 950);
  };
  const showBrightness = () => {
    const badge = brightnessBadge();
    badge.querySelector('.seerr-brightness-fill').style.height = `${clamp((brightness - .4) / 1.2 * 100, 0, 100)}%`;
    badge.querySelector('.seerr-brightness-value').textContent = `${Math.round(brightness * 100)}%`;
    badge.classList.add('is-visible');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => badge.classList.remove('is-visible'), 1200);
  };
  const setBrightness = (value) => {
    brightness = clamp(Math.round(value * 20) / 20, .4, 1.6);
    document.documentElement.style.setProperty('--seerr-picture-brightness', String(brightness));
    try { localStorage.setItem(BRIGHTNESS_KEY, String(brightness)); } catch { /* Optional persistence. */ }
    showBrightness();
  };
  const commitSeek = () => {
    clearTimeout(seekTimer);
    if (!pending) return;
    const { side, seconds } = pending;
    pending = null;
    const video = activeVideo();
    if (!video || !Number.isFinite(video.currentTime)) return;
    const delta = side === 'left' ? -seconds : seconds;
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - .1) : Infinity;
    video.currentTime = clamp(video.currentTime + delta, 0, end);
  };
  const queueSeek = (side) => {
    if (!activeVideo()) return;
    if (pending && pending.side !== side) commitSeek();
    pending = { side, seconds: (pending?.seconds || 0) + STEP_SECONDS };
    showSeek(side, pending.seconds);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, TAP_WINDOW_MS);
  };

  document.addEventListener('pointerdown', (event) => {
    const video = activeVideo();
    if (!video || isControl(event.target) || event.button !== 0 || !event.isPrimary) { down = null; return; }
    const side = sideAt(video, event.clientX);
    down = side ? { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, side, at: Date.now(), startBrightness: brightness, dragging: false } : null;
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!ENABLE_BRIGHTNESS_GESTURE) return;
    if (!down || down.pointerId !== event.pointerId || down.side !== 'left' || down.pointerType === 'mouse') return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    if (!down.dragging && Math.abs(dy) < 18) return;
    if (!down.dragging && Math.abs(dy) < Math.abs(dx) * 1.2) return;
    down.dragging = true;
    event.preventDefault();
    const height = activeVideo()?.getBoundingClientRect().height || innerHeight;
    setBrightness(down.startBrightness - dy / Math.max(height * .55, 180));
  }, { capture: true, passive: false });

  document.addEventListener('pointerup', (event) => {
    const video = activeVideo();
    if (!video || !down || event.pointerId !== down.pointerId) { down = null; return; }
    const gesture = down;
    down = null;
    if (ENABLE_BRIGHTNESS_GESTURE && gesture.dragging) {
      suppressClickUntil = Date.now() + 450;
      return;
    }
    if (isControl(event.target) || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 22 ||
        Date.now() - gesture.at > 600 || sideAt(video, event.clientX) !== gesture.side) return;
    const now = Date.now();
    taps = taps.side === gesture.side && now - taps.at <= TAP_WINDOW_MS
      ? { side: gesture.side, at: now, count: taps.count + 1 }
      : { side: gesture.side, at: now, count: 1 };
    if (taps.count < 2) return;
    queueSeek(gesture.side);
    suppressClickUntil = now + 350;
  }, true);
  document.addEventListener('pointercancel', () => { down = null; }, true);

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('.btnRewind,.btnFastForward');
    if (button && button.closest('#videoOsdPage') && activeVideo()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      queueSeek(button.matches('.btnRewind') ? 'left' : 'right');
      return;
    }
    if (Date.now() < suppressClickUntil && activeVideo() && !isControl(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('dblclick', (event) => {
    const video = activeVideo();
    if (video && !isControl(event.target) && sideAt(video, event.clientX)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  const labelControls = () => {
    const labels = french
      ? [['.btnRewind', 'Reculer de 10 secondes'], ['.btnFastForward', 'Avancer de 10 secondes']]
      : [['.btnRewind', 'Back 10 seconds'], ['.btnFastForward', 'Forward 10 seconds']];
    for (const [selector, label] of labels) {
      const button = document.querySelector(`#videoOsdPage ${selector}`);
      if (button && button.getAttribute('aria-label') !== label) {
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
      }
    }
  };
  labelControls();
  document.addEventListener('viewshow', labelControls);
})();
