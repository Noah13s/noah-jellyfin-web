/** Authenticated page boundaries remain in Seerr; this channel carries no tokens. */
export const PROTOCOL = 'noah-player';
export const VERSION = 1;
const ACTIONS = new Set(['play', 'pause', 'resume', 'seek', 'audio', 'subtitle', 'state', 'stop']);
export function createProtocol(host, frameId, handle) {
    let ready = false;
    let disposed = false;
    let tail = Promise.resolve();
    const replies = new Map();
    const send = message => host.parent.postMessage({
        channel: PROTOCOL,
        version: VERSION,
        frameId,
        ...message
    }, host.location.origin);
    const receive = event => {
        const message = event.data;
        if (event.source !== host.parent || event.origin !== host.location.origin || !message || message.channel !== PROTOCOL || message.version !== VERSION || message.frameId !== frameId) return;
        if (message.kind === 'hello') {
            if (ready && !disposed) {
                send({
                    kind: 'event',
                    event: 'ready'
                });
            }
            return;
        }
        if (message.kind !== 'command' || typeof message.id !== 'string' || message.id.length > 100 || !ACTIONS.has(message.action)) return;
        if (replies.has(message.id)) {
            void replies.get(message.id).then(send);
            return;
        }
        const execute = async () => {
            if (disposed && message.action !== 'state') throw new Error('PLAYER_STOPPED');
            return handle(message.action, message.payload || {});
        };
        // Stop cancels the generation immediately, including a pending open.
        const operation = message.action === 'stop' ? execute() : tail.then(execute);
        const response = operation.then(state => ({
            kind: 'reply',
            id: message.id,
            ok: true,
            state
        }), error => ({
            kind: 'reply',
            id: message.id,
            ok: false,
            code: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'PLAYER_COMMAND_FAILED'
        }));
        if (message.action === 'stop') disposed = true;
        tail = response.then(() => undefined);
        replies.set(message.id, response);
        if (replies.size > 64) replies.delete(replies.keys().next().value);
        void response.then(send);
    };
    host.addEventListener('message', receive);
    return {
        ready() {
            ready = true;
            if (!disposed) {
                send({
                    kind: 'event',
                    event: 'ready'
                });
            }
        },
        emit(event, state) {
            if (!disposed) {
                send({
                    kind: 'event',
                    event,
                    state
                });
            }
        },
        dispose() {
            disposed = true;
            host.removeEventListener('message', receive);
            replies.clear();
        }
    };
}
