import { expect, it, vi } from 'vitest';
import { replaceOwnedStream } from './handoff';

it('waits for the owned encoder release before opening its replacement', async () => {
    const order = [];
    let finishRelease;
    const pending = replaceOwnedStream({ valid: () => true,
        stopLocal: async () => {
            order.push('local');
        },
        releasePrevious: () => new Promise(resolve => {
            order.push('release');
            finishRelease = resolve;
        }),
        open: async () => {
            order.push('open');
        }
    });
    await vi.waitFor(() => expect(order).toEqual(['local', 'release']));
    finishRelease();
    expect(await pending).toBe(true);
    expect(order).toEqual(['local', 'release', 'open']);
});
it('never allocates another encoder when release fails or the owner exits', async () => {
    const open = vi.fn();
    await expect(replaceOwnedStream({ valid: () => true, stopLocal: async () => undefined,
        releasePrevious: async () => {
            throw new Error('release deadline');
        }, open
    })).rejects.toThrow('release deadline');
    let active = true;
    expect(await replaceOwnedStream({ valid: () => active, stopLocal: async () => undefined,
        releasePrevious: async () => {
            active = false;
        }, open
    })).toBe(false);
    expect(open).not.toHaveBeenCalled();
});
