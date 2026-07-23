"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, RefreshCw, LayoutGrid, Settings, Plus, Terminal, ChevronDown, ChevronUp, GitBranch, Boxes } from "lucide-react";
import { SSHPane } from "@/apps/registry";
import FocusModeGitPanel from "@/components/FocusModeGitPanel";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import SettingsPanel from "@/components/SettingsPanel";
import TerminalNextButton from "@/components/TerminalNextButton";
import TerminalPrevButton from "@/components/TerminalPrevButton";
import { getBrowserId } from "@/lib/browserId";
import { getNextSSHTerminalTarget, getPrevSSHTerminalTarget, getVisibleSSHWindows } from "@/lib/sshWindowNavigation";
import { useProjectStore } from "@/stores/useProjectStore";
import { useTerminalSessionStore } from "@/stores/useTerminalSessionStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useDockerStore } from "@/stores/useDockerStore";
import { useSSHStore } from "@/stores/useSSHStore";
import { getSSHMetadata } from "@/types";

const CODING_AGENT_CHOICES = [
  { agent: "opencode", label: "OpenCode" },
  { agent: "codex", label: "Codex" },
  { agent: "claude", label: "Claude" },
] as const;

interface FocusModeLayoutProps {
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  onOpenSection: (section: string) => void;
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
  const dockerOpen = useDockerStore((s) => s.open);
  const toggleDockerPanel = useDockerStore((s) => s.togglePanel);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  const [paneRefreshKey, setPaneRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<
    "root" | "terminal" | "api-management"
  >("terminal");
  const [tabPanelOpen, setTabPanelOpen] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [codingAgentPickerOpen, setCodingAgentPickerOpen] = useState(false);
  const [agentReady, setAgentReady] = useState(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keyboardRafRef = useRef<number | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const tabPanelRef = useRef<HTMLDivElement>(null);
  const tabToggleBtnRef = useRef<HTMLButtonElement>(null);
  const codingAgentRef = useRef<HTMLDivElement>(null);
  const codingAgentBtnRef = useRef<HTMLButtonElement>(null);

  const sshConnections = useSSHStore((s) => s.connections);

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
  const prevTerminal = getPrevSSHTerminalTarget(windows, activeWindowId, activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const connectionId = (activeTab?.connectionId ?? activeWindow?.metadata?.connectionId) as number | undefined;
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

  const handleCloseWindow = (windowId: string) => {
    closeWindow(windowId);
    const remaining = sshWindows.filter((w) => w.id !== windowId);
    if (remaining.length > 0) {
      setFocusModeWindowId(remaining[0].id);
      focusWindow(remaining[0].id);
    } else {
      setFocusMode(false);
    }
  };

  const handleCodingAgentChoice = (agent: string) => {
    setCodingAgentPickerOpen(false);
    setAgentReady(false);
    const conn = sshConnections[0];
    if (!conn) return;
    // Open a new SSH window with autoCommand
    const store = useWindowStore.getState();
    const tabId = getBrowserId("tab-");
    store.openApp("ssh", undefined, undefined, {
      autoCommand: agent,
      connectionId: conn.id,
      title: `${agent} — ${conn.name}`,
      tabs: [{ id: tabId, label: "Tab 1", connectionId: conn.id }],
      activeTabId: tabId,
    });
    // Switch focus mode to the new window
    const newWindow = useWindowStore.getState().windows.at(-1);
    if (newWindow) {
      setFocusModeWindowId(newWindow.id);
      store.focusWindow(newWindow.id);
    }
  };

  const handleAgentReady = useCallback(() => {
    setAgentReady(true);
  }, []);

  useEffect(() => {
    if (!codingAgentPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        codingAgentRef.current &&
        !codingAgentRef.current.contains(e.target as Node) &&
        codingAgentBtnRef.current &&
        !codingAgentBtnRef.current.contains(e.target as Node)
      ) {
        setCodingAgentPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [codingAgentPickerOpen]);

  const handleAddTab = () => {
    if (!activeWindow) return;
    const newTabId = getBrowserId("tab-");
    addTerminalTab(activeWindow.id, {
      id: newTabId,
      label: `Tab ${tabs.length + 1}`,
      connectionId,
    });
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (!activeWindow || tabs.length <= 1) return;
    closeTerminalTab(activeWindow.id, tabId);
  };

  const handleNextWindow = () => {
    if (!nextTerminal) return;
    setActiveTerminalTab(nextTerminal.windowId, nextTerminal.tabId);
    setFocusModeWindowId(nextTerminal.windowId);
    focusWindow(nextTerminal.windowId);
  };

  const handlePrevWindow = () => {
    if (!prevTerminal) return;
    setActiveTerminalTab(prevTerminal.windowId, prevTerminal.tabId);
    setFocusModeWindowId(prevTerminal.windowId);
    focusWindow(prevTerminal.windowId);
  };

  const handlePage = (action: "pageup" | "pagedown") => {
    if (!activeWindowId) return;
    window.dispatchEvent(
      new CustomEvent(`app-page-${activeWindowId}`, { detail: { action } }),
    );
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
            onClick={toggleDockerPanel}
            title="Docker Manager"
            className={`p-1.5 transition-colors cursor-pointer rounded ${
              dockerOpen
                ? "text-white bg-neutral-800"
                : "text-neutral-500 hover:text-white hover:bg-neutral-800"
            }`}
          >
            <Boxes size={14} />
          </button>

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
          <TerminalPrevButton
            onClick={handlePrevWindow}
            disabled={!prevTerminal}
            iconOnly
            className="px-2.5 py-1 rounded text-xs transition-colors cursor-pointer border text-neutral-300 border-neutral-800 hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center"
          />
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
                  setFocusModeWindowId(win.id);
                  setTabPanelOpen(false);
                }}
                className={`flex items-center justify-between px-3 py-1.5 rounded text-xs cursor-pointer transition-colors group ${
                  isSelected
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}
              >
                <span className="truncate">{getWindowLabel(win.id)}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                    Win
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseWindow(win.id);
                      setTabPanelOpen(false);
                    }}
                    className="text-neutral-600 hover:text-red-400 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    ×
                  </span>
                </div>
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
          <div className="flex items-center gap-1 border-t border-neutral-800 mt-0.5 pt-2">
            <div
              onClick={() => {
                handleAddTab();
                setTabPanelOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs cursor-pointer transition-colors text-neutral-500 hover:bg-neutral-800 hover:text-white flex-1"
            >
              <Plus size={12} />
              <span>New tab</span>
            </div>
            <div className="relative">
              <button
                ref={codingAgentBtnRef}
                onClick={() => setCodingAgentPickerOpen((v) => !v)}
                title="Coding Agent"
                className={`p-1.5 transition-colors cursor-pointer rounded ${
                  codingAgentPickerOpen
                    ? "text-white bg-neutral-800"
                    : "text-neutral-500 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <Bot size={12} />
              </button>
              {codingAgentPickerOpen && (
                <div
                  ref={codingAgentRef}
                  className="absolute bottom-full right-0 mb-1 w-48 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-[10000] overflow-hidden"
                >
                  <div className="px-3 py-2 border-b border-neutral-800 text-xs text-neutral-500 font-medium">
                    Coding Agent
                  </div>
                  {CODING_AGENT_CHOICES.map((choice) => (
                    <button
                      key={choice.agent}
                      onClick={() => {
                        handleCodingAgentChoice(choice.agent);
                        setTabPanelOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {activeWindow ? (
          <>
            {tabs.map((tab) => (
              <SSHPane
                key={tab.id}
                tabId={tab.id}
                windowId={activeWindow.id}
                connectionId={tab.connectionId ?? connectionId}
                isActive={tab.id === activeTabId}
                hasNavigated={tab.hasNavigated}
                keyboardHeight={keyboardHeight}
                refreshNonce={paneRefreshKey}
                autoCommand={tab.id === tabs[0]?.id ? activeWindow.metadata?.autoCommand as string | undefined : undefined}
                onReady={tab.id === tabs[0]?.id ? handleAgentReady : undefined}
              />
            ))}
            {activeWindow.metadata?.autoCommand && !agentReady && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0a0a0a]">
                <Bot className="w-6 h-6 text-neutral-400 animate-pulse mb-3" />
                <p className="text-sm text-neutral-400">
                  Starting {activeWindow.metadata.autoCommand as string}...
                </p>
                <p className="text-xs text-neutral-600 mt-1">
                  Connecting to server and launching agent
                </p>
              </div>
            )}
          </>
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
        {activeWindow && (
          <div className="absolute right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2 md:hidden">
            <button
              type="button"
              onClick={() => handlePage("pageup")}
              title="Page up"
              aria-label="Page up"
              className="flex size-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800/80 text-white shadow-lg backdrop-blur-sm active:bg-neutral-600"
            >
              <ChevronUp size={18} strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => handlePage("pagedown")}
              title="Page down"
              aria-label="Page down"
              className="flex size-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800/80 text-white shadow-lg backdrop-blur-sm active:bg-neutral-600"
            >
              <ChevronDown size={18} strokeWidth={3} />
            </button>
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
