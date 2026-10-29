/** Seerr playback policy. Called explicitly by the native player/manager. */
import { mediaTransfer, retainedBudget } from './throughput';
const parameters = new URLSearchParams(window.location.search);
export const embedded = window.parent !== window && parameters.get('seerrAutoplay') === '1';
export const castFrame = window.parent !== window && parameters.get('seerrCast') === '1';
export const targetId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('id');
export const local = embedded && !castFrame && /^[a-f0-9-]{16,80}$/i.test(parameters.get('seerrBridgeId') || '') && /^[a-f0-9]{32}$/i.test(targetId || '');
export function preferSafariMse(browser, mediaType, mediaSource) {
    return local && !compatibility && browser.safari && !browser.iOS && mediaType === 'Video'
        && !!mediaSource?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E"');
}
export const hooks = {
    bindVideo: () => undefined,
    captureReport: () => undefined,
    captureSource: () => undefined,
    failure: () => false,
    noteFailure: () => undefined,
    metric: () => undefined,
    pauseIntent: () => undefined,
    seekIntent: () => undefined,
    enter: () => false,
    ticket: () => 0,
    current: () => true,
    close: () => undefined
};
let currentVideo;
export function getVideo() {
    return currentVideo;
}
export function setVideo(video) {
    currentVideo = video;
}
// More than one local plugin advertises Video (including YouTube). Select the
// native HTML player through the explicit preparation contract owned here.
export function nativeVideoPlayer(players) {
    return players.find(player => typeof player.prepareEmbedded === 'function');
}
const clone = value => JSON.parse(JSON.stringify(value));
const network = () => {
    const connection = Reflect.get(navigator, 'connection');
    return [connection?.type, connection?.effectiveType, connection?.saveData].join(':');
};
const now = () => Date.now();
let identityApi;
const keyFor = api => `${(api.basePath || api.serverAddress?.() || '').replace(/\/$/, '')}:${api.getCurrentUserId?.() || identityApi?.getCurrentUserId?.() || ''}:${network()}`;
const capabilities = new Map();
const items = new Map();
const decisions = new Map();
const readySources = new Map();
const hints = new Map();
const stable = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort((a, b) => a.localeCompare(b)).map(key => [key, entry[key]])) : entry);
const decisionKey = query => {
    const identity = { ...query };
    delete identity.IsPlayback;
    delete identity.AutoOpenLiveStream;
    return stable(identity);
};
let apiForBudget;
let initialBudget;
let budgetKey;
let started = 0;
let firstFrame = 0;
let count = 0;
let rates = [];
let automatic = true;
let lastAdaptation = 0;
let adaptation;
let activeVideo;
let compatibility = parameters.get('seerrCompatibility') === '1';
export const diagnostics = {
    samples: [],
    suppressedProbes: 0,
    adaptations: 0
};
try {
    const recovery = JSON.parse(sessionStorage.getItem(`seerr-playback-recovery:${targetId}`) || 'null');
    compatibility ||= !!recovery && now() >= recovery.at && now() - recovery.at < 12 * 3600000;
} catch { /* Recovery memory is optional. */ }
export function setCompatibility(value = true) {
    compatibility = value;
    decisions.clear();
}
export const compatibilityActive = () => compatibility;
function estimate(api) {
    try {
        const saved = JSON.parse(sessionStorage.getItem(`seerr-stream-throughput:${keyFor(api)}`) || 'null');
        return retainedBudget(saved, now());
    } catch { /* Use the conservative existing policy. */ }
    return 4000000;
}
export function beginBudget(api, retain = false) {
    if (api.getCurrentUserId) identityApi = api;
    const key = keyFor(api);
    if (!retain || budgetKey !== key) initialBudget = estimate(api);
    apiForBudget = api;
    budgetKey = key;
    started = performance.now();
    firstFrame = 0;
    count = 0;
    rates = [];
    diagnostics.initialBitrate = initialBudget;
}
const locked = () => performance.now() - started < 20000 && (!firstFrame || count < 4 || performance.now() - firstFrame < 8000);
export function savedBudget(api, mediaType, saved, enabled) {
    if (!local || mediaType !== 'Video') return saved;
    automatic = enabled === true;
    if (!automatic) return saved;
    if (!initialBudget || budgetKey !== keyFor(api)) beginBudget(api);
    return locked() ? initialBudget : estimate(api);
}
export function detectBudget(api, measure) {
    if (!local) return measure();
    diagnostics.suppressedProbes++;
    if (!initialBudget || budgetKey !== keyFor(api)) beginBudget(api);
    return Promise.resolve(locked() ? initialBudget : estimate(api));
}
export function holdAutomaticChange(options, current) {
    if (!local || !options?.enableAutomaticBitrateDetection) return false;
    const desired = locked() ? initialBudget : estimate(apiForBudget);
    return locked() || !!current && Math.abs(desired - current) / current < 0.2;
}
export function observeThroughput(manager, player) {
    if (!local || !window.PerformanceObserver) return () => undefined;
    adaptation = () => manager.setMaxStreamingBitrate({
        enableAutomaticBitrateDetection: true
    }, player);
    // eslint-disable-next-line compat/compat -- Optional observer is guarded above; native HLS may omit it.
    const observer = new window.PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            const sample = apiForBudget && mediaTransfer(entry, window.location.origin, targetId);
            if (!sample) continue;
            const { bytes, bodyMs, waitMs, bps, deliveryBps, kind } = sample;
            hooks.metric(`${kind}Headers`, { durationMs: waitMs, bytes, status: entry.responseStatus });
            hooks.metric(`${kind}Body`, { durationMs: bodyMs, bytes, status: entry.responseStatus });
            count++;
            rates.push(bps);
            if (rates.length > 6) rates.shift();
            const sorted = [...rates].sort((a, b) => a - b);
            try {
                if (rates.length >= 3) {
                    sessionStorage.setItem(`seerr-stream-throughput:${keyFor(apiForBudget)}`, JSON.stringify({
                        at: now(),
                        source: 'video-body-v2',
                        count: rates.length,
                        bps: sorted[Math.floor((sorted.length - 1) / 2)]
                    }));
                }
            } catch { /* Optional. */ }
            diagnostics.samples.push({
                kind,
                bytes,
                ttfbMs: Math.round(waitMs),
                bodyMs: Math.round(bodyMs),
                deliveryBps: Math.round(deliveryBps)
            });
            if (diagnostics.samples.length > 30) diagnostics.samples.shift();
            if (!automatic || locked() || rates.length < 4 || performance.now() - lastAdaptation < 45000 || !activeVideo || activeVideo.paused || activeVideo.seeking || manager.playMethod(player) !== 'Transcode') continue;
            const desired = estimate(apiForBudget);
            const current = manager.getMaxStreamingBitrate(player);
            const buffer = activeVideo.buffered.length ? activeVideo.buffered.end(activeVideo.buffered.length - 1) - activeVideo.currentTime : 0;
            if (desired < current * 0.7 && buffer < 5 || desired > current * 1.7 && buffer > 20 && performance.now() - firstFrame > 30000) {
                lastAdaptation = performance.now();
                diagnostics.adaptations++;
                adaptation();
            }
        }
    });
    observer.observe({
        type: 'resource',
        buffered: false
    });
    return () => observer.disconnect();
}
export function videoPlaying(video) {
    activeVideo = video;
    firstFrame ||= performance.now();
    if (compatibility && targetId) {
        const start = video.currentTime;
        const remember = () => {
            if (video.currentTime - start < 3) return;
            try {
                sessionStorage.setItem(`seerr-playback-recovery:${targetId}`, JSON.stringify({
                    at: now()
                }));
            } catch { /* Optional. */ }
            video.removeEventListener('timeupdate', remember);
        };
        video.addEventListener('timeupdate', remember);
    }
}
export async function cachedProfile(item, options, load) {
    if (!local || options?.isRetry) return load();
    let preferences;
    try {
        preferences = Object.keys(localStorage).filter(key => /prefer|subtitle|audio|bitrate|resolution|hdr|codec/i.test(key) && !/^maxbitrate-/i.test(key)).sort((a, b) => a.localeCompare(b)).map(key => [key, localStorage.getItem(key)]);
    } catch {
        return load();
    }
    const key = stable([navigator.userAgent, item?.Type, preferences]);
    const cached = capabilities.get(key);
    if (cached && now() - cached.at < 120000) return clone(cached.value);
    const value = await load();
    if (capabilities.size >= 4) capabilities.delete(capabilities.keys().next().value);
    capabilities.set(key, {
        at: now(),
        value: clone(value)
    });
    return value;
}
export function normalizeMedia(data) {
    if (!local || !data) return data;
    const normalized = clone(data);
    for (const source of [normalized, ...(normalized.MediaSources || []), ...(normalized.Items || [])]) {
        for (const stream of source.MediaStreams || []) {
            if (stream.Type !== 'Subtitle' || !/^(ass|ssa)$/i.test(stream.Codec || '') || stream.DeliveryMethod === 'Encode') continue;
            stream.Codec = 'subrip';
            if (stream.DeliveryUrl) stream.DeliveryUrl = stream.DeliveryUrl.replace(/\.(?:ass|ssa)\b/i, '.vtt');
        }
    }
    return normalized;
}
export function normalizeSubtitle(data) {
    if (!local) return data;
    const at = performance.now();
    let template;
    for (const event of data.TrackEvents || []) {
        if (typeof event.Text !== 'string') continue;
        if (!/[<&>]/.test(event.Text)) {
            event.Text = event.Text.replace(/\n/g, '<br>');
            continue;
        }
        template ||= document.createElement('template');
        template.innerHTML = event.Text.replace(/<br\s*\/?>/gi, '\n');
        event.Text = (template.content.textContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
    hooks.metric('subtitleNormalize', { durationMs: performance.now() - at });
    return data;
}
export function rememberItem(api, item) {
    if (!local) return;
    items.set(`${keyFor(api)}:${item.Id}`, {
        at: now(),
        value: JSON.stringify(normalizeMedia(clone(item)))
    });
    if (items.size > 4) items.delete(items.keys().next().value);
}
export async function getItem(api, user, id) {
    const cached = local && items.get(`${keyFor(api)}:${id}`);
    if (cached && now() - cached.at < 120000 && user === api.getCurrentUserId()) return JSON.parse(cached.value);
    return normalizeMedia(await api.getItem(user, id));
}
export function adaptRequest(query) {
    if (!local || !query.DeviceProfile) return query;
    const value = clone(query);
    const profile = value.DeviceProfile;
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent);
    const edge = /Android/.test(navigator.userAgent) && /EdgA\//.test(navigator.userAgent);
    if (apple || edge || compatibility) {
        profile.DirectPlayProfiles = (profile.DirectPlayProfiles || []).map(entry => entry.Type !== 'Video' ? entry : {
            ...entry,
            Container: (entry.Container || '').split(',').filter(container => !/^(mkv|matroska)$/i.test(container)).join(',')
        }).filter(entry => entry.Type !== 'Video' || entry.Container);
    }
    profile.TranscodingProfiles = (profile.TranscodingProfiles || []).map(entry => entry.Type !== 'Video' || entry.Protocol !== 'hls' ? entry : {
        ...entry,
        MinSegments: 1,
        SegmentLength: 2,
        ...(apple ? {
            Container: 'ts',
            VideoCodec: 'h264',
            AudioCodec: 'aac'
        } : {}),
        ...(compatibility ? {
            VideoCodec: 'h264',
            AudioCodec: 'aac',
            MaxAudioChannels: '2'
        } : {})
    });
    if (automatic && initialBudget && locked()) {
        value.MaxStreamingBitrate = Math.min(Number(value.MaxStreamingBitrate) || initialBudget, initialBudget);
        profile.MaxStreamingBitrate = Math.min(Number(profile.MaxStreamingBitrate) || initialBudget, initialBudget);
    }
    if (compatibility) {
        value.EnableDirectPlay = value.EnableDirectStream = false;
        value.MaxStreamingBitrate = Math.min(value.MaxStreamingBitrate || 4000000, profile.MaxStreamingBitrate || 4000000, 4000000);
        profile.MaxStreamingBitrate = value.MaxStreamingBitrate;
        value.MaxAudioChannels = 2;
        profile.CodecProfiles = [...(profile.CodecProfiles || []), {
            Type: 'Video',
            Conditions: [{
                Condition: 'LessThanEqual',
                Property: 'Width',
                Value: '1280',
                IsRequired: true
            }, {
                Condition: 'LessThanEqual',
                Property: 'Height',
                Value: '720',
                IsRequired: true
            }]
        }];
    }
    return value;
}
export async function playbackInfo(api, item, query, request) {
    if (!local) return request(query);
    const adapted = adaptRequest(query);
    const key = `${keyFor(api)}:${item.Id}:${decisionKey(adapted)}`;
    const cached = decisions.get(key);
    if (cached && now() - cached.at < 20000 && !cached.value.MediaSources.some(source => source.RequiresOpening)) {
        decisions.delete(key);
        return clone(cached.value);
    }
    return normalizeMedia(await request(adapted));
}
export async function prepareDecision(api, item, query, request) {
    const ticket = hooks.ticket();
    const adapted = adaptRequest(query);
    const value = normalizeMedia(await request({ ...adapted, IsPlayback: false, AutoOpenLiveStream: false }));
    if (hooks.current(ticket) && value.MediaSources?.length && !value.MediaSources.some(source => source.RequiresOpening)) {
        if (decisions.size >= 4) decisions.delete(decisions.keys().next().value);
        decisions.set(`${keyFor(api)}:${item.Id}:${decisionKey(adapted)}`, {
            at: now(),
            value: clone(value)
        });
    }
    return value;
}
export async function prepareStreamReady(api, item) {
    const source = item.MediaSources?.[0];
    if (!local || !source?.Id || !/^(mkv|matroska)$/i.test(source.Container || '') || /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)) return;
    // eslint-disable-next-line compat/compat -- Optional warm-up has a bounded abort deadline on supported embedded clients.
    const controller = new window.AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    try {
        const response = await fetch(api.getUrl(`Videos/${item.Id}/stream.mkv`, {
            Static: true,
            MediaSourceId: source.Id
        }), {
            method: 'HEAD',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
                Authorization: `MediaBrowser Token="${api.accessToken()}"`
            }
        });
        const key = response.headers.get('X-Seerr-Stream-Ready');
        if (response.ok && /^[a-f0-9]{64}$/.test(key || '')) {
            readySources.set(item.Id.toLowerCase(), {
                key,
                source: source.Id.toLowerCase()
            });
        }
    } catch { /* Use the original media for this playback. */ } finally {
        clearTimeout(timer);
    }
}
export function streamUrl(input, resumeTicks) {
    if (!local) return input;
    try {
        const url = new URL(input, window.location.href);
        if (url.origin !== window.location.origin || !/\/videos\/[^/]+\//i.test(url.pathname)) return input;
        const direct = /\/videos\/([a-f0-9]{32})\/stream\.mkv$/i.exec(url.pathname);
        const ready = direct && readySources.get(direct[1].toLowerCase());
        const parameter = name => [...url.searchParams].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
        if (ready && parameter('MediaSourceId')?.toLowerCase() === ready.source) url.searchParams.set('seerrStreamReady', ready.key);
        const session = parameter('PlaySessionId');
        if (session && Number.isSafeInteger(resumeTicks)) {
            if (resumeTicks > 0) {
                hints.set(session, resumeTicks);
            } else {
                hints.delete(session);
            }
        }
        if (session && /\/hls1\/[^/]+\/-1\.mp4$/i.test(url.pathname) && hints.has(session)) url.searchParams.set('seerrStartTicks', `${hints.get(session)}`);
        if (hints.size > 32) hints.delete(hints.keys().next().value);
        return url.toString();
    } catch {
        return input;
    }
}
