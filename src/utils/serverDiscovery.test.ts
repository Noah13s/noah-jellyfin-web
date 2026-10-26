import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverServer, normalizeDiscoveryAddress } from './serverDiscovery';

afterEach(() => vi.useRealTimers());
const response = (config: unknown) => new Response(JSON.stringify(config));

describe('public server discovery', () => {
    it.each(['file:///private/config', 'data:text/plain,unsafe', 'https://user:secret@example.com',
        '/relative', 'https://example.com?token=secret', 'https://example.com/#fragment',
        'https://example.com/\nsecret', null])('rejects unsafe candidate %s before fetching', async value => {
        const fetchInfo = vi.fn();
        expect(normalizeDiscoveryAddress(value)).toBeUndefined();
        expect(await discoverServer([value], fetchInfo)).toBeUndefined();
        expect(fetchInfo).not.toHaveBeenCalled();
    });

    it('preserves cross-origin base paths and deduplicates normalized URLs without credentials', async () => {
        const fetchInfo = vi.fn(async () => response({ StartupWizardCompleted: true }));
        expect(await discoverServer(['https://one.example/jellyfin/', 'https://one.example/jellyfin'], fetchInfo))
            .toBe('https://one.example/jellyfin');
        expect(fetchInfo).toHaveBeenCalledTimes(1);
        expect(fetchInfo).toHaveBeenCalledWith('https://one.example/jellyfin/System/Info/Public', expect.objectContaining({
            credentials: 'omit', redirect: 'error', cache: 'no-cache', signal: expect.any(AbortSignal)
        }));
    });

    it('prefers the unfinished setup wizard and tolerates unavailable/invalid responses', async () => {
        const fetchInfo = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(response({ StartupWizardCompleted: true }))
            .mockResolvedValueOnce(response({ StartupWizardCompleted: false }))
            .mockResolvedValueOnce(response(null))
            .mockResolvedValueOnce(new Response(null, { status: 500 }))
            .mockResolvedValueOnce(new Response('<invalid JSON>'));
        expect(await discoverServer(['https://offline', 'https://ready', 'https://setup/base', 'https://null', 'https://bad', 'https://json'], fetchInfo))
            .toBe('https://setup/base');
    });

    it('aborts a hanging candidate and still returns a working server', async () => {
        vi.useFakeTimers();
        const fetchInfo = vi.fn()
            .mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            }))
            .mockResolvedValueOnce(response({ StartupWizardCompleted: true }));
        const result = discoverServer(['https://hanging', 'https://ready'], fetchInfo);
        await vi.advanceTimersByTimeAsync(10000);
        expect(await result).toBe('https://ready');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('also bounds response-body stalls when AbortController is unavailable', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('AbortController', undefined);
        try {
            const fetchInfo = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => { /* Simulate a stalled response body. */ }) });
            const result = discoverServer(['https://hanging'], fetchInfo);
            await vi.advanceTimersByTimeAsync(10000);
            expect(await result).toBeUndefined();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
