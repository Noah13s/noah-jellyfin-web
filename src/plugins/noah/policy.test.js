// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const id = 'a'.repeat(32);
const api = { serverAddress: () => 'https://stream.example/player', serverId: () => 'server', getCurrentUserId: () => 'user', getItem: vi.fn() };
async function policy(enabled = true) {
    vi.resetModules();
    window.history.replaceState({}, '', `/?seerrAutoplay=1${enabled ? '&seerrBridgeId=12345678-1234-1234-1234-123456789012' : ''}#details?id=${id}`);
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: vi.fn() } });
    return import('./policy');
}

beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
});

describe('explicit Seerr source policies', () => {
    it('limits the Safari MSE path to supported embedded desktop video', async () => {
        const p = await policy();
        const media = { isTypeSupported: vi.fn().mockReturnValue(true) };
        expect(p.preferSafariMse({ safari: true, iOS: false }, 'Video', media)).toBe(true);
        expect(p.preferSafariMse({ safari: true, iOS: true }, 'Video', media)).toBe(false);
        expect(p.preferSafariMse({ safari: true, iOS: false }, 'Audio', media)).toBe(false);
        expect(p.preferSafariMse({ safari: true, iOS: false }, 'Video', null)).toBe(false);
        p.setCompatibility();
        expect(p.preferSafariMse({ safari: true, iOS: false }, 'Video', media)).toBe(false);
        media.isTypeSupported.mockReturnValue(false);
        expect(p.preferSafariMse({ safari: true, iOS: false }, 'Video', media)).toBe(false);
        const ordinary = await policy(false);
        expect(ordinary.preferSafariMse({ safari: true, iOS: false }, 'Video', media)).toBe(false);
    });
    it('selects the native video player regardless of plugin registration order', async () => {
        const p = await policy();
        const youtube = { isLocalPlayer: true, canPlayMediaType: () => true };
        const native = { isLocalPlayer: true, prepareEmbedded: vi.fn() };
        expect(p.nativeVideoPlayer([youtube, native])).toBe(native);
        expect(p.nativeVideoPlayer([native, youtube])).toBe(native);
        expect(p.nativeVideoPlayer([youtube])).toBeUndefined();
    });
    it('does not modify browser APIs or ordinary/old-client playback', async () => {
        const fetch = window.fetch, open = XMLHttpRequest.prototype.open, descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        const p = await policy(false);
        const query = { DeviceProfile: {} };
        expect(p.local).toBe(false);
        expect(p.adaptRequest(query)).toBe(query);
        expect(window.fetch).toBe(fetch);
        expect(XMLHttpRequest.prototype.open).toBe(open);
        expect(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')).toEqual(descriptor);
    });

    it('reuses matching PlaybackInfo once, without request interception', async () => {
        const p = await policy();
        p.beginBudget(api);
        const item = { Id: id }, query = { StartTimeTicks: 90000000, IsPlayback: true, DeviceProfile: { TranscodingProfiles: [] } };
        const request = vi.fn().mockResolvedValue({ PlaySessionId: 'session', MediaSources: [{ Id: id }] });
        await p.prepareDecision(api, item, query, request);
        expect(request.mock.calls[0][0]).toMatchObject({ IsPlayback: false, AutoOpenLiveStream: false });
        await p.playbackInfo(api, item, query, request);
        expect(request).toHaveBeenCalledTimes(1);
        await p.playbackInfo(api, item, query, request);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('discards a late prepared decision after Play or exit changes its generation', async () => {
        const p = await policy();
        let ticket = 1, finish;
        p.hooks.ticket = () => ticket;
        p.hooks.current = captured => captured === ticket;
        const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
            .mockResolvedValue({ MediaSources: [{ Id: id }] });
        const item = { Id: id }, query = { DeviceProfile: {} };
        const pending = p.prepareDecision(api, item, query, request);
        ticket++;
        finish({ MediaSources: [{ Id: id }] });
        await pending;
        await p.playbackInfo(api, item, query, request);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('changed resume, user, and source-opening decisions do not reuse stale preparation', async () => {
        const p = await policy();
        const item = { Id: id }, query = { StartTimeTicks: 0, DeviceProfile: {} };
        const request = vi.fn().mockResolvedValue({ MediaSources: [{ RequiresOpening: true }] });
        await p.prepareDecision(api, item, query, request);
        await p.playbackInfo(api, item, query, request);
        expect(request).toHaveBeenCalledTimes(2);
        request.mockResolvedValue({ MediaSources: [{ Id: id }] });
        await p.prepareDecision(api, item, query, request);
        await p.playbackInfo(api, item, { ...query, StartTimeTicks: 50000000 }, request);
        await p.playbackInfo({ ...api, getCurrentUserId: () => 'other-user' }, item, query, request);
        expect(request).toHaveBeenCalledTimes(5);
    });

    it('item snapshots survive native circular playlist mutation and return independent copies', async () => {
        const p = await policy();
        const item = { Id: id, UserData: { PlaybackPositionTicks: 90000000 } };
        p.rememberItem(api, item);
        item.playOptions = { items: [item] };
        const first = await p.getItem(api, 'user', id);
        first.UserData.PlaybackPositionTicks = 0;
        expect((await p.getItem(api, 'user', id)).UserData.PlaybackPositionTicks).toBe(90000000);
        expect(api.getItem).not.toHaveBeenCalled();
    });

    it('keeps normal capabilities, one-segment HLS and stable initial automatic quality', async () => {
        const p = await policy();
        p.beginBudget(api);
        const query = { DeviceProfile: { DirectPlayProfiles: [{ Type: 'Video', Container: 'mp4,mkv' }], TranscodingProfiles: [{ Type: 'Video', Protocol: 'hls', VideoCodec: 'hevc' }] }, MaxStreamingBitrate: 12000000 };
        const result = p.adaptRequest(query);
        expect(result.DeviceProfile.DirectPlayProfiles).toEqual(query.DeviceProfile.DirectPlayProfiles);
        expect(result.DeviceProfile.TranscodingProfiles[0]).toMatchObject({ MinSegments: 1, SegmentLength: 2, VideoCodec: 'hevc' });
        expect(result.MaxStreamingBitrate).toBe(4000000);
        expect(query.MaxStreamingBitrate).toBe(12000000);
        expect(p.holdAutomaticChange({ enableAutomaticBitrateDetection: true }, 12000000)).toBe(true);
        expect(p.holdAutomaticChange({ maxBitrate: 8000000 }, 12000000)).toBe(false);
    });

    it('retains real body throughput for the next launch without reconsidering the current encoder', async () => {
        const p = await policy();
        let observe;
        const disconnect = vi.fn();
        const OriginalObserver = window.PerformanceObserver;
        window.PerformanceObserver = class {
            constructor(callback) { observe = callback; }
            observe() { /* passive */ }
            disconnect = disconnect;
        };
        try {
            p.beginBudget(api);
            const manager = { setMaxStreamingBitrate: vi.fn() };
            const close = p.observeThroughput(manager, {});
            const entry = { name: `${window.location.origin}/player/Videos/${id}/hls1/main/1.mp4`,
                encodedBodySize: 2000000, transferSize: 2000400, requestStart: 1, responseStart: 3001, responseEnd: 3251, responseStatus: 200 };
            observe({ getEntries: () => [entry, entry, entry, entry] });
            p.beginBudget(api, true);
            expect(await p.detectBudget(api, vi.fn())).toBe(4000000);
            expect(manager.setMaxStreamingBitrate).not.toHaveBeenCalled();
            p.beginBudget(api);
            expect(await p.detectBudget(api, vi.fn())).toBe(44800000);
            close();
            expect(disconnect).toHaveBeenCalledOnce();
        } finally { window.PerformanceObserver = OriginalObserver; }
    });

    it('maps ASS dialogue through text conversion without changing bitmap burn-in', async () => {
        const p = await policy();
        let media = { MediaSources: [{ MediaStreams: [
            { Type: 'Subtitle', Codec: 'ass', DeliveryUrl: '/subtitle/stream.ass' },
            { Type: 'Subtitle', Codec: 'pgssub', DeliveryMethod: 'Encode' }
        ] }] };
        media = p.normalizeMedia(media);
        expect(media.MediaSources[0].MediaStreams[0]).toMatchObject({ Codec: 'subrip', DeliveryUrl: '/subtitle/stream.vtt' });
        expect(media.MediaSources[0].MediaStreams[1].Codec).toBe('pgssub');
        const data = { TrackEvents: [{ Text: '<span style="font-size:90px">Hello</span><br>Next' }] };
        expect(p.normalizeSubtitle(data).TrackEvents[0].Text).toBe('Hello<br>Next');
    });
});
