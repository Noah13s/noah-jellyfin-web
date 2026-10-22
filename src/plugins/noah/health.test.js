import { describe, expect, it } from 'vitest';
import { classifyFailure, PlaybackHealth } from './health';
import { PlaybackTelemetry } from './telemetry';

describe('classified recovery and bounded timing evidence', () => {
    it('distinguishes HTTP capacity, authentication, missing segments and auxiliary subtitles', () => {
        expect(classifyFailure({ status: 503, message: 'Insufficient transcode storage' })).toBe('capacity');
        expect(classifyFailure({ status: 403 })).toBe('authentication');
        expect(classifyFailure({ status: 410 })).toBe('missingSegment');
        expect(classifyFailure({ type: 'ASS_RENDER_ERROR' })).toBe('subtitle');
        expect(classifyFailure({ type: 'NETWORK_ERROR' })).toBe('network');
        expect(classifyFailure({ type: 'MEDIA_DECODE_ERROR' })).toBe('decoder');
    });
    it('never converts transport failures, bounds retries and excludes auth/capacity/subtitle restarts', () => {
        const health = new PlaybackHealth();
        expect(health.next('subtitle', 0)).toBe('ignore');
        expect(health.next('authentication', 0)).toBe('terminal');
        expect(health.next('capacity', 0)).toBe('terminal');
        expect(health.next('network', 0)).toBe('same');
        expect(health.next('network', 12000)).toBe('same');
        expect(health.next('network', 24000)).toBe('terminal');
        expect(health.next('decoder', 36000)).toBe('compatibility');
        expect(health.next('decoder', 48000)).toBe('terminal');
    });
    it('excludes hidden/paused/seeking time, distinguishes starvation and restores budget after healthy playback', () => {
        const health = new PlaybackHealth();
        const sample = (now, values = {}) => health.sample({ now, position: 0, active: true, paused: false, seeking: false, ended: false, buffering: true, bufferedAhead: 0, ...values });
        expect(sample(15000, { active: false })).toBeNull();
        expect(sample(20000, { paused: true })).toBeNull();
        expect(sample(30000, { seeking: true })).toBeNull();
        expect(sample(41000)).toBeNull();
        expect(sample(43000)).toBe('network');
        expect(sample(56000, { bufferedAhead: 10, buffering: false })).toBe('decoder');
        health.next('network', 0);
        health.next('network', 10000);
        for (let n = 0; n <= 61; n++) sample(60000 + n * 1000, { position: n + 1 });
        expect(health.next('network', 122000)).toBe('same');
    });
    it('bounds histories and rejects sensitive labels, preserving command ack versus frame evidence', () => {
        let now = 0;
        const metrics = new PlaybackTelemetry(() => now);
        metrics.record('https://secret?ApiKey=token');
        for (let n = 0; n < 300; n++) {
            now++;
            metrics.record('seekAck', { durationMs: n, category: 'https://secret' });
        }
        const snapshot = metrics.snapshot();
        expect(snapshot.events).toHaveLength(128);
        expect(snapshot.metrics.seekAck.count).toBe(64);
        expect(JSON.stringify(snapshot)).not.toMatch(/secret|ApiKey|presentedFrame/);
        snapshot.events.length = 0;
        expect(metrics.snapshot().events).toHaveLength(128);
    });
    it('detects missing presentation even while the media clock advances', () => {
        const health = new PlaybackHealth();
        expect(health.sample({ now: 15000, position: 15, active: true, paused: false,
            seeking: false, ended: false, buffering: false, bufferedAhead: 8,
            presentationAt: 1000 })).toBe('decoder');
        expect(health.sample({ now: 15000, position: 15, active: false, paused: false,
            seeking: false, ended: false, buffering: false, bufferedAhead: 8,
            presentationAt: 1000 })).toBeNull();
    });
});
