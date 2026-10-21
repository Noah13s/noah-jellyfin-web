// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
});

it('shows readable skip feedback and applies a burst as one accumulated seek', async () => {
    vi.useFakeTimers();
    const { setVideo } = await import('./policy');
    const video = document.createElement('video');
    video.currentTime = 100;
    Object.defineProperty(video, 'duration', { value: 1000 });
    video.getBoundingClientRect = () => ({ width: 1000, height: 600, left: 0, top: 0 });
    document.body.innerHTML = '<div id="videoOsdPage"><button class="btnFastForward"></button><button class="btnRewind"></button></div>';
    document.body.appendChild(video);
    setVideo(video);
    await import('./gestures');
    const forward = document.querySelector('.btnFastForward');
    forward.click(); forward.click(); forward.click();
    const badge = document.getElementById('seerr-player-seek-feedback');
    expect(badge.textContent).toBe('+30s');
    expect(badge.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    expect(video.currentTime).toBe(100);
    vi.advanceTimersByTime(430);
    expect(video.currentTime).toBe(130);
    document.querySelector('.btnRewind').click();
    expect(badge.textContent).toBe('-10s');
    vi.advanceTimersByTime(430);
    expect(video.currentTime).toBe(120);
    vi.advanceTimersByTime(950);
    expect(badge.classList.contains('is-visible')).toBe(false);
});
