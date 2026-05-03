"use client";

import Canvas from "@/components/Canvas";
import WindowFrame from "@/components/WindowFrame";
import Dock from "@/components/Dock";
import Sidebar from "@/components/Sidebar";
import { useWindowStore } from "@/stores/useWindowStore";
import registry from "@/apps/registry";

export default function App() {
  const windows = useWindowStore((s) => s.windows);

  return (
    <div className="h-[100dvh] bg-neutral-950 overflow-hidden relative select-none touch-none">
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
