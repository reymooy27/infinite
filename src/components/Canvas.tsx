"use client";

import registry from "@/apps/registry";
import { canvasTransform } from "@/lib/canvasTransform";
import { useSSHStore } from "@/stores/useSSHStore";
import { useWindowStore } from "@/stores/useWindowStore";
import type { AppId } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

export default function Canvas({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<React.ComponentRef<typeof TransformWrapper>>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
  } | null>(null);
  const isMiddlePanning = useRef(false);
  const middlePanStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const scaleRef = useRef(1);
  const lastScale = useRef(1);
  const zoomTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const percentRef = useRef<HTMLButtonElement>(null);
  const [pendingConnectionApp, setPendingConnectionApp] = useState<{
    appId: AppId;
    x: number;
    y: number;
  } | null>(null);
  const [isZooming, setIsZooming] = useState(false);
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
    const wrapper = (
      tw as unknown as { instance?: { wrapperComponent?: HTMLElement } }
    ).instance?.wrapperComponent;
    if (!wrapper) return;
    canvasTransform.current = (tw as any).instance ?? tw;
    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;
    ((canvasTransform.current as any)?.setState ?? (tw as any)?.setState)?.(
      1,
      vw / 2 - 5000,
      vh / 2 - 5000,
    );
    return () => {
      canvasTransform.current = null;
    };
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener("dblclick", prevent);
    return () => el.removeEventListener("dblclick", prevent);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const inst = canvasTransform.current as any;
      if (!inst?.state) return;
      const wrapper = inst.wrapperComponent as HTMLElement | undefined;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const { scale, positionX, positionY } = inst.state;
      const delta = -e.deltaY * 0.005;
      const newScale = scale * Math.exp(delta);
      const clamped = Math.min(20, Math.max(0.1, newScale));
      const ratio = clamped / scale;
      const newPosX = mouseX - (mouseX - positionX) * ratio;
      const newPosY = mouseY - (mouseY - positionY) * ratio;
      (inst.setState ?? inst.instance?.setState)?.call(inst, clamped, newPosX, newPosY);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    let frame: number;
    const tick = () => {
      if (percentRef.current) {
        percentRef.current.textContent = `${Math.round(scaleRef.current * 100)}%`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!placingAppId) return;
      const inst = canvasTransform.current;
      if (!inst) return;
      const wrapper = (inst as unknown as { wrapperComponent?: HTMLElement })
        .wrapperComponent;
      if (!wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const state = (
        inst as unknown as {
          state?: { scale: number; positionX: number; positionY: number };
        }
      ).state;
      const scale = state?.scale ?? 1;
      const posX = state?.positionX ?? 0;
      const posY = state?.positionY ?? 0;

      const canvasX = (screenX - posX) / scale;
      const canvasY = (screenY - posY) / scale;

      const app = registry[placingAppId];
      if (!app) return;

      const x = canvasX - app.defaultWidth / 2;
      const y = canvasY - app.defaultHeight / 2;

      if (
        placingAppId === "ssh" ||
        placingAppId === "devBrowser"
      ) {
        setPendingConnectionApp({ appId: placingAppId, x, y });
        fetchConnections();
        return;
      }

      openApp(placingAppId, x, y);
    },
    [placingAppId, openApp, fetchConnections],
  );

  useEffect(() => {
    const wrapper = (
      canvasTransform.current as unknown as { wrapperComponent?: HTMLElement }
    )?.wrapperComponent;
    if (!wrapper) return;
    if (placingAppId) {
      wrapper.style.cursor = "crosshair";
      wrapper.addEventListener(
        "click",
        handleCanvasClick as unknown as EventListener,
      );
    } else {
      wrapper.style.cursor = "";
    }
    return () => {
      wrapper.removeEventListener(
        "click",
        handleCanvasClick as unknown as EventListener,
      );
      if (wrapper) wrapper.style.cursor = "";
    };
  }, [placingAppId, handleCanvasClick]);

  useEffect(() => {
    if (!focusTargetId) return;
    const win = windows.find((w) => w.id === focusTargetId);
    if (!win) return;

    const tw = wrapperRef.current;
    if (!tw) return;
    const wrapper = (
      tw as unknown as { instance?: { wrapperComponent?: HTMLElement } }
    ).instance?.wrapperComponent;
    if (!wrapper) return;

    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;

    const winW = win.width || 400;
    const winH = win.height || 300;
    const winCenterX = win.x + winW / 2;
    const winCenterY = win.y + winH / 2;

    const scale =
      (tw as unknown as { state?: { scale: number } }).state?.scale || 1;

    const tx = vw / 2 - winCenterX * scale;
    const ty = vh / 2 - winCenterY * scale;

    ((tw as any).instance ?? tw)?.setState?.(scale, tx, ty);
  }, [focusTargetId, windows]);

  useEffect(() => {
    const tw = wrapperRef.current;
    if (!tw) return;
    const twAny = tw as unknown as {
      setup?: {
        panning?: { disabled: boolean };
        wheel?: { disabled: boolean };
      };
    };
    if (placingAppId || draggingId || focusTargetId) {
      if (twAny.setup?.panning) twAny.setup.panning.disabled = true;
      if (twAny.setup?.wheel) twAny.setup.wheel.disabled = true;
    } else {
      if (twAny.setup?.panning) twAny.setup.panning.disabled = false;
      if (twAny.setup?.wheel) twAny.setup.wheel.disabled = false;
    }
  }, [placingAppId, draggingId, focusTargetId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      if (placingAppId || draggingId) return;
      e.preventDefault();
      e.stopPropagation();

      const tw = wrapperRef.current;
      if (!tw) return;
      const state = (
        tw as unknown as { state?: { positionX: number; positionY: number } }
      ).state;
      isMiddlePanning.current = true;
      middlePanStart.current = {
        x: e.clientX,
        y: e.clientY,
        tx: state?.positionX ?? 0,
        ty: state?.positionY ?? 0,
      };
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isMiddlePanning.current) return;
      const tw = wrapperRef.current;
      if (!tw) return;
      const dx = e.clientX - middlePanStart.current.x;
      const dy = e.clientY - middlePanStart.current.y;
      const state = (tw as unknown as { state?: { scale: number } }).state;
      const scale = state?.scale ?? 1;
      const tx = middlePanStart.current.tx + dx;
      const ty = middlePanStart.current.ty + dy;
      ((tw as any).instance ?? tw)?.setState?.(scale, tx, ty);
    };

    const onMouseUp = () => {
      if (!isMiddlePanning.current) return;
      isMiddlePanning.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    el.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [placingAppId, draggingId]);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (!contentRef.current?.contains(e.target as Node)) return;
      if (!focusTargetId) return;
      clearFocus();
    },
    [focusTargetId, clearFocus],
  );

  const handleSelectConnection = (conn: { id: number; name: string }) => {
    if (!pendingConnectionApp) return;
    openApp(pendingConnectionApp.appId, pendingConnectionApp.x, pendingConnectionApp.y, {
      connectionId: conn.id,
      title:
        pendingConnectionApp.appId === "ssh"
          ? conn.name
          : `${conn.name} ${registry[pendingConnectionApp.appId].title}`,
    });
    setPendingConnectionApp(null);
  };

  const handleCancelConnectionPick = () => {
    setPendingConnectionApp(null);
    clearPlacing();
  };

  const handleNoConnection = () => {
    if (!pendingConnectionApp) return;
    openApp(
      pendingConnectionApp.appId,
      pendingConnectionApp.x,
      pendingConnectionApp.y,
    );
    setPendingConnectionApp(null);
  };

  const isDragging = draggingId !== null;
  const gridColor = isDragging ? "#444" : "#333";
  const bgColor = isDragging ? "#1e1e2e" : "#1a1a1a";
  const placingApp = placingAppId ? registry[placingAppId] : null;
  const pendingAppDefinition = pendingConnectionApp
    ? registry[pendingConnectionApp.appId]
    : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <TransformWrapper
        ref={
          wrapperRef as unknown as React.Ref<
            React.ComponentRef<typeof TransformWrapper>
          >
        }
        limitToBounds={false}
        initialScale={1}
        minScale={0.1}
        maxScale={20}
        centerZoomedOut={false}
        wheel={{
          disabled: true,
        }}
        autoAlignment={{ disabled: true }}
        zoomAnimation={{
          animationTime: 200,
          animationType: "easeOut",
        }}
        pinch={{
          step: 2,
        }}
        doubleClick={{ disabled: true }}
        trackPadPanning={{
          disabled: false,
        }}
        onTransform={({ state }) => {
          const newScale = state.scale;
          scaleRef.current = newScale;
          if (newScale !== lastScale.current) {
            setIsZooming(true);
            lastScale.current = newScale;
            clearTimeout(zoomTimer.current);
            zoomTimer.current = setTimeout(() => setIsZooming(false), 150);
          }
        }}
        panning={{
          disabled: false,
          velocityDisabled: false,
          activationKeys: ["Space"],
          excluded: ["window-drag-handle"],
        }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => {
          zoomRef.current = { zoomIn, zoomOut };
          return (
            <>
              <TransformComponent
                wrapperStyle={{
                  width: "100%",
                  height: "100%",
                  background: bgColor,
                }}
              >
                <div
                  ref={contentRef}
                  className="relative"
                  style={{
                    willChange: "transform",
                    transform: "translateZ(0)",
                    width: "10000px",
                    height: "10000px",
                    backgroundSize: "40px 40px",
                    backgroundColor: bgColor,
                    transition: "background-color 0.2s ease",
                  }}
                  onClick={handleBackgroundClick}
                >
                  <div style={{ pointerEvents: isZooming ? "none" : "auto" }}>
                    {children}
                  </div>
                </div>
              </TransformComponent>
              <div className="absolute bottom-4 left-4 hidden sm:flex z-[9999] items-center gap-1 px-1 py-1 bg-neutral-900/90 backdrop-blur-sm border border-neutral-700 rounded-lg shadow-xl text-xs">
                <button
                  onClick={() => zoomOut()}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer active:bg-neutral-600 touch-manipulation"
                  title="Zoom out"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button
                  ref={percentRef}
                  onClick={() => resetTransform()}
                  className="min-w-6 h-6 flex items-center justify-center px-1.5 rounded hover:bg-neutral-700 text-neutral-300 hover:text-white font-mono text-[11px] transition-colors cursor-pointer active:bg-neutral-600 touch-manipulation"
                  title="Reset zoom"
                >
                  100%
                </button>
                <button
                  onClick={() => zoomIn()}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer active:bg-neutral-600 touch-manipulation"
                  title="Zoom in"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </>
          );
        }}
      </TransformWrapper>
      {placingApp && !pendingConnectionApp && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[9998] flex flex-col md:flex-row md:justify-center items-center gap-3 px-5 py-3 bg-blue-900/90 backdrop-blur-md border border-blue-500 text-blue-100 rounded-lg shadow-lg text-xs md:text-sm">
          <span className="text-lg">{placingApp.icon}</span>
          <span className="text-center">
            Click on canvas to place <strong>{placingApp.title}</strong>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearPlacing();
            }}
            className="ml-3 px-2 py-0.5 text-xs bg-blue-700 hover:bg-blue-600 rounded cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
      {pendingConnectionApp && pendingAppDefinition && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[calc(100vw-32px)] sm:w-96 max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
              <h2 className="text-sm font-semibold text-neutral-200">
                Select SSH Session for {pendingAppDefinition.title}
              </h2>
              <button
                onClick={handleCancelConnectionPick}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 cursor-pointer transition-colors"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto">
              {connections.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <p className="text-neutral-500 text-sm mb-3">
                    No SSH connections yet
                  </p>
                  <p className="text-neutral-600 text-xs mb-4">
                    Add a connection in the SSH sidebar first
                  </p>
                  <button
                    onClick={handleNoConnection}
                    className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-neutral-200 text-sm rounded-md cursor-pointer transition-colors"
                  >
                    Open without SSH
                  </button>
                </div>
              ) : (
                connections.map((conn) => (
                  <button
                    key={conn.id}
                    onClick={() => handleSelectConnection(conn)}
                    className="flex items-center gap-3 px-4 py-3 bg-neutral-800 rounded-lg border border-neutral-700 hover:border-blue-500 hover:bg-neutral-750 transition-colors cursor-pointer w-full text-left"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-blue-400 shrink-0"
                    >
                      <path d="M4 17l6-6-6-6" />
                      <path d="M10 17l6-6-6-6" />
                    </svg>
                    <div className="min-w-0">
                      <div className="text-neutral-200 text-sm font-medium truncate">
                        {conn.name}
                      </div>
                      <div className="text-xs text-neutral-500 truncate">
                        {conn.username}@{conn.host}:{conn.port}
                      </div>
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
