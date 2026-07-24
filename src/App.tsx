import { useEffect, useRef, useState } from "react";
import registry from "@/apps/registry";
import Canvas from "@/components/Canvas";
import Dock from "@/components/Dock";
import DockerPanel from "@/components/DockerPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import FocusModeGitPanel from "@/components/FocusModeGitPanel";
import FocusModeLayout from "@/components/FocusModeLayout";
import NavigationBlockModal from "@/components/NavigationBlockModal";
import NavigationIndicator from "@/components/NavigationIndicator";
import Sidebar from "@/components/Sidebar";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import WindowFrame from "@/components/WindowFrame";
import { getVisibleSSHWindows } from "@/lib/sshWindowNavigation";
import { useNavigationBlockStore } from "@/stores/useNavigationBlockStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useTerminalSessionStore } from "@/stores/useTerminalSessionStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { canvasTransform } from "@/lib/canvasTransform";
import { getSSHMetadata } from "@/types";

export default function App() {
  const { block, unblock } = useNavigationBlockStore();
  const windows = useWindowStore((s) => s.windows);
  const focusTargetId = useWindowStore((s) => s.focusTargetId);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const bgColor = useSettingsStore((s) => s.bgColor);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const focusModeWindowId = useSettingsStore((s) => s.focusModeWindowId);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const savedTransformRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const prevFocusModeRef = useRef(focusMode);
  const visibleSSHWindows = getVisibleSSHWindows(windows);
  const activeSSHWindow =
    visibleSSHWindows.find((win) => win.id === focusTargetId) ??
    visibleSSHWindows[0] ??
    null;
  const activeSSHMetadata = activeSSHWindow ? getSSHMetadata(activeSSHWindow) : null;
  const activeSSHTab =
    activeSSHMetadata?.tabs.find((tab) => tab.id === activeSSHMetadata.activeTabId) ??
    activeSSHMetadata?.tabs[0] ??
    null;
  const gitConnectionId =
    activeSSHTab?.connectionId ??
    (activeSSHWindow?.metadata?.connectionId as number | undefined);
  const gitSessionId =
    activeSSHWindow && activeSSHTab
      ? `${activeSSHWindow.id}-${activeSSHTab.id}`
      : "";
  const gitDirectory = useTerminalSessionStore(
    (s) => (gitSessionId ? s.terminalCwds[gitSessionId] : undefined),
  );

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raf = requestAnimationFrame(() => {
      setShowOnboarding(!localStorage.getItem("infinite-onboarded"));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (import.meta.env.DEV) return;
      if (windows.length > 0) {
        e.preventDefault();
        return "";
      }
    };

    const handlePopState = (e: PopStateEvent) => {
      if (windows.length > 0) {
        e.preventDefault();
        block(
          "You have open windows. Are you sure you want to go back?",
          () => {
            unblock();
            window.history.go(1);
          },
        );
        window.history.pushState(null, "", window.location.href);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    window.history.pushState(null, "", window.location.href);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [windows.length, block, unblock]);

  // Sync body background with app bg color
  useEffect(() => {
    document.body.style.backgroundColor = bgColor;
  }, [bgColor]);

  // Save/restore canvas transform when toggling focus mode
  useEffect(() => {
    const wasInFocus = prevFocusModeRef.current;
    prevFocusModeRef.current = focusMode;

    if (!wasInFocus && focusMode) {
      // Entering focus mode — save current canvas transform
      const state = canvasTransform.getState();
      if (state?.scale != null && state.positionX != null && state.positionY != null) {
        savedTransformRef.current = {
          x: state.positionX,
          y: state.positionY,
          scale: state.scale,
        };
      }
    } else if (wasInFocus && !focusMode) {
      // Exiting focus mode — restore exact canvas viewport from before focus mode.
      const saved = savedTransformRef.current;
      const state = useWindowStore.getState();
      const activeFocusWindow = focusModeWindowId
        ? state.windows.find((w) => w.id === focusModeWindowId)
        : null;
      const visibleWindows = state.windows.filter(
        (w) => !w.minimized && !w.maximized,
      );
      if (activeFocusWindow) state.focusWindow(activeFocusWindow.id);
      const restore = () => {
        const inst = canvasTransform.getInstance();

        if (!inst) return false;
        if (saved) {
          return canvasTransform.applyTransform(inst, saved.x, saved.y, saved.scale);
        }
        if (activeFocusWindow) {
          return canvasTransform.centerOnWindow(activeFocusWindow);
        }
        if (visibleWindows.length > 0) {
          canvasTransform.fitToWindows(visibleWindows);
          return true;
        }
        return false;
      };
      // Retry until Canvas is mounted and instance is ready
      let attempts = 0;
      const tryRestore = () => {
        if (restore() || attempts++ > 30) return;
        requestAnimationFrame(tryRestore);
      };
      requestAnimationFrame(tryRestore);
      savedTransformRef.current = null;
    }
  }, [focusMode, focusModeWindowId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === "p" || e.key === "P") {
          e.preventDefault();
          setSwitcherOpen((prev) => !prev);
        } else if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          useSettingsStore.getState().setFocusMode(!useSettingsStore.getState().focusMode);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <ErrorBoundary>
    <div className="h-[100dvh] overflow-hidden relative select-none touch-none" style={{ backgroundColor: bgColor }}>
      <NavigationBlockModal />
      {showOnboarding && (
        <div className="fixed inset-0 z-[99997] bg-black/70 flex items-center justify-center p-6">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-sm w-full space-y-4 text-center">
            <h2 className="text-lg font-semibold text-white">Welcome to Infinite</h2>
            <div className="text-sm text-neutral-400 space-y-2 text-left">
              <p>• <strong className="text-neutral-200">Click apps</strong> in the dock to place windows on the canvas</p>
              <p>• <strong className="text-neutral-200">Pan & zoom</strong> the infinite canvas with scroll/pinch</p>
              <p>• <strong className="text-neutral-200">SSH</strong> — Add connections in the sidebar to open terminals</p>
            </div>
            <button
              onClick={() => { setShowOnboarding(false); localStorage.setItem("infinite-onboarded", "1"); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {focusMode ? (
        <FocusModeLayout
          switcherOpen={switcherOpen}
          setSwitcherOpen={setSwitcherOpen}
          onOpenSection={(section) => setPendingSection(section)}
        />
      ) : (
        <>
          <Canvas>
            {windows
              .filter((w) => !w.minimized && !w.maximized)
              .map((win) => {
                const app = registry[win.appId];
                if (!app) return null;
                const AppComponent = app.component;
                return (
                  <WindowFrame
                    key={win.id}
                    id={win.id}
                    title={(win.metadata?.title as string) || app.title}
                    defaultX={win.x}
                    defaultY={win.y}
                    defaultWidth={app.defaultWidth}
                    defaultHeight={app.defaultHeight}
                  >
                    <AppComponent
                      connectionId={win.metadata?.connectionId as number}
                      windowId={win.id}
                    />
                  </WindowFrame>
                );
              })}
          </Canvas>
          {windows
            .filter((w) => !w.minimized && w.maximized)
            .map((win) => {
              const app = registry[win.appId];
              if (!app) return null;
              const AppComponent = app.component;
              return (
                <WindowFrame
                  key={win.id}
                  id={win.id}
                  title={(win.metadata?.title as string) || app.title}
                  defaultX={win.x}
                  defaultY={win.y}
                  defaultWidth={app.defaultWidth}
                  defaultHeight={app.defaultHeight}
                >
                  <AppComponent
                    key={`${win.id}-${win.maximized}`}
                    connectionId={win.metadata?.connectionId as number}
                    windowId={win.id}
                  />
                </WindowFrame>
              );
            })}
          <NavigationIndicator />
          <ProjectSwitcher
            isOpen={switcherOpen}
            onOpenChange={setSwitcherOpen}
            onOpenSection={(section) => setPendingSection(section)}
          />
          <Dock
            gitOpen={gitPanelOpen}
            gitDisabled={!activeProjectId}
            onToggleGit={() => setGitPanelOpen((open) => !open)}
          />
          {gitPanelOpen && activeProjectId && (
            <div className="fixed inset-0 z-[10040]">
              <button
                type="button"
                aria-label="Close Git panel"
                className="absolute inset-0 bg-black/55 backdrop-blur-sm"
                onClick={() => setGitPanelOpen(false)}
              />
              <div className="relative h-full">
                <FocusModeGitPanel
                  key={`${activeProjectId}:${gitConnectionId ?? "none"}:${gitDirectory ?? ""}`}
                  open
                  projectId={activeProjectId}
                  connectionId={gitConnectionId}
                  directory={gitDirectory}
                  onClose={() => setGitPanelOpen(false)}
                />
              </div>
            </div>
          )}
        </>
      )}
      <DockerPanel />
      <Sidebar
        openSection={pendingSection}
        onOpenSectionConsumed={() => setPendingSection(null)}
      />
    </div>
    </ErrorBoundary>
  );
}
