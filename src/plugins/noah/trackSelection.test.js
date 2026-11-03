import { beforeEach, describe, expect, it } from 'vitest';
import { createTrackSelections } from './trackSelection';

const api = (user = 'lena', server = 'server') => ({ serverId: () => server, getCurrentUserId: () => user });
const movie = () => ({ Id: 'movie', MediaSources: [{ Id: 'source', ETag: 'original', MediaStreams: [
    { Type: 'Audio', Index: 3, Language: 'pol', Codec: 'dts', Channels: 6, IsDefault: true },
    { Type: 'Audio', Index: 4, Language: 'fra', Codec: 'dts', Channels: 6 },
    { Type: 'Subtitle', Index: 5, Language: 'eng', Codec: 'ass' }
] }] });
const remember = (store, item = movie(), kind = 'audio', index = 4) => store.remember(api(), item.Id, item.MediaSources[0], kind, index);
beforeEach(() => localStorage.clear());

describe('deliberate embedded track choices', () => {
    it('restores French on a Polish-default source across a complete player-module replacement', () => {
        remember(createTrackSelections());
        expect(createTrackSelections().restore(api(), movie())).toEqual({ mediaSourceId: 'source', audioStreamIndex: 4 });
    });
    it('keeps subtitles off alongside the selected audio', () => {
        const store = createTrackSelections();
        remember(store);
        remember(store, movie(), 'subtitle', -1);
        expect(createTrackSelections().restore(api(), movie())).toEqual({ mediaSourceId: 'source', audioStreamIndex: 4, subtitleStreamIndex: -1 });
    });
    it('restores a selected subtitle track and lets the latest deliberate choice win', () => {
        const store = createTrackSelections();
        remember(store, movie(), 'subtitle', -1);
        remember(store, movie(), 'subtitle', 5);
        expect(store.restore(api(), movie())).toEqual({ mediaSourceId: 'source', subtitleStreamIndex: 5 });
    });
    it('isolates accounts, servers, items and media sources', () => {
        const store = createTrackSelections();
        remember(store);
        expect(store.restore(api('other'), movie())).toEqual({});
        expect(store.restore(api('lena', 'other'), movie())).toEqual({});
        expect(store.restore(api(), { ...movie(), Id: 'another-movie' })).toEqual({});
        const item = movie();
        item.MediaSources[0].Id = 'another-source';
        expect(store.restore(api(), item)).toEqual({});
    });
    it('rejects a replaced file even when it kept the same source and stream indices', () => {
        const store = createTrackSelections();
        remember(store);
        const item = movie();
        item.MediaSources[0].ETag = 'replacement';
        expect(store.restore(api(), item)).toEqual({});
    });
    it('does not select a different language when metadata changes at the saved index', () => {
        const store = createTrackSelections();
        remember(store);
        const item = movie();
        item.MediaSources[0].MediaStreams[1].Language = 'pol';
        expect(store.restore(api(), item)).toEqual({});
    });
    it('does not reuse missing tracks or reinterpret an audio index as a subtitle', () => {
        const store = createTrackSelections();
        remember(store);
        const item = movie();
        item.MediaSources[0].MediaStreams = [{ Type: 'Subtitle', Index: 4, Language: 'fra', Codec: 'dts', Channels: 6 }];
        expect(store.restore(api(), item)).toEqual({});
        item.MediaSources[0].MediaStreams = [];
        expect(store.restore(api(), item)).toEqual({});
    });
    it('retains an independently valid subtitle choice when the audio track disappears', () => {
        const store = createTrackSelections();
        remember(store);
        remember(store, movie(), 'subtitle', -1);
        const item = movie();
        item.MediaSources[0].MediaStreams.splice(1, 1);
        expect(store.restore(api(), item)).toEqual({ mediaSourceId: 'source', subtitleStreamIndex: -1 });
    });
    it('rejects invalid choices and incomplete account identity', () => {
        const store = createTrackSelections();
        for (const index of [-1, 1.2, 99, 1001, NaN]) expect(remember(store, movie(), 'audio', index)).toBe(false);
        expect(store.remember(api(''), 'movie', movie().MediaSources[0], 'audio', 4)).toBe(false);
        expect(store.remember(api(), 'movie', movie().MediaSources[0], 'invalid', 4)).toBe(false);
        expect(store.restore(api(), movie())).toEqual({});
    });
    it('expires old choices and ignores future timestamps', () => {
        let at = 100;
        const store = createTrackSelections({ now: () => at });
        remember(store);
        at = 99;
        expect(createTrackSelections({ now: () => at }).restore(api(), movie())).toEqual({});
        at += 31 * 24 * 3600000;
        expect(store.restore(api(), movie())).toEqual({});
    });
    it('bounds retained choices by recency', () => {
        const store = createTrackSelections();
        for (let n = 0; n < 70; n++) remember(store, { ...movie(), Id: `movie-${n}` });
        expect(store.restore(api(), { ...movie(), Id: 'movie-0' })).toEqual({});
        expect(store.restore(api(), { ...movie(), Id: 'movie-69' })).toHaveProperty('audioStreamIndex', 4);
        expect(JSON.parse(localStorage.getItem('noah-track-selection:v1'))).toHaveLength(64);
    });
    it('handles blocked, quota-limited and malformed storage without breaking playback', () => {
        for (const storage of [() => { throw new Error('denied'); }, () => ({ getItem: () => '[]', setItem: () => { throw new Error('quota'); } })]) {
            const store = createTrackSelections({ storage });
            expect(remember(store)).toBe(true);
            expect(store.restore(api(), movie())).toHaveProperty('audioStreamIndex', 4);
        }
        localStorage.setItem('noah-track-selection:v1', '{');
        expect(createTrackSelections().restore(api(), movie())).toEqual({});
    });
    it('merges changes written by separate live frames instead of dropping the other track', () => {
        const audio = createTrackSelections(), subtitle = createTrackSelections();
        remember(audio);
        remember(subtitle, movie(), 'subtitle', -1);
        expect(audio.restore(api(), movie())).toEqual({ mediaSourceId: 'source', audioStreamIndex: 4, subtitleStreamIndex: -1 });
    });
});
