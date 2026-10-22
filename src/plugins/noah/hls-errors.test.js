import { afterEach, expect, it, vi } from 'vitest';
import Events from '../../utils/events';
import { bindEventsToHlsPlayer } from '../../components/htmlMediaHelper';
import * as policy from './policy';

vi.mock('./policy', () => ({ local: true, hooks: { noteFailure: vi.fn() } }));
vi.mock('../../scripts/settings/appSettings', () => ({ default: { get: () => undefined } }));
vi.mock('../../scripts/browser', () => ({ default: {} }));
afterEach(() => vi.unstubAllGlobals());

it('reports an HLS HTTP error after successful startup through the manager, not a settled promise', async () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Mirror upstream HLS event constants.
    vi.stubGlobal('Hls', { Events: { MANIFEST_PARSED: 'manifest', ERROR: 'error' }, ErrorTypes: { NETWORK_ERROR: 'network' } });
    const callbacks = {};
    const hls = { on: (event, callback) => {
        callbacks[event] = callback;
    }, destroy: vi.fn() };
    const element = { play: () => Promise.resolve(), addEventListener: vi.fn() };
    const instance = {};
    const opened = vi.fn();
    const rejected = vi.fn();
    const error = vi.fn();
    Events.on(instance, 'error', error);
    bindEventsToHlsPlayer(instance, hls, element, vi.fn(), opened, rejected);
    callbacks.manifest();
    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
    callbacks.error('error', { type: 'network', fatal: true, response: { code: 410 } });
    expect(policy.hooks.noteFailure).toHaveBeenCalledWith(expect.objectContaining({ status: 410 }));
    expect(error).toHaveBeenCalledWith(expect.anything(), { type: 'SERVER_ERROR' });
    expect(rejected).not.toHaveBeenCalled();
});
