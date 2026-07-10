"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, LayoutGrid, Settings, Plus, Terminal, ChevronDown, GitBranch } from "lucide-react";
import { SSHPane } from "@/apps/registry";
import type {
  TmuxManagerState,
  TmuxPaneController,
} from "@/apps/registry";
import FocusModeGitPanel from "@/components/FocusModeGitPanel";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import SettingsPanel from "@/components/SettingsPanel";
import TerminalNextButton from "@/components/TerminalNextButton";
import { getBrowserId } from "@/lib/browserId";
import { getNextSSHTerminalTarget, getVisibleSSHWindows } from "@/lib/sshWindowNavigation";
import { useProjectStore } from "@/stores/useProjectStore";
import { useTerminalSessionStore } from "@/stores/useTerminalSessionStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { getSSHMetadata } from "@/types";

interface FocusModeLayoutProps {
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  onOpenSection: (section: string) => void;
}

function createInitialTmuxState(): TmuxManagerState {
  return {
    connected: false,
    status: "idle",
    sessionName: null,
    activeWindowId: null,
    windows: [],
    message: null,
    selectingWindowId: null,
  };
}

export default function FocusModeLayout({
  switcherOpen,
  setSwitcherOpen,
  onOpenSection,
}: FocusModeLayoutProps) {
  const windows = useWindowStore((s) => s.windows);
  const addTerminalTab = useWindowStore((s) => s.addTerminalTab);
  const closeTerminalTab = useWindowStore((s) => s.closeTerminalTab);
  const setActiveTerminalTab = useWindowStore((s) => s.setActiveTerminalTab);
  const focusModeWindowId = useSettingsStore((s) => s.focusModeWindowId);
  const setFocusModeWindowId = useSettingsStore((s) => s.setFocusModeWindowId);
  const setFocusMode = useSettingsStore((s) => s.setFocusMode);
  const bgColor = useSettingsStore((s) => s.bgColor);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const focusWindow = useWindowStore((s) => s.focusWindow);

  const [paneRefreshKey, setPaneRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<
    "root" | "terminal" | "api-management"
  >("terminal");
  const [tabPanelOpen, setTabPanelOpen] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [tmuxManagerOpen, setTmuxManagerOpen] = useState(false);
  const [tmuxControllers, setTmuxControllers] = useState<Record<string, TmuxPaneController>>({});
  const [tmuxStateByTab, setTmuxStateByTab] = useState<Record<string, TmuxManagerState>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keyboardRafRef = useRef<number | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const tabPanelRef = useRef<HTMLDivElement>(null);
  const tabToggleBtnRef = useRef<HTMLButtonElement>(null);
  const tmuxPopoverRef = useRef<HTMLDivElement>(null);

  const sshWindows = getVisibleSSHWindows(windows);
  const activeWindow =
    sshWindows.find((w) => w.id === focusModeWindowId) ??
    sshWindows[0] ??
    null;
  const activeWindowId = activeWindow?.id ?? null;

  useEffect(() => {
    if (activeWindowId && activeWindowId !== focusModeWindowId) {
      setFocusModeWindowId(activeWindowId);
    }
    if (!activeWindowId && focusModeWindowId) {
      setFocusModeWindowId(null);
    }
  }, [activeWindowId, focusModeWindowId, setFocusModeWindowId]);

  const sshMeta = activeWindow ? getSSHMetadata(activeWindow) : null;
  const tabs = sshMeta?.tabs ?? [];
  const activeTabId = sshMeta?.activeTabId ?? tabs[0]?.id ?? "";
  const nextTerminal = getNextSSHTerminalTarget(windows, activeWindowId, activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const connectionId = (activeTab?.connectionId ?? activeWindow?.metadata?.connectionId) as number | undefined;
  const activeTmuxState =
    tmuxStateByTab[activeTabId] ?? createInitialTmuxState();
  const activeTmuxController = tmuxControllers[activeTabId] ?? null;
  const activeSessionId = activeWindowId && activeTabId ? `${activeWindowId}-${activeTabId}` : "";
  const activeTerminalDirectory = useTerminalSessionStore(
    (s) => (activeSessionId ? s.terminalCwds[activeSessionId] : undefined),
  );
  const getWindowLabel = (windowId: string) => {
    const win = sshWindows.find((item) => item.id === windowId);
    if (!win) return "Terminal";
    const meta = getSSHMetadata(win);
    return (
      (win.metadata?.title as string | undefined) ??
      meta?.tabs.find((tab) => tab.id === meta.activeTabId)?.title ??
      meta?.tabs.find((tab) => tab.id === meta.activeTabId)?.label ??
      meta?.tabs[0]?.title ??
      meta?.tabs[0]?.label ??
      "Terminal"
    );
  };

  const handleExitFocusMode = () => {
    if (activeWindow) {
      focusWindow(activeWindow.id);
    }
    setFocusMode(false);
  };

  const handleAddTab = () => {
    if (!activeWindow) return;
    const newTabId = getBrowserId("tab-");
    setTmuxManagerOpen(false);
    addTerminalTab(activeWindow.id, {
      id: newTabId,
      label: `Tab ${tabs.length + 1}`,
      connectionId,
    });
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (!activeWindow || tabs.length <= 1) return;
    setTmuxManagerOpen(false);
    closeTerminalTab(activeWindow.id, tabId);
  };

  const handleNextWindow = () => {
    if (!nextTerminal) return;
    setTmuxManagerOpen(false);
    setActiveTerminalTab(nextTerminal.windowId, nextTerminal.tabId);
    setFocusModeWindowId(nextTerminal.windowId);
    focusWindow(nextTerminal.windowId);
  };

  const handleTmuxStateChange = (targetTabId: string, state: TmuxManagerState) => {
    setTmuxStateByTab((prev) => ({
      ...prev,
      [targetTabId]: state,
    }));
  };

  const handleTmuxControllerChange = (
    targetTabId: string,
    controller: TmuxPaneController | null,
  ) => {
    if (controller) {
      setTmuxControllers((prev) => ({
        ...prev,
        [targetTabId]: controller,
      }));
      return;
    }

    setTmuxControllers((prev) => {
      if (!(targetTabId in prev)) return prev;
      const next = { ...prev };
      delete next[targetTabId];
      return next;
    });
    setTmuxStateByTab((prev) => {
      if (!(targetTabId in prev)) return prev;
      const next = { ...prev };
      delete next[targetTabId];
      return next;
    });
  };

  const handleToggleTmuxManager = () => {
    if (tmuxManagerOpen) {
      setTmuxManagerOpen(false);
      return;
    }

    setTabPanelOpen(false);
    setTmuxManagerOpen(true);
    activeTmuxController?.refreshWindows();
  };

  const handleSelectTmuxWindow = async (targetWindowId: string) => {
    if (!activeTmuxController) return;
    const ok = await activeTmuxController.selectWindow(targetWindowId);
    if (ok) {
      setTmuxManagerOpen(false);
    }
  };

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node) &&
        settingsBtnRef.current &&
        !settingsBtnRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [settingsOpen]);

  useEffect(() => {
    if (!tabPanelOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        tabPanelRef.current &&
        !tabPanelRef.current.contains(target) &&
        tabToggleBtnRef.current &&
        !tabToggleBtnRef.current.contains(target)
      ) {
        setTabPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [tabPanelOpen]);

  useEffect(() => {
    if (!tmuxManagerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        tmuxPopoverRef.current &&
        !tmuxPopoverRef.current.contains(target)
      ) {
        setTmuxManagerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [tmuxManagerOpen]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    if (!mq.matches) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      if (keyboardRafRef.current !== null) {
        cancelAnimationFrame(keyboardRafRef.current);
      }
      keyboardRafRef.current = requestAnimationFrame(() => {
        const viewportBottom = Math.max(0, vv.height + vv.offsetTop);
        const rawHeight = Math.max(0, window.innerHeight - viewportBottom);
        const h = rawHeight < 80 ? 0 : rawHeight;

        clearTimeout(keyboardTimerRef.current);
        keyboardTimerRef.current = setTimeout(() => {
          setKeyboardHeight((prev) => (Math.abs(prev - h) > 2 ? h : prev));
        }, h === 0 ? 140 : 180);
        keyboardRafRef.current = null;
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      clearTimeout(keyboardTimerRef.current);
      if (keyboardRafRef.current !== null) {
        cancelAnimationFrame(keyboardRafRef.current);
      }
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-full" style={{ backgroundColor: bgColor }}>
      <div className="flex items-center h-10 shrink-0 bg-neutral-950 border-b border-neutral-800 px-1 gap-1">
        <div className="shrink-0 relative z-[10001]">
          <ProjectSwitcher
            embedded
            isOpen={switcherOpen}
            onOpenChange={setSwitcherOpen}
            onOpenSection={onOpenSection}
          />
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setPaneRefreshKey((k) => k + 1)}
            disabled={!activeWindow}
            title="Refresh terminal"
            className="p-1.5 text-neutral-500 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-neutral-800"
          >
            <RefreshCw size={14} />
          </button>

          <div className="relative">
            <button
              ref={settingsBtnRef}
              onClick={() => {
                setSettingsPage("terminal");
                setSettingsOpen((prev) => !prev);
              }}
              title="Terminal settings"
              className={`p-1.5 transition-colors cursor-pointer rounded ${
                settingsOpen
                  ? "text-white bg-neutral-800"
                  : "text-neutral-500 hover:text-white hover:bg-neutral-800"
              }`}
            >
              <Settings size={14} />
            </button>
            {settingsOpen && (
              <div
                ref={settingsRef}
                className="absolute top-full right-0 mt-1 w-72 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-[10000] overflow-y-auto"
                style={{ maxHeight: "min(480px, calc(100vh - 60px))" }}
              >
                <SettingsPanel
                  currentPage={settingsPage}
                  onOpenTerminal={() => setSettingsPage("terminal")}
                  onOpenApiManagement={() => setSettingsPage("api-management")}
                />
              </div>
            )}
          </div>

          <button
            onClick={handleExitFocusMode}
            title="Switch to canvas mode"
            className="p-1.5 text-neutral-500 hover:text-white transition-colors cursor-pointer rounded hover:bg-neutral-800"
          >
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>

      {activeWindow && (
        <div className="shrink-0 bg-neutral-950 border-b border-neutral-800 px-2 py-1 flex items-center gap-2">
          <button
            ref={tabToggleBtnRef}
            onClick={() => setTabPanelOpen((p) => !p)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer border ${
              tabPanelOpen
                ? "bg-neutral-800 text-white border-neutral-700"
                : "text-neutral-300 border-neutral-800 hover:bg-neutral-800 hover:text-white"
            }`}
          >
            <span className="max-w-[8rem] truncate">
              {tabs.find((t) => t.id === activeTabId)?.title ?? tabs.find((t) => t.id === activeTabId)?.label ?? "Tab"}
            </span>
            <ChevronDown size={11} className={`shrink-0 transition-transform ${tabPanelOpen ? "rotate-180" : ""}`} />
          </button>
          <div className="relative" ref={tmuxPopoverRef}>
            <button
              onClick={handleToggleTmuxManager}
              title="Tmux windows"
              className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors cursor-pointer border ${
                tmuxManagerOpen
                  ? "bg-neutral-800 text-white border-neutral-700"
                  : activeTmuxState.connected
                    ? "text-neutral-300 border-neutral-800 hover:bg-neutral-800 hover:text-white"
                    : "text-neutral-600 border-neutral-900 hover:text-neutral-400"
              }`}
            >
              tmux
            </button>
            {tmuxManagerOpen && (
              <div className="absolute right-0 top-full z-[10000] mt-2 w-80 rounded-xl border border-neutral-700 bg-neutral-950/95 p-2 shadow-2xl backdrop-blur">
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <div>
                    <div className="text-[11px] font-medium text-neutral-100">
                      {activeTmuxState.sessionName
                        ? `tmux:${activeTmuxState.sessionName}`
                        : "tmux windows"}
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      {activeTmuxState.connected ? "Current session" : "Terminal disconnected"}
                    </div>
                  </div>
                  <button
                    onClick={() => activeTmuxController?.refreshWindows()}
                    className="rounded-md border border-neutral-700 px-2 py-1 text-[10px] font-mono text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-white"
                  >
                    refresh
                  </button>
                </div>

                {activeTmuxState.status === "loading" && (
                  <div className="px-2 py-4 text-[11px] text-neutral-500">
                    Loading tmux windows...
                  </div>
                )}

                {activeTmuxState.status !== "loading" &&
                  activeTmuxState.windows.length > 0 && (
                    <div className="mt-1 flex max-h-72 flex-col gap-1 overflow-y-auto px-1 pb-1">
                      {activeTmuxState.windows.map((item) => {
                        const isBusy =
                          activeTmuxState.selectingWindowId === item.id;
                        const isActiveWindow =
                          activeTmuxState.activeWindowId === item.id || item.isActive;
                        return (
                          <button
                            key={item.id}
                            onClick={() => void handleSelectTmuxWindow(item.id)}
                            disabled={isBusy}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                              isActiveWindow
                                ? "border-blue-500/60 bg-blue-500/10 text-white"
                                : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-800"
                            } ${isBusy ? "opacity-70" : ""}`}
                          >
                            <span className="min-w-6 text-[10px] font-mono text-neutral-500">
                              {item.index}
                            </span>
                            <span className="flex-1 truncate text-[11px]">
                              {item.name || `window-${item.index}`}
                            </span>
                            <span className="text-[10px] font-mono text-neutral-500">
                              {item.paneCount ?? 0}p
                            </span>
                            {isActiveWindow && (
                              <span className="rounded-full border border-blue-400/40 px-1.5 py-0.5 text-[9px] font-mono text-blue-300">
                                active
                              </span>
                            )}
                            {isBusy && (
                              <span className="text-[9px] font-mono text-neutral-400">
                                switching
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                {activeTmuxState.status !== "loading" &&
                  activeTmuxState.windows.length === 0 && (
                    <div className="px-2 py-4 text-[11px] text-neutral-500">
                      {activeTmuxState.message ?? "Not in tmux session"}
                    </div>
                  )}
              </div>
            )}
          </div>
          <TerminalNextButton
            onClick={handleNextWindow}
            disabled={!nextTerminal}
            iconOnly
            className="px-2.5 py-1 rounded text-xs transition-colors cursor-pointer border text-neutral-300 border-neutral-800 hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center"
          />
          <button
            onClick={() => {
              setGitPanelOpen((prev) => !prev);
              setTabPanelOpen(false);
            }}
            disabled={!activeProjectId}
            title={gitPanelOpen ? "Hide git changes" : "Show git changes"}
            className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer border inline-flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed ${
              gitPanelOpen
                ? "bg-neutral-800 text-white border-neutral-700"
                : "text-neutral-300 border-neutral-800 hover:bg-neutral-800 hover:text-white"
            }`}
          >
            <GitBranch size={14} />
          </button>
        </div>
      )}

      {tabPanelOpen && (
        <div ref={tabPanelRef} className="shrink-0 bg-neutral-950 border-b border-neutral-800 px-2 py-1.5 flex flex-col gap-0.5">
          {sshWindows.map((win) => {
            const isSelected = win.id === activeWindow?.id;
            return (
              <div
                key={win.id}
              onClick={() => {
                setTmuxManagerOpen(false);
                setFocusModeWindowId(win.id);
                setTabPanelOpen(false);
              }}
                className={`flex items-center justify-between px-3 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}
              >
                <span className="truncate">{getWindowLabel(win.id)}</span>
                <span className="ml-2 shrink-0 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                  Win
                </span>
              </div>
            );
          })}
          {sshWindows.length > 0 && tabs.length > 0 && (
            <div className="border-t border-neutral-800 mt-0.5 pt-2" />
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => {
                setTmuxManagerOpen(false);
                if (activeWindow) setActiveTerminalTab(activeWindow.id, tab.id);
                setTabPanelOpen(false);
              }}
              className={`flex items-center justify-between px-3 py-1.5 rounded text-xs cursor-pointer transition-colors group ${
                tab.id === activeTabId
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
              }`}
            >
              <span className="truncate">{tab.title ?? tab.label}</span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => {
                    handleCloseTab(e, tab.id);
                    setTabPanelOpen(false);
                  }}
                  className="ml-2 shrink-0 text-neutral-600 hover:text-white transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                >
                  ×
                </span>
              )}
            </div>
          ))}
          <div
            onClick={() => {
              handleAddTab();
              setTabPanelOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs cursor-pointer transition-colors text-neutral-500 hover:bg-neutral-800 hover:text-white border-t border-neutral-800 mt-0.5 pt-2"
          >
            <Plus size={12} />
            <span>New tab</span>
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {activeWindow ? (
          tabs.map((tab) => (
            <SSHPane
              key={tab.id}
              tabId={tab.id}
              windowId={activeWindow.id}
              connectionId={tab.connectionId ?? connectionId}
              isActive={tab.id === activeTabId}
              hasNavigated={tab.hasNavigated}
              keyboardHeight={keyboardHeight}
              refreshNonce={paneRefreshKey}
              enableTouchScroll
              onTmuxStateChange={handleTmuxStateChange}
              onTmuxControllerChange={handleTmuxControllerChange}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-600">
            <Terminal size={48} strokeWidth={1} />
            <div className="text-center">
              <p className="text-sm text-neutral-400 mb-1">No terminal open</p>
              <p className="text-xs text-neutral-600 mb-4">Add an SSH connection to get started</p>
              <button
                onClick={() => onOpenSection("ssh")}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs rounded-lg transition-colors cursor-pointer"
              >
                Open SSH Manager
              </button>
            </div>
          </div>
        )}
        <FocusModeGitPanel
          key={`${activeProjectId ?? "none"}:${connectionId ?? "none"}:${activeTerminalDirectory ?? ""}`}
          open={gitPanelOpen && Boolean(activeProjectId)}
          projectId={activeProjectId}
          connectionId={connectionId}
          directory={activeTerminalDirectory}
          onClose={() => setGitPanelOpen(false)}
        />
      </div>
    </div>
  );
}
