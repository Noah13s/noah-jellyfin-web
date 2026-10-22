/** Retire the old local reader and owned encoder before allocating a replacement.
 * A failed/expired release must not start another encoder on top of it.
 */
export async function replaceOwnedStream({ valid, stopLocal, releasePrevious, open }) {
    if (!valid()) return false;
    await stopLocal();
    if (!valid()) return false;
    await releasePrevious();
    if (!valid()) return false;
    await open();
    return valid();
}
