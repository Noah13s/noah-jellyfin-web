// Pre-index immutable cue boundaries once. A minimum heap preserves upstream's
// first-cue ordering even with overlapping, out-of-order or empty dialogue.
const indexes = new WeakMap();
const rendered = new WeakMap();
export const invalidateSubtitleIndex = cues => indexes.delete(cues);
function build(cues) {
    const events = [];
    const heap = [];
    const active = new Set();
    const frames = [];
    const push = value => {
        let i = heap.length;
        heap.push(value);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent] <= value) break;
            heap[i] = heap[parent];
            i = parent;
        }
        heap[i] = value;
    };
    const pop = () => {
        const last = heap.pop();
        if (!heap.length) return;
        let i = 0;
        while (i * 2 + 1 < heap.length) {
            let child = i * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
            if (heap[child] >= last) break;
            heap[i] = heap[child];
            i = child;
        }
        heap[i] = last;
    };
    cues.forEach((cue, id) => {
        const start = cue.StartPositionTicks;
        const end = cue.EndPositionTicks;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
        events.push({ at: start, id, start: true }, { at: end, id, start: false });
    });
    events.sort((a, b) => a.at - b.at);
    for (let i = 0; i < events.length;) {
        const at = events[i].at;
        do {
            const event = events[i++];
            if (event.start) {
                active.add(event.id);
                push(event.id);
            } else {
                active.delete(event.id);
            }
        } while (i < events.length && events[i].at === at);
        while (heap.length && !active.has(heap[0])) pop();
        const cue = heap.length ? cues[heap[0]] : undefined;
        if (!frames.length || frames[frames.length - 1].cue !== cue) frames.push({ at, cue });
    }
    return frames;
}
export function subtitleEventAt(cues, ticks) {
    let frames = indexes.get(cues);
    if (!frames) {
        frames = build(cues);
        indexes.set(cues, frames);
    }
    let low = 0;
    let high = frames.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (frames[middle].at <= ticks) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low ? frames[low - 1].cue : undefined;
}
export function renderSubtitle(element, cue, sanitize) {
    const text = cue?.Text || '';
    if (text) {
        const previous = rendered.get(element);
        if (previous?.text !== text || element.innerHTML !== previous.html) {
            element.innerHTML = previous?.text === text ? previous.html : sanitize(text);
            rendered.set(element, { text, html: element.innerHTML });
        }
        element.classList.remove('hide');
    } else {
        element.classList.add('hide');
    }
}
