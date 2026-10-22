import { expect, it, vi } from 'vitest';
import { invalidateSubtitleIndex, subtitleEventAt, renderSubtitle } from './subtitles';
it('matches first-cue ordering for overlaps and backward seeks, expires precisely and invalidates offsets', () => {
    const cue = (start, end, text) => ({ StartPositionTicks: start, EndPositionTicks: end, Text: text });
    const cues = [cue(30, 60, 'First'), cue(10, 40, 'Second'), cue(20, 50, ''), cue(60, 90, 'Next')];
    for (const ticks of [0, 10, 20, 30, 40, 49, 50, 59, 60, 90, 35, 15]) {
        expect(subtitleEventAt(cues, ticks)).toBe(cues.find(c => c.StartPositionTicks <= ticks && c.EndPositionTicks > ticks));
    }
    cues.forEach(c => { c.StartPositionTicks -= 10; c.EndPositionTicks -= 10; });
    invalidateSubtitleIndex(cues);
    expect(subtitleEventAt(cues, 20)).toBe(cues[0]);
});
it('handles dense tracks without scanning or sanitizing the same dialogue on every tick', () => {
    const cues = Array.from({ length: 20000 }, (_, i) => ({ StartPositionTicks: i * 10, EndPositionTicks: i * 10 + 8, Text: `Line ${i}` }));
    for (let i = 0; i < 20000; i++) expect(subtitleEventAt(cues, i * 10)).toBe(cues[i]);
    const element = document.createElement('div'), sanitize = vi.fn(text => text);
    renderSubtitle(element, cues[0], sanitize);
    renderSubtitle(element, cues[0], sanitize);
    renderSubtitle(element, undefined, sanitize);
    expect(element.classList.contains('hide')).toBe(true);
    renderSubtitle(element, cues[0], sanitize);
    expect(element.classList.contains('hide')).toBe(false);
    expect(sanitize).toHaveBeenCalledTimes(1);
    element.innerHTML = '';
    renderSubtitle(element, cues[0], sanitize);
    expect(element.textContent).toBe('Line 0');
    expect(sanitize).toHaveBeenCalledTimes(1);
    renderSubtitle(element, cues[1], sanitize);
    expect(sanitize).toHaveBeenCalledTimes(2);
});
