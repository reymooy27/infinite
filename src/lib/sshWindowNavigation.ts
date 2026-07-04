import type { WindowData } from "@/types";

export function getVisibleSSHWindows(windows: WindowData[]) {
  return windows
    .filter((win) => win.appId === "ssh" && !win.minimized)
    .sort((a, b) => b.z - a.z);
}

export function getNextSSHWindowId(
  windows: WindowData[],
  currentWindowId?: string | null,
) {
  const sshWindows = getVisibleSSHWindows(windows);
  if (sshWindows.length < 2 || !currentWindowId) return null;

  const currentIndex = sshWindows.findIndex((win) => win.id === currentWindowId);
  if (currentIndex === -1) return sshWindows[0]?.id ?? null;

  return sshWindows[(currentIndex + 1) % sshWindows.length]?.id ?? null;
}
