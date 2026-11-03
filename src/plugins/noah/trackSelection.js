/** Deliberate track choices survive an embedded-player replacement, not a file replacement. */
const storageKey = 'noah-track-selection:v1';
const lifetime = 30 * 24 * 3600000;
const capacity = 64;
const validIndex = (kind, index) => Number.isInteger(index) && index >= (kind === 'subtitle' ? -1 : 0) && index <= 1000;
const signature = stream => JSON.stringify([
    stream.Type, stream.Language || '', stream.Codec || '', stream.Title || '',
    stream.Channels || 0, !!stream.IsExternal, !!stream.IsForced, !!stream.IsHearingImpaired
]);
const scopeFor = api => {
    const server = api?.serverId?.() || api?.basePath;
    const user = api?.getCurrentUserId?.();
    return server && user ? JSON.stringify([server, user]) : null;
};
const etag = source => source.ETag || source.Etag || null;
const streamFor = (source, kind, index) => source.MediaStreams?.find(entry => entry.Index === index && entry.Type === (kind === 'audio' ? 'Audio' : 'Subtitle'));
function validChoice(source, kind, choice) {
    if (!choice || !validIndex(kind, choice.index)) return false;
    if (kind === 'subtitle' && choice.index === -1) return true;
    const stream = streamFor(source, kind, choice.index);
    return !!stream && signature(stream) === choice.signature;
}
function optionsFor(record, item) {
    const source = item.MediaSources?.find(entry => entry.Id === record.sourceId && etag(entry) === record.etag);
    if (!source) return null;
    const result = {};
    for (const kind of ['audio', 'subtitle']) {
        if (validChoice(source, kind, record[kind])) result[`${kind}StreamIndex`] = record[kind].index;
    }
    return Object.keys(result).length ? { mediaSourceId: source.Id, ...result } : null;
}

export function createTrackSelections({ storage = () => window.localStorage, now = () => Date.now() } = {}) {
    let memory = [];
    let storageFailed = false;
    const read = () => {
        try {
            if (!storageFailed) {
                const saved = JSON.parse(storage().getItem(storageKey) || '[]');
                if (Array.isArray(saved)) memory = saved;
            }
        } catch { storageFailed = true; }
        memory = memory.filter(record => record && Number.isFinite(record.at)
            && now() >= record.at && now() - record.at < lifetime).slice(-capacity);
        return memory;
    };
    return {
        remember(api, itemId, source, kind, index) {
            const scope = scopeFor(api);
            if (!scope || !itemId || !source?.Id || !['audio', 'subtitle'].includes(kind) || !validIndex(kind, index)) return false;
            const stream = streamFor(source, kind, index);
            if (index !== -1 && !stream) return false;
            const records = read();
            const previous = records.find(record => record.scope === scope && record.itemId === itemId && record.sourceId === source.Id);
            const record = previous?.etag === etag(source) ? { ...previous } : {};
            Object.assign(record, { scope, itemId, sourceId: source.Id, etag: etag(source), at: now(),
                [kind]: { index, signature: index === -1 ? null : signature(stream) } });
            memory = [...records.filter(entry => entry !== previous), record].slice(-capacity);
            try {
                if (!storageFailed) storage().setItem(storageKey, JSON.stringify(memory));
            } catch { storageFailed = true; }
            return true;
        },
        restore(api, item) {
            const scope = scopeFor(api);
            if (!scope || !item?.Id) return {};
            const records = read().filter(record => record.scope === scope && record.itemId === item.Id).reverse();
            for (const record of records) {
                const result = optionsFor(record, item);
                if (result) return result;
            }
            return {};
        }
    };
}
