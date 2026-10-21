import ResizeObserver from 'resize-observer-polyfill';
import Events from '../../utils/events';
import { playbackManager as manager } from '../../components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { createProtocol } from './protocol';
import * as policy from './policy';
import './style.scss';
// Existing Cast transport remains isolated in its persistent sender frame.
import './casting';
import './gestures';
const parameters = new URLSearchParams(window.location.search);
const frameId = parameters.get('seerrBridgeId') || '';
let booting;
let prepared;
let player;
let api;
let item;
let video;
let stopped = false;
let playing = false;
let opened = false;
let recovered = false;
let lastPosition = 0;
let lastAdvance = 0;
let lastReportAt = 0;
let startTimer;
let watchdog;
let disconnectThroughput;
let finalReport;
let sourceCleanup = () => undefined;
let recovering;
let generation = 0;
const listeners = new Set();
export const playbackGeneration = () => generation;
export const generationActive = ticket => !policy.local || !stopped && ticket === generation;
function snapshot() {
    const current = player && manager.currentItem(player);
    const position = current ? manager.getCurrentTicks(player) / 10000000 : 0;
    const duration = current ? manager.duration(player) / 10000000 : 0;
    let state = 'preparing';
    if (prepared) state = 'prepared';
    if (opened) state = 'opening';
    if (playing) state = 'playing';
    if (stopped) state = 'stopped';
    return {
        itemId: current?.Id || item?.Id || policy.targetId,
        seasonNumber: current?.ParentIndexNumber,
        episodeNumber: current?.IndexNumber,
        position: Number.isFinite(position) ? Math.max(0, position) : lastPosition,
        duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
        paused: !video || video.paused,
        state
    };
}
const protocol = policy.local && /^[a-f0-9-]{16,80}$/i.test(frameId) ? createProtocol(window, frameId, async (action, payload) => {
    if (action === 'stop') {
        const state = snapshot();
        stop();
        return state;
    }
    if (action === 'state') return snapshot();
    await booting;
    if (stopped) throw new Error('PLAYER_STOPPED');
    switch (action) {
        case 'play':
            await play(payload.resumeTicks);
            break;
        case 'pause':
            manager.pause(player);
            break;
        case 'resume':
            manager.unpause(player);
            break;
        case 'seek':
            if (!Number.isFinite(payload.position) || payload.position < 0 || payload.position > 86400) throw new Error('INVALID_POSITION');
            manager.seek(payload.position * 10000000, player);
            break;
        case 'audio':
        case 'subtitle':
            if (!Number.isInteger(payload.index) || payload.index < -1 || payload.index > 1000) throw new Error('INVALID_TRACK');
            if (action === 'audio') {
                manager.setAudioStreamIndex(payload.index, player);
            } else {
                manager.setSubtitleStreamIndex(payload.index, player);
            }
            break;
        default:
            throw new Error('INVALID_COMMAND');
    }
    return snapshot();
}) : null;
function armStartDeadline() {
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
        if (!playing && !stopped) void recover();
    }, recovered ? 45000 : 30000);
}
async function play(ticks) {
    if (opened || stopped) return;
    if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 864000000000) ticks = prepared.resume;
    opened = true;
    generation++;
    policy.beginBudget(api, true);
    const candidate = JSON.parse(prepared.item);
    candidate.UserData = {
        ...candidate.UserData,
        PlaybackPositionTicks: ticks
    };
    policy.rememberItem(api, candidate);
    armStartDeadline();
    await manager.play({
        items: [candidate],
        startPositionTicks: ticks,
        enableRemotePlayers: false
    });
}
async function recover() {
    if (recovering) return recovering;
    recovering = recoverOnce().finally(() => {
        recovering = null;
    });
    return recovering;
}
async function recoverOnce() {
    if (stopped) return;
    if (recovered) {
        protocol?.emit('error', {
            ...snapshot(),
            code: 'PLAYBACK_FAILED'
        });
        stop();
        return;
    }
    const state = snapshot();
    recovered = true;
    generation++;
    playing = false;
    protocol?.emit('recovering', state);
    releaseEncoding();
    await manager.stop(player);
    if (stopped) return;
    policy.setCompatibility();
    const candidate = JSON.parse(prepared.item);
    candidate.UserData = {
        ...candidate.UserData,
        PlaybackPositionTicks: Math.round(state.position * 10000000)
    };
    policy.rememberItem(api, candidate);
    armStartDeadline();
    await manager.play({
        items: [candidate],
        startPositionTicks: candidate.UserData.PlaybackPositionTicks,
        enableRemotePlayers: false
    });
}
function releaseEncoding() {
    if (!api || !finalReport?.PlaySessionId) return;
    const url = api.getUrl('Videos/ActiveEncodings', {
        deviceId: api.deviceId(),
        playSessionId: finalReport.PlaySessionId
    });
    void fetch(url, {
        method: 'DELETE',
        keepalive: true,
        headers: {
            Authorization: `MediaBrowser Token="${api.accessToken()}"`
        }
    }).catch(() => undefined);
}
function stop() {
    if (stopped) return;
    stopped = true;
    generation++;
    clearTimeout(startTimer);
    clearInterval(watchdog);
    disconnectThroughput?.();
    sourceCleanup();
    if (api && finalReport) {
        const body = {
            ...finalReport,
            PositionTicks: Math.round(Math.max(0, lastPosition) * 10000000)
        };
        void fetch(api.getUrl('Sessions/Playing/Stopped'), {
            method: 'POST',
            keepalive: true,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `MediaBrowser Token="${api.accessToken()}"`
            },
            body: JSON.stringify(body)
        }).catch(() => undefined);
    }
    releaseEncoding();
    if (player) void manager.stop(player);
}
export function captureReport(reportApi, data) {
    if (!policy.local || stopped || !data?.ItemId) return;
    api = reportApi;
    finalReport = {
        ...data
    };
    lastPosition = Math.max(0, (data.PositionTicks || 0) / 10000000);
}
export function captureSource(sourceApi, sourceItem, result) {
    if (!policy.local || stopped || !result?.PlaySessionId) return;
    api = sourceApi;
    finalReport = {
        ItemId: sourceItem.Id,
        PlaySessionId: result.PlaySessionId,
        PositionTicks: sourceItem.UserData?.PlaybackPositionTicks || 0
    };
}
export function bindVideo(element, owner) {
    if (!policy.local || video === element) return;
    if (owner) player = owner;
    sourceCleanup();
    video = element;
    policy.setVideo(element);
    const resize = () => {
        const rect = element.getBoundingClientRect();
        const height = element.videoWidth ? Math.min(rect.height, rect.width * element.videoHeight / element.videoWidth) : rect.height;
        document.documentElement.style.setProperty('--seerr-video-height', `${height}px`);
        document.documentElement.style.setProperty('--seerr-subtitle-bottom', `${(rect.height - height) / 2 + height * 0.04}px`);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    element.addEventListener('loadedmetadata', resize);
    let frameSource = '';
    const update = () => {
        if (stopped) return;
        const state = snapshot();
        if (Math.abs(state.position - lastPosition) > 0.15 && !video.seeking) lastAdvance = performance.now();
        lastPosition = state.position;
        if (performance.now() - lastReportAt > 1000) {
            lastReportAt = performance.now();
            protocol?.emit('position', state);
        }
    };
    const onPlaying = () => {
        if (stopped) return;
        policy.videoPlaying(video);
        lastAdvance = performance.now();
        if (frameSource === video.currentSrc) return;
        frameSource = video.currentSrc;
        const ticket = generation;
        const presented = () => {
            if (!generationActive(ticket)) return;
            playing = true;
            clearTimeout(startTimer);
            protocol?.emit('firstFrame', snapshot());
        };
        if (video.requestVideoFrameCallback) {
            video.requestVideoFrameCallback(presented);
        } else {
            presented();
        }
    };
    const onState = () => protocol?.emit('state', snapshot());
    video.addEventListener('timeupdate', update);
    video.addEventListener('playing', onPlaying);
    for (const event of ['pause', 'seeked', 'ended']) video.addEventListener(event, onState);
    sourceCleanup = () => {
        observer.disconnect();
        element.removeEventListener('loadedmetadata', resize);
        element.removeEventListener('timeupdate', update);
        element.removeEventListener('playing', onPlaying);
        for (const event of ['pause', 'seeked', 'ended']) element.removeEventListener(event, onState);
    };
    for (const listener of listeners) listener(element);
}
export function onVideo(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function enterEmbedded() {
    if (!policy.local) return false;
    if (booting) return true;
    booting = (async () => {
        api = ServerConnections.currentApiClient();
        player = policy.nativeVideoPlayer(manager.getPlayers());
        if (!api?.getCurrentUserId() || !player || !protocol) throw new Error('PLAYER_UNAVAILABLE');
        policy.beginBudget(api);
        disconnectThroughput = policy.observeThroughput(manager, player);
        item = await policy.getItem(api, api.getCurrentUserId(), policy.targetId);
        if (stopped) return;
        item.ServerId = api.serverId();
        policy.rememberItem(api, item);
        const value = parameters.get('seerrResumeTicks');
        const resume = value !== null && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : item.UserData?.PlaybackPositionTicks || 0;
        // Capture before native movie playlist mutation can add circular references.
        prepared = {
            item: JSON.stringify(item),
            resume
        };
        protocol.ready();
        await Promise.allSettled([policy.prepareStreamReady(api, item), player.prepareEmbedded?.(false), manager.getPlaybackMediaSources(item, {
            startPositionTicks: resume,
            enableRemotePlayers: false,
            seerrPreparing: true
        }).then(sources => {
            if ((sources || []).some(source => /\.m3u8(?:\?|$)/i.test(source.TranscodingUrl || '') && !source.SupportsDirectPlay)) return player.prepareEmbedded?.(true);
        })]);
        if (stopped) return;
        protocol.emit('prepared', snapshot());
        watchdog = setInterval(() => {
            if (!playing || stopped || !video || video.paused || video.ended || document.hidden || video.seeking) {
                lastAdvance = performance.now();
                return;
            }
            if (performance.now() - lastAdvance > 12000) {
                lastAdvance = performance.now();
                void recover();
            }
        }, 500);
    })().catch(() => {
        protocol?.emit('error', {
            code: 'PLAYER_PREPARATION_FAILED'
        });
    });
    return true;
}
window.addEventListener('pagehide', event => {
    if (event.isTrusted && (event.target === window || event.target === document)) stop();
});
if (policy.local) {
    document.documentElement.classList.add('noah-embedded-player');
    // Read-only compatibility for the existing party coordinator during migration.
    window.__seerrPlaybackSnapshot = snapshot;
}
Events.on(manager, 'playbackstop', () => {
    if (policy.local && !stopped) protocol?.emit('position', snapshot());
});
Object.assign(policy.hooks, {
    bindVideo,
    captureReport,
    captureSource,
    enter: enterEmbedded,
    ticket: playbackGeneration,
    current: generationActive,
    close: () => {
        protocol?.emit('close');
        stop();
    }
});
export function initializeSeerrIntegration() {
    const initializeCast = window.SeerrCasting;
    initializeCast?.({
        playbackManager: manager,
        ServerConnections
    });
}
