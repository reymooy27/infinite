"use client";

import { useEffect, useRef, useState } from "react";
import registry from "@/apps/registry";
import Canvas from "@/components/Canvas";
import Dock from "@/components/Dock";
import ErrorBoundary from "@/components/ErrorBoundary";
import FileTransferModal from "@/components/FileTransferModal";
import FocusModeLayout from "@/components/FocusModeLayout";
import NavigationBlockModal from "@/components/NavigationBlockModal";
import NavigationIndicator from "@/components/NavigationIndicator";
import Sidebar from "@/components/Sidebar";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import WindowFrame from "@/components/WindowFrame";
import { useNavigationBlockStore } from "@/stores/useNavigationBlockStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { canvasTransform } from "@/lib/canvasTransform";

export default function App() {
  const { block, unblock } = useNavigationBlockStore();
  const windows = useWindowStore((s) => s.windows);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const bgColor = useSettingsStore((s) => s.bgColor);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem("infinite-onboarded");
  });
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const savedTransformRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const prevFocusModeRef = useRef(focusMode);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
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
      // Exiting focus mode — restore canvas transform after Canvas mounts
      const saved = savedTransformRef.current;
      const visibleWindows = useWindowStore.getState().windows.filter(
        (w) => !w.minimized && !w.maximized,
      );
      const restore = () => {
        const inst = canvasTransform.getInstance();
        if (!inst) return false;
        if (saved) {
          canvasTransform.applyTransform(inst, saved.x, saved.y, saved.scale);
        } else if (visibleWindows.length > 0) {
          canvasTransform.fitToWindows(visibleWindows);
        }
        return true;
      };
      // Retry until Canvas is mounted and instance is ready
      let attempts = 0;
      const tryRestore = () => {
        if (restore() || attempts++ > 30) return;
        requestAnimationFrame(tryRestore);
      };
      requestAnimationFrame(tryRestore);
    }
  }, [focusMode]);

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
          <Dock />
        </>
      )}
      <Sidebar
        openSection={pendingSection}
        onOpenSectionConsumed={() => setPendingSection(null)}
      />
      <FileTransferModal />
    </div>
    </ErrorBoundary>
  );
}
