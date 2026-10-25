/** Inclusive calendar days. Advance the cursor explicitly, preserving local DST. */
export function guideDates(start, end) {
    const dates = [];
    for (let cursor = new Date(start.getTime()); cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
        dates.push(cursor);
    }
    return dates;
}
