// Project switch blurs the focused field and briefly suppresses terminal autoFocus,
// so switching on mobile never re-pops the virtual keyboard. Cooldown must cover
// canvas fetch → terminal remount → autoFocus, hence 2s.
const COOLDOWN_MS = 2000;

let lastSwitchAt = 0;

export function markProjectSwitch() {
  lastSwitchAt = Date.now();
}

export function isProjectSwitchSuppressingFocus() {
  return Date.now() - lastSwitchAt < COOLDOWN_MS;
}
