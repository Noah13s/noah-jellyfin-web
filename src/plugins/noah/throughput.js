/** Passive observations only: no probes, URLs, tokens or media payloads kept. */
export function mediaTransfer(entry, origin, itemId) {
    let url;
    try {
        url = new URL(entry.name);
    } catch {
        return;
    }
    if (url.origin !== origin || !/^[a-f0-9]{32}$/i.test(itemId || '')) return;
    const resource = /\/videos\/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(.+)$/i.exec(url.pathname);
    if (!resource || resource[1].replace(/-/g, '').toLowerCase() !== itemId.toLowerCase()) return;
    const segment = /^(?:hls1\/[^/]+\/\d+\.(?:mp4|ts)|[^/]+\.ts)$/i.test(resource[2]);
    const direct = /^stream(?:\.(?:mkv|mp4|webm|mov|m4v))?$/i.test(resource[2]);
    // Only completed, successful range transfers qualify for original files.
    // Native HLS entries lacking timing/size evidence stay unmeasured.
    if (!segment && !(direct && entry.responseStatus === 206)) return;
    if (entry.responseStatus && ![200, 206].includes(entry.responseStatus)) return;
    const bytes = entry.encodedBodySize;
    const bodyMs = entry.responseEnd - entry.responseStart;
    const waitMs = entry.responseStart - entry.requestStart;
    if (![bytes, bodyMs, waitMs, entry.transferSize].every(Number.isFinite)
        || entry.transferSize <= 0 || bytes < 32768 || bodyMs < 20 || bodyMs > 120000 || waitMs < 0
        || entry.responseStart <= 0) return;
    return { bytes, bodyMs, waitMs, bps: Math.min(200000000, bytes * 8000 / bodyMs),
        deliveryBps: bytes * 8000 / (waitMs + bodyMs), kind: segment ? 'segment' : 'range' };
}

export function retainedBudget(saved, now) {
    if (saved?.source !== 'video-body-v2' || saved.count < 3 || !Number.isFinite(saved.bps)
        || saved.bps <= 0 || !Number.isFinite(saved.at) || now < saved.at || now - saved.at >= 1800000) return 4000000;
    return Math.min(80000000, Math.max(256000, Math.round(saved.bps * 0.7)));
}
