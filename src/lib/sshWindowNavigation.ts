import { getSSHMetadata, type WindowData } from "@/types";

export interface SSHTerminalTarget {
  windowId: string;
  tabId: string;
}

export function getVisibleSSHWindows(windows: WindowData[]) {
  return windows
    .filter((win) => win.appId === "ssh" && !win.minimized)
    .sort((a, b) => b.z - a.z);
}

export function getVisibleSSHTerminals(
  windows: WindowData[],
): SSHTerminalTarget[] {
  return getVisibleSSHWindows(windows).flatMap((win) => {
    const meta = getSSHMetadata(win);
    const tabs = meta?.tabs ?? [];

    return tabs.map((tab) => ({
      windowId: win.id,
      tabId: tab.id,
    }));
  });
}

export function getNextSSHTerminalTarget(
  windows: WindowData[],
  currentWindowId?: string | null,
  currentTabId?: string | null,
) {
  const terminals = getVisibleSSHTerminals(windows);
  if (terminals.length < 2 || !currentWindowId || !currentTabId) return null;

  const currentIndex = terminals.findIndex(
    (terminal) =>
      terminal.windowId === currentWindowId && terminal.tabId === currentTabId,
  );
  if (currentIndex === -1) return terminals[0] ?? null;

  return terminals[(currentIndex + 1) % terminals.length] ?? null;
}

export function getPrevSSHTerminalTarget(
  windows: WindowData[],
  currentWindowId?: string | null,
  currentTabId?: string | null,
) {
  const terminals = getVisibleSSHTerminals(windows);
  if (terminals.length < 2 || !currentWindowId || !currentTabId) return null;

  const currentIndex = terminals.findIndex(
    (terminal) =>
      terminal.windowId === currentWindowId && terminal.tabId === currentTabId,
  );
  if (currentIndex === -1) return terminals[terminals.length - 1] ?? null;

  return terminals[(currentIndex - 1 + terminals.length) % terminals.length] ?? null;
}
