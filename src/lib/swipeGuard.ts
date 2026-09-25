// A completed swipe gesture briefly suppresses terminal auto-focus, so
// swipe-switching terminals never pops the virtual keyboard — including the
// fresh terminal that mounts after switching to another window.
const COOLDOWN_MS = 400;

let lastSwipeAt = 0;

export function markSwipe() {
  lastSwipeAt = Date.now();
}

export function isSwipeSuppressed() {
  return Date.now() - lastSwipeAt < COOLDOWN_MS;
}
