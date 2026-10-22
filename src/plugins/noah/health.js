/** Stable classifications; never publish URLs, tokens or raw exceptions. */
export function classifyFailure({ type = '', status, message = '' } = {}) {
    const value = `${type} ${message}`.toLowerCase();
    if (status === 507 || /insufficient storage|transcode storage|transcode capacity|no space left|storage budget/.test(value)) return 'capacity';
    if (status === 401 || status === 403) return 'authentication';
    if (/subtitle|ass_render|libass|webvtt/.test(value)) return 'subtitle';
    if (status === 404 || status === 410) return 'missingSegment';
    if (status >= 500 || /network|timeout|socket|connection|server_error/.test(value)) return 'network';
    if (/decode|media_not_supported|notsupportederror|mediasource|bufferappend|buffer_append/.test(value)) return 'decoder';
    return 'unknown';
}

/** A bounded owner-local retry budget. Transport errors cannot reduce quality. */
export class PlaybackHealth {
    constructor() {
        this.sameStream = 0;
        this.compatibility = false;
        this.lastRecovery = -Infinity;
        this.lastAdvance = 0;
        this.healthySince = null;
        this.position = 0;
    }
    sample({ now, position, active, paused, seeking, ended, buffering, bufferedAhead, presentationAt }) {
        if (!active || paused || seeking || ended) {
            this.lastAdvance = now;
            this.position = position;
            this.healthySince = null;
            return null;
        }
        if (presentationAt !== undefined && now - presentationAt >= 12000 && bufferedAhead >= 1) return 'decoder';
        if (Math.abs(position - this.position) > 0.1) {
            this.lastAdvance = now;
            this.position = position;
            this.healthySince ??= now;
            if (now - this.healthySince >= 60000) {
                this.sameStream = 0;
                this.compatibility = false;
            }
        }
        if (now - this.lastAdvance < 12000) return null;
        this.lastAdvance = now;
        this.healthySince = null;
        return buffering && bufferedAhead < 1 ? 'network' : 'decoder';
    }
    next(category, now) {
        if (category === 'subtitle') return 'ignore';
        // The authenticated parent owns renewal. Do not try another encoder with
        // rejected credentials or consume additional server capacity.
        if (category === 'authentication' || category === 'capacity') return 'terminal';
        if (now - this.lastRecovery < 10000) return 'terminal';
        this.lastRecovery = now;
        this.healthySince = null;
        if (this.sameStream < 2) {
            this.sameStream++;
            return category === 'missingSegment' ? 'refresh' : 'same';
        }
        if (category === 'decoder' && this.allowCompatibility()) return 'compatibility';
        return 'terminal';
    }
    allowCompatibility() {
        if (this.compatibility) return false;
        this.compatibility = true;
        return true;
    }
}
