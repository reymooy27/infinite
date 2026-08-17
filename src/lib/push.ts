import { api } from "./api";

type KeyResponse = { publicKey: string; enabled: boolean };

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Subscribe this browser to web push and register it with the server.
 * Safe to call repeatedly — reuses an existing subscription when present.
 * Must be called from a user gesture: requestPermission() needs one.
 */
export async function enablePush(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  // Secure-context check goes first: on plain HTTP (non-localhost) the browser
  // does not expose serviceWorker/PushManager at all, so a support check here
  // would blame the browser for what is actually a transport problem.
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: `Butuh HTTPS. Sekarang diakses lewat ${window.location.origin} — pakai https:// atau localhost.`,
    };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Browser tidak mendukung web push" };
  }

  const { publicKey, enabled } = await api.get<KeyResponse>("/api/push/key");
  if (!enabled || !publicKey) {
    return { ok: false, reason: "Server belum punya VAPID key" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Izin notifikasi ditolak" };
  }

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  await api.post("/api/push/subscribe", sub.toJSON());
  return { ok: true };
}

/** Unsubscribe this browser and drop the server-side record. */
export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api.delete("/api/push/subscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/** True when this browser already has an active push subscription. */
export async function isPushEnabled(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) !== null;
}
