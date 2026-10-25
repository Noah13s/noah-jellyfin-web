/** Keep dynamic visible labels and pre-upgrade accessible names consistent. */
export function setControlLabel(control, label, text) {
    label.innerText = text;
    control.setAttribute('aria-label', text);
}
