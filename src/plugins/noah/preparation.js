/** Refresh only a selected, visible, unopened item, for a bounded reading window. */
export function refreshPreparation(refresh, active, { interval = 15000, lifetime = 120000 } = {}) {
    const deadline = Date.now() + lifetime;
    let timer;
    let cancelled = false;
    const schedule = () => {
        if (cancelled || Date.now() + interval >= deadline) return;
        timer = setTimeout(async () => {
            if (cancelled || Date.now() >= deadline) return;
            if (active()) {
                try {
                    await refresh();
                } catch { /* Play can request a fresh decision. */ }
            }
            schedule();
        }, interval);
    };
    schedule();
    return () => {
        cancelled = true;
        clearTimeout(timer);
    };
}
