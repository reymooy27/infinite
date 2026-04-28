import { useEffect, useRef, useCallback } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { canvasTransform } from "../lib/canvasTransform";
import useWindowStore from "../stores/useWindowStore";
import registry from "../apps/registry";

export default function Canvas({ children }) {
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  const draggingId = useWindowStore((s) => s.draggingId);
  const focusTargetId = useWindowStore((s) => s.focusTargetId);
  const windows = useWindowStore((s) => s.windows);
  const placingAppId = useWindowStore((s) => s.placingAppId);
  const openApp = useWindowStore((s) => s.openApp);
  const clearPlacing = useWindowStore((s) => s.clearPlacing);

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

      openApp(placingAppId, x, y);
    },
    [placingAppId, openApp]
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
    if (placingAppId || draggingId) {
      tw.instance.setup.panning.disabled = true;
      tw.instance.setup.wheel.disabled = true;
    } else {
      tw.instance.setup.panning.disabled = false;
      tw.instance.setup.wheel.disabled = false;
    }
  }, [placingAppId, draggingId]);

  useEffect(() => {
    const tw = wrapperRef.current;
    if (!tw) return;
    tw.instance.setup.velocityAnimation.sensitivityMouse = 0.25;
    tw.instance.setup.wheel.step = 0.005;
  }, []);

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
          >
            {children}
          </div>
        </TransformComponent>
      </TransformWrapper>
      {placingApp && (
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
    </div>
  );
}