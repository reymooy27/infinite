import { useState, useEffect, useRef, useCallback } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { canvasTransform } from "../lib/canvasTransform";
import useWindowStore from "../stores/useWindowStore";
import useSSHStore from "../stores/useSSHStore";
import registry from "../apps/registry";

export default function Canvas({ children }) {
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  const [pendingSSH, setPendingSSH] = useState(null);
  const draggingId = useWindowStore((s) => s.draggingId);
  const focusTargetId = useWindowStore((s) => s.focusTargetId);
  const windows = useWindowStore((s) => s.windows);
  const placingAppId = useWindowStore((s) => s.placingAppId);
  const openApp = useWindowStore((s) => s.openApp);
  const clearPlacing = useWindowStore((s) => s.clearPlacing);
  const clearFocus = useWindowStore((s) => s.clearFocus);
  const connections = useSSHStore((s) => s.connections);
  const fetchConnections = useSSHStore((s) => s.fetchConnections);

  useEffect(() => {
    const tw = wrapperRef.current;
    if (!tw) return;
    const wrapper = tw.instance?.wrapperComponent;
    if (!wrapper) return;
    canvasTransform.current = tw.instance;
    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;
    tw.instance.setState(1, vw / 2 - 5000, vh / 2 - 5000);
    return () => {
      canvasTransform.current = null;
    };
  }, []);

  const handleCanvasClick = useCallback(
    (e) => {
      if (!placingAppId) return;
      const inst = canvasTransform.current;
      if (!inst) return;
      const wrapper = inst.wrapperComponent;
      if (!wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const state = inst.state;
      const scale = state?.scale ?? 1;
      const posX = state?.positionX ?? 0;
      const posY = state?.positionY ?? 0;

      const canvasX = (screenX - posX) / scale;
      const canvasY = (screenY - posY) / scale;

      const app = registry[placingAppId];
      if (!app) return;

      const x = canvasX - app.defaultWidth / 2;
      const y = canvasY - app.defaultHeight / 2;

      if (placingAppId === "ssh") {
        setPendingSSH({ x, y });
        fetchConnections();
        return;
      }

      openApp(placingAppId, x, y);
    },
    [placingAppId, openApp, fetchConnections],
  );

  useEffect(() => {
    const wrapper = canvasTransform.current?.wrapperComponent;
    if (!wrapper) return;
    if (placingAppId) {
      wrapper.style.cursor = "crosshair";
      wrapper.addEventListener("click", handleCanvasClick);
    } else {
      wrapper.style.cursor = "";
    }
    return () => {
      wrapper.removeEventListener("click", handleCanvasClick);
      if (wrapper) wrapper.style.cursor = "";
    };
  }, [placingAppId, handleCanvasClick]);

  useEffect(() => {
    if (!focusTargetId) return;
    const win = windows.find((w) => w.id === focusTargetId);
    if (!win) return;

    const tw = wrapperRef.current;
    if (!tw) return;
    const wrapper = tw.instance?.wrapperComponent;
    if (!wrapper) return;

    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;

    const winW = win.width || 400;
    const winH = win.height || 300;
    const winCenterX = win.x + winW / 2;
    const winCenterY = win.y + winH / 2;

    const scale = tw.instance?.state?.scale || 1;

    const tx = vw / 2 - winCenterX * scale;
    const ty = vh / 2 - winCenterY * scale;

    tw.instance.setState(scale, tx, ty);
  }, [focusTargetId, windows]);

  useEffect(() => {
    const tw = wrapperRef.current;
    if (!tw) return;
    if (placingAppId || draggingId || focusTargetId) {
      tw.instance.setup.panning.disabled = true;
      tw.instance.setup.wheel.disabled = true;
    } else {
      tw.instance.setup.panning.disabled = false;
      tw.instance.setup.wheel.disabled = false;
    }
  }, [placingAppId, draggingId, focusTargetId]);

  useEffect(() => {
    const tw = wrapperRef.current;
    if (!tw) return;
    tw.instance.setup.velocityAnimation.sensitivityMouse = 0.25;
    tw.instance.setup.wheel.step = 0.005;
  }, []);

  const handleBackgroundClick = useCallback((e) => {
    if (!contentRef.current?.contains(e.target)) return;
    if (!focusTargetId) return;
    clearFocus();
  }, [focusTargetId, clearFocus]);

  const handleSelectConnection = (conn) => {
    if (!pendingSSH) return;
    openApp("ssh", pendingSSH.x, pendingSSH.y, {
      connectionId: conn.id,
      title: conn.name,
    });
    setPendingSSH(null);
  };

  const handleCancelSSH = () => {
    setPendingSSH(null);
    clearPlacing();
  };

  const handleNoConnection = () => {
    if (!pendingSSH) return;
    openApp("ssh", pendingSSH.x, pendingSSH.y);
    setPendingSSH(null);
  };

  const isDragging = draggingId !== null;

  const gridColor = isDragging ? "#444" : "#333";
  const bgColor = isDragging ? "#1e1e2e" : "#1a1a1a";

  const placingApp = placingAppId ? registry[placingAppId] : null;

  return (
    <div className="relative w-full h-full">
      <TransformWrapper
        ref={wrapperRef}
        initialScale={1}
        minScale={0.4}
        maxScale={5}
        centerZoomedOut={false}
      >
        <TransformComponent
          wrapperStyle={{
            width: "100%",
            height: "100%",
          }}
        >
          <div
            ref={contentRef}
            className="relative"
            style={{
              width: "10000px",
              height: "10000px",
              backgroundSize: "40px 40px",
              backgroundImage: `linear-gradient(to right, ${gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`,
              backgroundColor: bgColor,
              transition: "background-color 0.2s ease",
            }}
            onClick={handleBackgroundClick}
          >
            {children}
          </div>
        </TransformComponent>
      </TransformWrapper>
      {placingApp && !pendingSSH && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-3 px-4 py-2 bg-blue-900/90 backdrop-blur-md border border-blue-500 text-blue-100 rounded-lg shadow-lg text-sm">
          <span className="text-lg">{placingApp.icon}</span>
          <span>Click on canvas to place <strong>{placingApp.title}</strong></span>
          <button
            onClick={(e) => { e.stopPropagation(); clearPlacing(); }}
            className="ml-3 px-2 py-0.5 text-xs bg-blue-700 hover:bg-blue-600 rounded cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
      {pendingSSH && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-96 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
              <h2 className="text-sm font-semibold text-neutral-200">Select SSH Connection</h2>
              <button
                onClick={handleCancelSSH}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 cursor-pointer transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
              {connections.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-neutral-500 text-sm mb-3">No SSH connections yet</p>
                  <p className="text-neutral-600 text-xs mb-4">Add a connection in the SSH sidebar first</p>
                  <button
                    onClick={handleNoConnection}
                    className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-neutral-200 text-sm rounded-md cursor-pointer transition-colors"
                  >
                    Open without connection
                  </button>
                </div>
              ) : (
                connections.map((conn) => (
                  <button
                    key={conn.id}
                    onClick={() => handleSelectConnection(conn)}
                    className="flex items-center gap-3 px-3 py-2.5 bg-neutral-800 rounded-lg border border-neutral-700 hover:border-blue-500 hover:bg-neutral-750 transition-colors cursor-pointer w-full text-left"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0">
                      <path d="M4 17l6-6-6-6" />
                      <path d="M10 17l6-6-6-6" />
                    </svg>
                    <div className="min-w-0">
                      <div className="text-neutral-200 text-sm font-medium truncate">{conn.name}</div>
                      <div className="text-xs text-neutral-500 truncate">{conn.username}@{conn.host}:{conn.port}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}