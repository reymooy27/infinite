const cleanupRegistry = new Map<string, () => void>();

export function registerTerminalCleanup(windowId: string, cleanup: () => void) {
  cleanupRegistry.set(windowId, cleanup);
}

export function unregisterTerminalCleanup(windowId: string) {
  cleanupRegistry.delete(windowId);
}

export function triggerTerminalCleanup(windowId: string) {
  const cleanup = cleanupRegistry.get(windowId);
  if (cleanup) {
    cleanup();
    cleanupRegistry.delete(windowId);
  }
}

export function triggerTerminalTabCleanup(windowId: string, tabId: string) {
  const cleanup = cleanupRegistry.get(`${windowId}:${tabId}`);
  if (cleanup) {
    cleanup();
    cleanupRegistry.delete(`${windowId}:${tabId}`);
  }
}