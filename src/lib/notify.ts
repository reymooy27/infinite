export function clip(s: string, n = 180): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * OS notification, fired only while the tab is in the background — a visible
 * tab already shows the state change. Deduped per `tag`: repeated events
 * (e.g. permission.updated) collapse into one entry instead of stacking.
 */
export function notify(title: string, body: string, tag: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!document.hidden && document.hasFocus()) return;
  const n = new Notification(title, { body: clip(body), icon: "/icon-192.png", tag });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}
