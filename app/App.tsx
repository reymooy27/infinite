"use client";

import { useEffect } from "react";
import Canvas from "@/components/Canvas";
import WindowFrame from "@/components/WindowFrame";
import Dock from "@/components/Dock";
import Sidebar from "@/components/Sidebar";
import NavigationBlockModal from "@/components/NavigationBlockModal";
import { useWindowStore } from "@/stores/useWindowStore";
import { useNavigationBlockStore } from "@/stores/useNavigationBlockStore";
import registry from "@/apps/registry";

export default function App() {
  const { block, unblock } = useNavigationBlockStore();
  const windows = useWindowStore((s) => s.windows);

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
        block("You have open windows. Are you sure you want to go back?", () => {
          unblock();
          window.history.go(1);
        });
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

  return (
    <div className="h-[100dvh] bg-neutral-950 overflow-hidden relative select-none touch-none">
      <NavigationBlockModal />
      <Canvas>
        {windows
          .filter((w) => !w.minimized)
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
                <AppComponent connectionId={win.metadata?.connectionId as number} windowId={win.id} />
              </WindowFrame>
            );
          })}
      </Canvas>
      <Sidebar />
      <Dock />
    </div>
  );
}