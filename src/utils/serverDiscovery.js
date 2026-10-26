const DISCOVERY_TIMEOUT_MS = 10000;

/** config.json may specify cross-origin servers and reverse-proxy prefixes. */
export function normalizeDiscoveryAddress(value) {
    if (typeof value !== 'string' || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)
            || url.username || url.password || url.search || url.hash) return;
        let address = url.href;
        while (address.endsWith('/')) address = address.slice(0, -1);
        return address;
    } catch {
        return undefined;
    }
}

/** Public discovery must not send a logged-in browser's cookies to candidates. */
export async function discoverServer(candidates, fetchInfo = globalThis.fetch) {
    const addresses = [...new Set(candidates.map(normalizeDiscoveryAddress).filter(Boolean))];
    const responses = await Promise.all(addresses.map(async url => {
        // eslint-disable-next-line compat/compat -- Optional API; the timeout race also supports legacy browsers.
        const controller = typeof window.AbortController === 'function' ? new window.AbortController() : undefined;
        let timer;
        try {
            const request = fetchInfo(`${url}/System/Info/Public`, {
                cache: 'no-cache',
                credentials: 'omit',
                redirect: 'error',
                signal: controller?.signal
            }).then(async response => {
                if (!response.ok) return;
                const config = await response.json();
                if (config && typeof config === 'object' && !Array.isArray(config)) {
                    return { url, config };
                }
            });
            return await Promise.race([request, new Promise((_resolve, reject) => {
                timer = setTimeout(() => {
                    controller?.abort();
                    reject(new Error('Server discovery timed out'));
                }, DISCOVERY_TIMEOUT_MS);
            })]);
        } catch {
            // An unavailable candidate must not prevent another server's setup.
        } finally {
            clearTimeout(timer);
        }
    }));
    const configs = responses.filter(Boolean);
    return (configs.find(entry => !entry.config.StartupWizardCompleted) || configs[0])?.url;
}
