import { describe, expect, it, vi } from 'vitest';
import { createProtocol } from './protocol';

function fixture(handle = vi.fn().mockResolvedValue({ position: 12, duration: 60 })) {
    let listener;
    const parent = { postMessage: vi.fn() };
    const host = { parent, location: { origin: 'https://stream.example' }, addEventListener: (_name, fn) => { listener = fn; }, removeEventListener: vi.fn() };
    const bridge = createProtocol(host, 'fixture-frame', handle);
    bridge.ready();
    const send = (data, options = {}) => listener({ source: parent, origin: host.location.origin, data: { channel: 'noah-player', version: 1, frameId: 'fixture-frame', kind: 'command', id: 'one', action: 'play', ...data }, ...options });
    return { bridge, parent, host, send, handle };
}

describe('Seerr playback protocol', () => {
    it('rejects other origins, frames, versions and generations', async () => {
        const f = fixture();
        f.send({}, { origin: 'https://other.example' });
        f.send({}, { source: {} });
        f.send({ version: 2 });
        f.send({ frameId: 'stale-frame' });
        f.send({ action: 'arbitraryMethod' });
        await Promise.resolve();
        expect(f.handle).not.toHaveBeenCalled();
    });

    it('acknowledges repeated request IDs without executing Play twice', async () => {
        const f = fixture();
        f.send({});
        f.send({});
        await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(f.parent.postMessage.mock.calls.filter(([message]) => message.kind === 'reply')).toHaveLength(2));
        expect(f.parent.postMessage.mock.calls.at(-1)[0]).toMatchObject({ kind: 'reply', id: 'one', ok: true, state: { position: 12 } });
    });

    it('serializes commands while allowing Stop to cancel an opening player', async () => {
        let release;
        const events = [];
        const f = fixture(vi.fn(async action => {
            events.push(action);
            if (action === 'play') await new Promise(resolve => { release = resolve; });
            return {};
        }));
        f.send({});
        await vi.waitFor(() => expect(events).toEqual(['play']));
        f.send({ id: 'two', action: 'seek' });
        f.send({ id: 'three', action: 'stop' });
        expect(events).toEqual(['play', 'stop']);
        release();
        await vi.waitFor(() => expect(f.parent.postMessage.mock.calls.some(([message]) => message.id === 'two' && message.code === 'PLAYER_STOPPED')).toBe(true));
        expect(events).toEqual(['play', 'stop']);
    });

    it('recovers the queue after a rejected command and sanitizes errors', async () => {
        const f = fixture(vi.fn().mockRejectedValueOnce(new Error('secret-bearing error')).mockResolvedValue({ position: 14 }));
        f.send({});
        f.send({ id: 'two', action: 'pause' });
        await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(f.parent.postMessage.mock.calls.some(([message]) => message.code === 'PLAYER_COMMAND_FAILED')).toBe(true));
        expect(JSON.stringify(f.parent.postMessage.mock.calls)).not.toContain('secret-bearing');
    });
});
