import { describe, expect, it } from 'vitest';
import music from './music/music.html?raw';
import shows from './shows/tvrecommended.html?raw';
import live from './livetv.html?raw';

describe.each([
    ['music', music, ['playlistsTab', 'songsTab', 'genresTab']],
    ['shows', shows, ['genresTab', 'studiosTab']],
    ['live', live, ['channelsTab', 'seriesTab']]
])('%s tab containers', (_name, html, tabs) => {
    it('has unique IDs and one independently addressable items container per tab', () => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const ids = Array.from(doc.querySelectorAll('[id]'), node => node.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const tab of tabs) {
            expect(doc.getElementById(tab)?.querySelectorAll('.itemsContainer, .genreSections').length).toBe(1);
        }
    });
});
