/** Bounded per-frame-owner timings. Only allowlisted labels/numbers are kept. */
export class PlaybackTelemetry {
    constructor(now = () => performance.now()) {
        this.now = now;
        this.started = now();
        this.events = [];
        this.samples = new Map();
        this.trace = `web-${Date.now()}-${Math.floor(now() * 1000)}`;
    }
    record(phase, { durationMs, bytes, status, category, succeeded } = {}) {
        if (!/^[a-zA-Z0-9_-]{1,48}$/.test(phase)) return;
        const entry = { phase, elapsedMs: this.now() - this.started };
        for (const [key, value] of Object.entries({ durationMs, bytes, status })) {
            if (Number.isFinite(value) && value >= 0) entry[key] = value;
        }
        if (typeof succeeded === 'boolean') entry.succeeded = succeeded;
        if (/^[a-zA-Z0-9_-]{1,48}$/.test(category || '')) entry.category = category;
        this.events.push(entry);
        if (this.events.length > 128) this.events.shift();
        if (entry.durationMs !== undefined && (this.samples.has(phase) || this.samples.size < 24)) {
            const values = this.samples.get(phase) || [];
            values.push(entry.durationMs);
            if (values.length > 64) values.shift();
            this.samples.set(phase, values);
        }
    }
    snapshot() {
        const metrics = {};
        for (const [key, values] of this.samples) {
            const sorted = [...values].sort((a, b) => a - b);
            metrics[key] = { count: values.length, p50Ms: sorted[Math.round((sorted.length - 1) * 0.5)], p95Ms: sorted[Math.round((sorted.length - 1) * 0.95)] };
        }
        return { trace: this.trace, events: this.events.map(value => ({ ...value })), metrics };
    }
}
