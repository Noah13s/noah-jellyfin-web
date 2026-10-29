// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
    const player = { prepareEmbedded: vi.fn().mockResolvedValue() };
    const api = { getCurrentUserId: () => 'user', serverId: () => 'server',
        getItem: vi.fn().mockResolvedValue({ Id: 'a'.repeat(32), UserData: {} }),
        getUrl: () => '/player/session', accessToken: () => 'private-token', deviceId: () => 'device' };
    const manager = {
        getPlayers: () => [player], currentItem: () => ({ Id: 'a'.repeat(32) }),
        getCurrentTicks: () => 1200000000, duration: () => 36000000000,
        getPlaybackMediaSources: vi.fn().mockResolvedValue([]),
        play: vi.fn().mockResolvedValue(), stop: vi.fn().mockResolvedValue(),
        pause: vi.fn(), unpause: vi.fn(), seek: vi.fn(),
        getAudioStreamIndex: () => 2, getSubtitleStreamIndex: () => -1,
        recoverEmbeddedStream: vi.fn().mockResolvedValue(true),
        renegotiateEmbeddedStream: vi.fn().mockResolvedValue(true)
    };
    return { player, manager, api };
});
vi.mock('../../components/playback/playbackmanager', () => ({ playbackManager: fixture.manager }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { currentApiClient: () => fixture.api } }));
vi.mock('../../utils/events', () => ({ default: { on: vi.fn() } }));
vi.mock('./casting', () => ({}));
vi.mock('./gestures', () => ({}));

let hostParent;
let policy;
let clock;
let sequence;
let rejectOpen;
const bridge = '12345678-1234-1234-1234-123456789012';
function send(action) {
    window.dispatchEvent(new MessageEvent('message', { source: hostParent, origin: window.location.origin,
        data: { channel: 'noah-player', version: 1, frameId: bridge, kind: 'command', id: `command-${sequence++}`, action, payload: {} } }));
}
beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    fixture.api.getItem.mockResolvedValue({ Id: 'a'.repeat(32), UserData: {} });
    fixture.player.prepareEmbedded.mockResolvedValue();
    fixture.manager.getPlaybackMediaSources.mockResolvedValue([]);
    // Native Safari playback may leave this promise pending while video plays.
    fixture.manager.play.mockReturnValue(new Promise((_resolve, reject) => {
        rejectOpen = reject;
    }));
    fixture.manager.stop.mockResolvedValue();
    fixture.manager.recoverEmbeddedStream.mockResolvedValue(true);
    fixture.manager.renegotiateEmbeddedStream.mockResolvedValue(true);
    sequence = 0;
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', `/?seerrAutoplay=1&seerrBridgeId=${bridge}#details?id=${'a'.repeat(32)}`);
    hostParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { configurable: true, value: hostParent });
    const embedded = await import('./embedded');
    policy = await import('./policy');
    embedded.enterEmbedded();
    expect(policy.local).toBe(true);
    await vi.waitFor(() => expect(hostParent.postMessage.mock.calls.some(([value]) => value.event === 'prepared')).toBe(true));
    send('play');
    await vi.waitFor(() => expect(fixture.manager.play).toHaveBeenCalledTimes(1));
}, 30000);
afterEach(async () => {
    send('stop');
    await Promise.resolve();
    vi.restoreAllMocks();
});
describe('embedded recovery ownership', () => {
    it('acknowledges play and accepts controls even when the native open remains pending', async () => {
        await vi.waitFor(() => expect(hostParent.postMessage.mock.calls.some(([value]) => value.kind === 'reply' && value.id === 'command-0' && value.ok)).toBe(true));
        send('pause');
        await vi.waitFor(() => expect(fixture.manager.pause).toHaveBeenCalledOnce());
    });
    it('routes a later open failure to bounded recovery', async () => {
        rejectOpen(new Error('network interrupted'));
        await vi.waitFor(() => expect(fixture.manager.recoverEmbeddedStream).toHaveBeenCalledOnce());
    });
    it('reopens an interrupted stream without stopping its encoder or renegotiating tracks', async () => {
        expect(policy.hooks.failure({ type: 'NETWORK_ERROR' }, fixture.player)).toBe(true);
        await vi.waitFor(() => expect(fixture.manager.recoverEmbeddedStream).toHaveBeenCalledTimes(1));
        expect(fixture.manager.recoverEmbeddedStream.mock.calls[0][1]).toBe(1200000000);
        expect(fixture.manager.stop).not.toHaveBeenCalled();
        expect(fixture.manager.play).toHaveBeenCalledTimes(1);
    });
    it('subtitle-only faults leave playback running and ordinary players retain upstream behavior', async () => {
        expect(policy.hooks.failure({ type: 'ASS_RENDER_ERROR' }, fixture.player)).toBe(true);
        expect(policy.hooks.failure({ type: 'NETWORK_ERROR' }, {})).toBe(false);
        await Promise.resolve();
        expect(fixture.manager.stop).not.toHaveBeenCalled();
        expect(fixture.manager.recoverEmbeddedStream).not.toHaveBeenCalled();
    });
    it('capacity ends safely without requesting another encoder', async () => {
        policy.hooks.noteFailure({ status: 503, message: 'Insufficient transcode storage' });
        policy.hooks.failure({ type: 'SERVER_ERROR' }, fixture.player);
        await vi.waitFor(() => expect(hostParent.postMessage.mock.calls.some(([value]) => value.state?.code === 'PLAYBACK_CAPACITY')).toBe(true));
        expect(fixture.manager.recoverEmbeddedStream).not.toHaveBeenCalled();
        expect(fixture.manager.play).toHaveBeenCalledTimes(1);
    });
    it('a missing segment refreshes metadata with the selected audio and subtitle Off retained', async () => {
        policy.hooks.noteFailure({ status: 410 });
        policy.hooks.failure({ type: 'SERVER_ERROR' }, fixture.player);
        await vi.waitFor(() => expect(fixture.manager.renegotiateEmbeddedStream).toHaveBeenCalledTimes(1));
        expect(fixture.manager.renegotiateEmbeddedStream.mock.calls[0][1]).toBe(1200000000);
        expect(fixture.manager.renegotiateEmbeddedStream.mock.calls[0][3]).toEqual({ audio: 2, subtitle: -1, compatibility: false });
        expect(fixture.manager.stop).not.toHaveBeenCalled();
        expect(policy.adaptRequest({ DeviceProfile: {} }).EnableDirectPlay).not.toBe(false);
    });
    it('a rejected decoder reopen may convert once; an interrupted transport cannot', async () => {
        fixture.manager.recoverEmbeddedStream.mockRejectedValueOnce(new DOMException('decode failed', 'NotSupportedError'));
        policy.hooks.failure({ type: 'MEDIA_DECODE_ERROR' }, fixture.player);
        await vi.waitFor(() => expect(fixture.manager.renegotiateEmbeddedStream).toHaveBeenCalledTimes(1));
        expect(policy.compatibilityActive()).toBe(true);
        expect(fixture.manager.renegotiateEmbeddedStream.mock.calls[0][3]).toEqual({ audio: 2, subtitle: -1, compatibility: true });
    });
    it('a transport reopen failure ends without changing the quality profile', async () => {
        fixture.manager.recoverEmbeddedStream.mockRejectedValueOnce(new Error('network interrupted'));
        policy.hooks.failure({ type: 'NETWORK_ERROR' }, fixture.player);
        await vi.waitFor(() => expect(hostParent.postMessage.mock.calls.some(([value]) => value.state?.code === 'PLAYBACK_FAILED')).toBe(true));
        expect(policy.compatibilityActive()).toBe(false);
        expect(fixture.manager.play).toHaveBeenCalledTimes(1);
    });
    it('exit invalidates a pending recovery and concurrent faults share one operation', async () => {
        let release;
        fixture.manager.recoverEmbeddedStream.mockImplementationOnce(() => new Promise(resolve => {
            release = resolve;
        }));
        policy.hooks.failure({ type: 'NETWORK_ERROR' }, fixture.player);
        policy.hooks.failure({ type: 'NETWORK_ERROR' }, fixture.player);
        await vi.waitFor(() => expect(fixture.manager.recoverEmbeddedStream).toHaveBeenCalledTimes(1));
        send('stop');
        release(false);
        await Promise.resolve();
        await Promise.resolve();
        expect(fixture.manager.play).toHaveBeenCalledTimes(1);
    });
    it('retains an unfinished seek and explicit pause intent instead of a reset media element state', async () => {
        policy.hooks.pauseIntent(fixture.player, true);
        policy.hooks.seekIntent(fixture.player, 900000000);
        policy.hooks.noteFailure({ status: 410 });
        policy.hooks.failure({ type: 'SERVER_ERROR' }, fixture.player);
        await vi.waitFor(() => expect(fixture.manager.renegotiateEmbeddedStream).toHaveBeenCalledTimes(1));
        expect(fixture.manager.renegotiateEmbeddedStream.mock.calls[0][1]).toBe(900000000);
        await vi.waitFor(() => expect(fixture.manager.pause).toHaveBeenCalledOnce());
    });
});
