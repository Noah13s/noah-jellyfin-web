import ResizeObserver from 'resize-observer-polyfill';
import Events from '../../utils/events';
import { playbackManager as manager } from '../../components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { createProtocol } from './protocol';
import * as policy from './policy';
import { classifyFailure, PlaybackHealth } from './health';
import { PlaybackTelemetry } from './telemetry';
import { refreshPreparation } from './preparation';
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
const health = new PlaybackHealth();
const telemetry = new PlaybackTelemetry();
let recentFailure;
let lastPosition = 0;
let lastReportAt = 0;
let startTimer;
let watchdog;
let disconnectThroughput;
let cancelPreparation;
let finalReport;
let sourceCleanup = () => undefined;
let recovering;
let generation = 0;
let changingUntil = 0;
let buffering = false;
let playAt;
let presentationAt;
let framePending = false;
let healthFrameCallback;
let pausedIntent = false;
let pendingSeek;
let presentedOnce = false;
let recoveryAt;
const onVisibility = () => {
    presentationAt = performance.now();
};
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
    if (recovering) await recovering;
    if (stopped) throw new Error('PLAYER_STOPPED');
    const commandAt = performance.now();
    if (['seek', 'audio', 'subtitle'].includes(action)) changingUntil = commandAt + 12000;
    switch (action) {
        case 'play':
            await play(payload.resumeTicks);
            break;
        case 'pause':
            pausedIntent = true;
            manager.pause(player);
            break;
        case 'resume':
            pausedIntent = false;
            manager.unpause(player);
            break;
        case 'seek':
            if (!Number.isFinite(payload.position) || payload.position < 0 || payload.position > 86400) throw new Error('INVALID_POSITION');
            pendingSeek = payload.position;
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
    telemetry.record(`${action}Ack`, { durationMs: performance.now() - commandAt });
    return snapshot();
}) : null;
function armStartDeadline() {
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
        if (!playing && !stopped) void recover(recentFailure?.category || (buffering ? 'network' : 'unknown'));
    }, 30000);
}
async function play(ticks) {
    if (opened || stopped) return;
    if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 864000000000) ticks = prepared.resume;
    opened = true;
    cancelPreparation?.();
    pausedIntent = false;
    playAt = performance.now();
    telemetry.record('playIntent');
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
async function recover(category = 'unknown') {
    if (recovering) return recovering;
    recovering = recoverOnce(category).catch(() => {
        if (!stopped) {
            telemetry.record('recoveryFailed', { category });
            protocol?.emit('error', { ...snapshot(), code: 'PLAYBACK_FAILED' });
            stop();
        }
    }).finally(() => {
        recovering = null;
    });
    return recovering;
}
async function recoverOnce(category) {
    if (stopped) return;
    let mode = health.next(category, performance.now());
    if (mode === 'compatibility' && policy.compatibilityActive()) mode = 'terminal';
    telemetry.record('recovery', { category: `${category}_${mode}` });
    if (mode === 'ignore') return;
    if (mode === 'terminal') {
        let code = 'PLAYBACK_FAILED';
        if (category === 'capacity') code = 'PLAYBACK_CAPACITY';
        if (category === 'authentication') code = 'PLAYBACK_AUTHENTICATION';
        protocol?.emit('error', {
            ...snapshot(),
            code
        });
        stop();
        return;
    }
    const state = snapshot();
    // Destroying a failed MSE source can reset paused/currentTime. Preserve the
    // user's intent, including a seek that failed before producing its frame.
    state.paused = pausedIntent;
    state.position = pendingSeek ?? state.position;
    const ticket = ++generation;
    recoveryAt = performance.now();
    const valid = () => generationActive(ticket);
    const audio = manager.getAudioStreamIndex(player);
    const subtitle = manager.getSubtitleStreamIndex(player);
    playing = false;
    protocol?.emit('recovering', state);
    armStartDeadline();
    if (mode === 'same') {
        try {
            if (await manager.recoverEmbeddedStream(player, Math.round(state.position * 10000000), valid)) {
                if (valid() && state.paused) manager.pause(player);
                return;
            }
        } catch (error) {
            const failed = classifyFailure({ type: error?.name, status: error?.status, message: error?.message });
            if (!valid() || category !== 'decoder' || !['decoder', 'unknown'].includes(failed)
                || policy.compatibilityActive() || !health.allowCompatibility()) throw error;
            mode = 'compatibility';
            telemetry.record('recovery', { category: 'decoder_compatibility' });
        }
    }
    if (!valid()) return;
    if (mode === 'compatibility') policy.setCompatibility();
    armStartDeadline();
    const replaced = await manager.renegotiateEmbeddedStream(player, Math.round(state.position * 10000000), valid,
        { audio, subtitle, compatibility: mode === 'compatibility' });
    if (valid() && !replaced) throw new Error('PLAYBACK_REPLACEMENT_FAILED');
    if (valid() && state.paused) manager.pause(player);
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
    telemetry.record('stop');
    generation++;
    clearTimeout(startTimer);
    clearInterval(watchdog);
    cancelPreparation?.();
    document.removeEventListener('visibilitychange', onVisibility);
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
    if (!policy.local) return;
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
    const sourceOpenedAt = performance.now();
    let frameCallback;
    let waitingAt;
    let seekAt;
    const update = () => {
        if (stopped) return;
        const state = snapshot();
        lastPosition = state.position;
        if (!recovering && pendingSeek !== undefined && !element.seeking && element.readyState >= 2 && Math.abs(state.position - pendingSeek) < 2) pendingSeek = undefined;
        if (performance.now() - lastReportAt > 1000) {
            lastReportAt = performance.now();
            protocol?.emit('position', state);
        }
    };
    const onPlaying = () => {
        if (stopped) return;
        policy.videoPlaying(video);
        buffering = false;
        // Allow a fresh presentation deadline after pause/background/source
        // transitions; this timestamp is not emitted as frame evidence.
        presentationAt = performance.now();
        if (waitingAt !== undefined) telemetry.record('buffering', { durationMs: performance.now() - waitingAt });
        waitingAt = undefined;
        if (frameSource === video.currentSrc && playing) return;
        frameSource = video.currentSrc;
        const ticket = generation;
        const presented = () => {
            if (!generationActive(ticket)) return;
            playing = true;
            clearTimeout(startTimer);
            protocol?.emit('firstFrame', snapshot());
            presentationAt = performance.now();
            if (pendingSeek !== undefined && Math.abs(snapshot().position - pendingSeek) < 2) pendingSeek = undefined;
            let phase = video.requestVideoFrameCallback ? 'presentedFrame' : 'playingEvent';
            if (presentedOnce) phase = video.requestVideoFrameCallback ? 'replacementFrame' : 'replacementPlaying';
            const since = presentedOnce ? recoveryAt ?? sourceOpenedAt : playAt ?? telemetry.started;
            telemetry.record(phase, { durationMs: performance.now() - since });
            presentedOnce = true;
            recoveryAt = undefined;
        };
        if (video.requestVideoFrameCallback) {
            frameCallback = video.requestVideoFrameCallback(presented);
        } else {
            presented();
        }
    };
    const onWaiting = () => {
        if (!element.paused && !element.seeking) {
            buffering = true;
            waitingAt ??= performance.now();
        }
    };
    const onSeeking = () => {
        seekAt = performance.now();
        changingUntil = seekAt + 12000;
    };
    const onSeeked = () => {
        changingUntil = 0;
        const startedAt = seekAt;
        seekAt = undefined;
        if (startedAt === undefined) return;
        telemetry.record('seekSettled', { durationMs: performance.now() - startedAt });
        // A paused seek may not present a new frame until resume. Record only
        // when the browser actually gives presentation evidence.
        if (element.requestVideoFrameCallback && !element.paused) {
            const ticket = generation;
            frameCallback = element.requestVideoFrameCallback(() => {
                if (generationActive(ticket)) telemetry.record('seekFrame', { durationMs: performance.now() - startedAt });
            });
        }
    };
    const onEmptied = () => {
        frameSource = '';
    };
    const onState = () => {
        if (!recovering && !element.seeking && element.readyState >= 2) pausedIntent = element.paused;
        protocol?.emit('state', snapshot());
    };
    video.addEventListener('timeupdate', update);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('emptied', onEmptied);
    for (const event of ['pause', 'seeked', 'ended']) video.addEventListener(event, onState);
    sourceCleanup = () => {
        observer.disconnect();
        element.removeEventListener('loadedmetadata', resize);
        element.removeEventListener('timeupdate', update);
        element.removeEventListener('playing', onPlaying);
        element.removeEventListener('waiting', onWaiting);
        element.removeEventListener('seeking', onSeeking);
        element.removeEventListener('seeked', onSeeked);
        element.removeEventListener('emptied', onEmptied);
        if (frameCallback !== undefined) element.cancelVideoFrameCallback?.(frameCallback);
        if (healthFrameCallback !== undefined) element.cancelVideoFrameCallback?.(healthFrameCallback);
        healthFrameCallback = undefined;
        framePending = false;
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
        cancelPreparation = refreshPreparation(() => manager.getPlaybackMediaSources(item, {
            startPositionTicks: prepared.resume,
            enableRemotePlayers: false,
            seerrPreparing: true
        }), () => !opened && !stopped && !Reflect.get(document, 'hidden'));
        document.addEventListener('visibilitychange', onVisibility);
        watchdog = setInterval(() => {
            if (!video) return;
            let bufferedAhead = 0;
            for (let i = 0; i < video.buffered.length; i++) {
                if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) bufferedAhead = video.buffered.end(i) - video.currentTime;
            }
            const visible = !('hidden' in document) || !Reflect.get(document, 'hidden');
            const active = playing && !stopped && !recovering && visible && performance.now() >= changingUntil;
            // At most one pending presentation callback. Sample at watchdog
            // cadence, not every decoded frame; hidden/paused video is excluded.
            if (active && !video.paused && !video.seeking && video.requestVideoFrameCallback && !framePending) {
                framePending = true;
                const ticket = generation;
                healthFrameCallback = video.requestVideoFrameCallback(() => {
                    framePending = false;
                    healthFrameCallback = undefined;
                    if (generationActive(ticket)) presentationAt = performance.now();
                });
            }
            const fault = health.sample({ now: performance.now(), position: video.currentTime,
                active,
                paused: video.paused, seeking: video.seeking, ended: video.ended,
                buffering, bufferedAhead, presentationAt: video.requestVideoFrameCallback ? presentationAt : undefined });
            if (fault) {
                const category = recentFailure && performance.now() - recentFailure.at < 15000 ? recentFailure.category : fault;
                recentFailure = null;
                void recover(category);
            }
        }, 500);
    })().catch(error => {
        telemetry.record('preparationFailed', { category: classifyFailure({ message: error?.message }) });
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
    window.__seerrPlaybackMetrics = () => telemetry.snapshot();
}
Events.on(manager, 'playbackstop', () => {
    if (policy.local && !stopped) protocol?.emit('position', snapshot());
});
Object.assign(policy.hooks, {
    bindVideo,
    captureReport,
    captureSource,
    noteFailure: error => { recentFailure = { category: classifyFailure(error), at: performance.now() }; },
    failure: (error, owner) => {
        if (!policy.local || stopped || owner !== player) return false;
        const category = recentFailure && performance.now() - recentFailure.at < 15000 ? recentFailure.category : classifyFailure(error);
        recentFailure = null;
        void recover(category);
        return true;
    },
    metric: (phase, values) => { if (policy.local) telemetry.record(phase, values); },
    pauseIntent: (owner, value) => {
        if (policy.local && owner === player && !stopped) pausedIntent = value;
    },
    seekIntent: (owner, ticks) => {
        if (policy.local && owner === player && !stopped) pendingSeek = ticks / 10000000;
    },
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
