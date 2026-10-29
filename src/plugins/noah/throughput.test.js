import { describe, expect, it } from 'vitest';
import { mediaTransfer, retainedBudget } from './throughput';
const id = 'a'.repeat(32), origin = 'https://stream.example';
const entry = { name: `${origin}/player/Videos/${id}/hls1/main/1.mp4?secret=not-retained`,
    encodedBodySize: 1000000, transferSize: 1000400, requestStart: 1, responseStart: 3001, responseEnd: 3501, responseStatus: 200 };
describe('passive real-media transfer estimates', () => {
    it('separates three seconds of server wait from a fast body transfer', () => {
        const sample = mediaTransfer(entry, origin, id);
        expect(sample).toMatchObject({ bps: 16000000, waitMs: 3000, bodyMs: 500 });
        expect(sample.deliveryBps).toBeCloseTo(2285714.286);
        expect(JSON.stringify(sample)).not.toMatch(/secret|player\/|https/);
    });
    it('accepts completed direct-file ranges without probing or accepting unrelated resources', () => {
        const range = { ...entry, name: `${origin}/player/Videos/${id}/stream.mkv`, responseStatus: 206 };
        expect(mediaTransfer(range, origin, id)?.kind).toBe('range');
        expect(mediaTransfer({ ...range, responseStatus: 200 }, origin, id)).toBeUndefined();
        for (const patch of [{ transferSize: 0 }, { encodedBodySize: 100 }, { responseStatus: 503 },
            { responseEnd: 0 }, { responseStart: 0 }, { encodedBodySize: NaN },
            { name: entry.name.replace(id, 'b'.repeat(32)) }, { name: entry.name.replace(origin, 'https://other.example') }]) {
            expect(mediaTransfer({ ...entry, ...patch }, origin, id)).toBeUndefined();
        }
    });
    it('matches Jellyfin segment URLs containing a hyphenated item UUID', () => {
        const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
        expect(mediaTransfer({ ...entry, name: `${origin}/player/videos/${uuid}/hls1/main/754.ts` }, origin, id)?.kind).toBe('segment');
        expect(mediaTransfer({ ...entry, name: `${origin}/player/videos/${uuid.replace(/^a/, 'b')}/hls1/main/754.ts` }, origin, id)).toBeUndefined();
    });
    it('rejects stale/legacy/one-off observations and retains a bounded safety margin', () => {
        const sample = { source: 'video-body-v2', count: 3, bps: 50000000, at: 1000 };
        expect(retainedBudget(sample, 2000)).toBe(35000000);
        expect(retainedBudget({ ...sample, bps: 200000000 }, 2000)).toBe(80000000);
        for (const patch of [{ count: 1 }, { source: 'video' }, { bps: Infinity }, { at: 2001 }, { at: -1800000 }]) {
            expect(retainedBudget({ ...sample, ...patch }, 2000)).toBe(4000000);
        }
    });
});
