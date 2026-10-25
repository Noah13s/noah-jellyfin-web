import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { setControlLabel } from './controlLabel';
const readTemplate = path => {
    let location = dirname(fileURLToPath(import.meta.url));
    const parts = path.split('/');
    for (const part of parts) {
        if (part !== '..' && !readdirSync(location).includes(part)) {
            throw new Error(`Template path has missing or incorrectly cased segment: ${part}`);
        }
        location = join(location, part);
    }
    return readFileSync(location, 'utf8');
};
const playback = readTemplate('../components/playbackSettings/playbackSettings.template.html');
const display = readTemplate('../components/displaySettings/displaySettings.template.html');
const metadata = readTemplate('../components/metadataEditor/metadataEditor.template.html');
const subtitles = readTemplate('../components/subtitlesettings/subtitlesettings.template.html');
const video = readTemplate('../apps/legacy/controllers/playback/video/index.html');

describe.each(['input', 'select', 'textarea'])('dynamic %s label', tag => {
    it('updates the accessible name when the localized visible label changes', () => {
        const control = document.createElement(tag);
        const label = document.createElement('label');
        control.setAttribute('aria-label', 'Episode number');
        setControlLabel(control, label, 'Numéro de saison');
        expect(label.innerText).toBe('Numéro de saison');
        expect(control.getAttribute('aria-label')).toBe('Numéro de saison');
    });
});

describe.each([['playback', playback], ['display', display], ['metadata', metadata], ['subtitles', subtitles]])('%s settings', (_name, html) => {
    it('exposes its custom controls by name even before custom-element upgrade', () => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const controls = [...doc.querySelectorAll('input[label], select[label], textarea[label]')];
        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls) {
            expect(control.getAttribute('aria-label')).toBe(control.getAttribute('label'));
        }
    });
});

it('gives the video timeline and volume separate accessible names', () => {
    const doc = new DOMParser().parseFromString(video, 'text/html');
    expect(doc.querySelector('.osdPositionSlider').getAttribute('aria-label')).toBe('${LabelTime}');
    expect(doc.querySelector('.osdVolumeSlider').getAttribute('aria-label')).toBe('${LabelVolume}');
});
