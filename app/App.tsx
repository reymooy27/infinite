"use client";

import { useSession } from "next-auth/react";
import registry from "@/apps/registry";
import Canvas from "@/components/Canvas";
import Dock from "@/components/Dock";
import ErrorBoundary from "@/components/ErrorBoundary";
import UserAccount from "@/components/UserAccount";
import NavigationBlockModal from "@/components/NavigationBlockModal";
import Sidebar from "@/components/Sidebar";
import SignIn from "@/components/SignIn";
import WindowFrame from "@/components/WindowFrame";
import { useNavigationBlockStore } from "@/stores/useNavigationBlockStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useEffect, useState } from "react";

export default function App() {
  const { data: session, status } = useSession();
  const { block, unblock } = useNavigationBlockStore();
  const windows = useWindowStore((s) => s.windows);
  const loadLayout = useWindowStore((s) => s.loadLayout);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && !localStorage.getItem("infinite-onboarded")) {
      setShowOnboarding(true);
    }
  }, [status]);

  useEffect(() => {
    if (status === "authenticated") {
      loadLayout();
    }
  }, [loadLayout, status]);

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

  if (status === "loading") {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-neutral-950">
        <div className="w-6 h-6 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <SignIn />;
  }

  return (
    <ErrorBoundary>
    <div className="h-[100dvh] bg-neutral-950 overflow-hidden relative select-none touch-none">
      <NavigationBlockModal />
      {isMobile && (
        <div className="fixed top-0 left-0 right-0 z-[99998] bg-amber-900/90 backdrop-blur-sm px-4 py-2 text-center text-xs text-amber-100">
          Infinite is designed for desktop. Some features may not work on mobile.
        </div>
      )}
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
      <Sidebar />
      <Dock />
      <UserAccount />
    </div>
    </ErrorBoundary>
  );
}
