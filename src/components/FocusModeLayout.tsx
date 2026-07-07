"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, LayoutGrid, Settings, Plus, Terminal, ChevronDown } from "lucide-react";
import { SSHPane } from "@/apps/registry";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import SettingsPanel from "@/components/SettingsPanel";
import TerminalNextButton from "@/components/TerminalNextButton";
import { getBrowserId } from "@/lib/browserId";
import { getNextSSHTerminalTarget, getVisibleSSHWindows } from "@/lib/sshWindowNavigation";
import { useWindowStore } from "@/stores/useWindowStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { getSSHMetadata } from "@/types";

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
  const focusWindow = useWindowStore((s) => s.focusWindow);

  const [paneRefreshKey, setPaneRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<
    "root" | "terminal" | "api-management"
  >("terminal");
  const [tabPanelOpen, setTabPanelOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const tabPanelRef = useRef<HTMLDivElement>(null);
  const tabToggleBtnRef = useRef<HTMLButtonElement>(null);

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
  const connectionId = activeWindow?.metadata?.connectionId as number | undefined;
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
      const h = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
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
          <TerminalNextButton
            onClick={handleNextWindow}
            disabled={!nextTerminal}
            iconOnly
            className="px-2.5 py-1 rounded text-xs transition-colors cursor-pointer border text-neutral-300 border-neutral-800 hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center"
          />
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
      </div>
    </div>
  );
}
