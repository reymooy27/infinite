import { useCallback, useRef, useState, cloneElement } from "react";
import { Rnd } from "react-rnd";
import { useWindowStore as useStore } from "../stores/useWindowStore";
import { canvasTransform } from "../lib/canvasTransform";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

const RESIZE_CONFIG = {
  bottomRight: true,
  bottomLeft: true,
  topRight: true,
  topLeft: true,
  right: true,
  left: true,
  bottom: true,
  top: true,
};

export default function WindowFrame({
  id,
  title,
  children,
  defaultX = 50,
  defaultY = 50,
  defaultWidth = 400,
  defaultHeight = 300,
}) {
  const win = useStore((s) => s.windows.find((w) => w.id === id));
  const closeWindow = useStore((s) => s.closeWindow);
  const updateWindowPosition = useStore((s) => s.updateWindowPosition);
  const focusTargetId = useStore((s) => s.focusTargetId);
  const minimizeWindow = useStore((s) => s.minimizeWindow);
  const maximizeWindow = useStore((s) => s.maximizeWindow);
  const bringToFront = useStore((s) => s.bringToFront);
  const focusWindow = useStore((s) => s.focusWindow);
  const setDragging = useStore((s) => s.setDragging);
  const clearDragging = useStore((s) => s.clearDragging);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const frameRef = useRef(null);

  const z = win?.z ?? 1;
  const scale = canvasTransform.current?.state?.scale ?? 1;
  const isActive = focusTargetId === id;
  const isMaximized = win?.maximized;
  const isMinimized = win?.minimized;

  const getViewBounds = useCallback(() => {
    const inst = canvasTransform.current;
    if (!inst) return { x: 0, y: 0, width: 1000, height: 800 };
    const wrapper = inst.wrapperComponent;
    if (!wrapper) return { x: 0, y: 0, width: 1000, height: 800 };
    const state = inst.state;
    const sc = state?.scale ?? 1;
    const px = state?.positionX ?? 0;
    const py = state?.positionY ?? 0;
    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;
    return {
      x: -px / sc,
      y: -py / sc,
      width: vw / sc,
      height: vh / sc,
    };
  }, []);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
    setDragging(id);
    focusWindow(id);
    bringToFront(id);
  }, [id, bringToFront, setDragging, focusWindow]);

  const handleDragStop = useCallback(
    (e, d) => {
      setIsDragging(false);
      focusWindow(id);
      if (isMaximized) return;
      updateWindowPosition(id, d.x, d.y, d.width, d.height);
      setTimeout(() => clearDragging(), 50);
    },
    [id, updateWindowPosition, clearDragging, focusWindow, isMaximized],
  );

  const handleResizeStop = useCallback(
    (e, dir, ref, d) => {
      setIsResizing(false);
      updateWindowPosition(id, d.x, d.y, d.width, d.height);
      setTimeout(() => clearDragging(), 50);
    },
    [id, updateWindowPosition, clearDragging],
  );

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    setDragging(id);
    bringToFront(id);
  }, [id, bringToFront, setDragging]);

  const handleHeaderPointerDown = useCallback((e) => {
    e.stopPropagation();
  }, []);

  const handleDoubleClick = useCallback(
    (e) => {
      e.stopPropagation();
      maximizeWindow(id);
    },
    [id, maximizeWindow],
  );

  const handleWindowPointerDown = useCallback(() => {
    focusWindow(id);
    bringToFront(id);
  }, [id, focusWindow, bringToFront]);

  const handleContentDoubleClick = useCallback((e) => {
    e.stopPropagation();
  }, []);

  if (isMinimized) return null;

  const activeClass =
    isDragging || isResizing
      ? "border-blue-500/80 shadow-[0_0_30px_rgba(59,130,246,0.3)]"
      : isActive
        ? "border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]"
        : "border-neutral-700 shadow-2xl";

  const headerBg = isActive ? "bg-neutral-800" : "bg-neutral-800/80";

  const headerButtons = (
    <div className="flex items-center ml-auto gap-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          minimizeWindow(id);
        }}
        className="w-11 h-8 flex items-center justify-center hover:bg-neutral-600 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          maximizeWindow(id);
        }}
        className="w-11 h-8 flex items-center justify-center hover:bg-neutral-600 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <rect x="2" y="3" width="5" height="5" rx="0.5" />
            <path d="M3 3V1.5a1 1 0 011-1h4.5a1 1 0 011 1V6" />
          </svg>
        ) : (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          </svg>
        )}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          closeWindow(id);
        }}
        className="w-11 h-8 flex items-center justify-center hover:bg-red-600 text-neutral-400 hover:text-white transition-colors cursor-pointer"
        title="Close"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M0 0L10 10M10 0L0 10" />
        </svg>
      </button>
    </div>
  );

  if (isMaximized) {
    const bounds = getViewBounds();
    return (
      <Rnd
        ref={frameRef}
        position={{ x: bounds.x, y: bounds.y }}
        size={{ width: bounds.width, height: bounds.height }}
        disableDragging
        enableResizing={false}
        style={{ zIndex: z }}
        scale={scale}
        onDragStart={handleDragStart}
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResizeStop={handleResizeStop}
        className={`flex flex-col overflow-hidden bg-neutral-900 border transition-[border-color,box-shadow] duration-150 ${activeClass}`}
      >
        <div
          className={`window-drag-handle flex items-center h-8 px-3 ${headerBg} border-b border-neutral-700 select-none shrink-0`}
          onPointerDown={handleHeaderPointerDown}
          onDoubleClick={handleDoubleClick}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-sm text-neutral-300 font-medium truncate flex-1">
            {title}
          </span>
          {headerButtons}
        </div>
        <div
          className="flex-1 overflow-auto text-neutral-200 h-full"
          onPointerDown={handleWindowPointerDown}
          onDoubleClick={handleContentDoubleClick}
          onClick={(e) => e.stopPropagation()}
        >
          {cloneElement(children, { windowId: id })}
        </div>
      </Rnd>
    );
  }

  return (
    <Rnd
      ref={frameRef}
      default={{
        x: win?.x ?? defaultX,
        y: win?.y ?? defaultY,
        width: win?.width || defaultWidth,
        height: win?.height || defaultHeight,
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      style={{ zIndex: z }}
      scale={scale}
      dragHandleClassName="window-drag-handle"
      disableDragging={isActive}
      enableResizing={isActive ? false : RESIZE_CONFIG}
      onDragStart={handleDragStart}
      onDragStop={handleDragStop}
      onResizeStart={handleResizeStart}
      onResizeStop={handleResizeStop}
      className={`flex flex-col rounded-lg overflow-hidden bg-neutral-900 border transition-[border-color,box-shadow] duration-150 ${activeClass}`}
    >
      <div
        className={`window-drag-handle flex items-center h-8 px-3 ${headerBg} border-b border-neutral-700 cursor-grab select-none shrink-0 active:cursor-grabbing active:bg-neutral-700`}
        onPointerDown={handleHeaderPointerDown}
        onDoubleClick={handleDoubleClick}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm text-neutral-300 font-medium truncate flex-1">
          {title}
        </span>
        {headerButtons}
      </div>
      <div
        className="flex-1 overflow-auto text-neutral-200 h-full"
        onPointerDown={handleWindowPointerDown}
        onDoubleClick={handleContentDoubleClick}
        onClick={(e) => e.stopPropagation()}
      >
        {cloneElement(children, { windowId: id })}
      </div>
    </Rnd>
  );
}
