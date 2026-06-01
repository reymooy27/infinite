"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState, cloneElement } from "react";
import { Rnd } from "react-rnd";
import { useWindowStore } from "@/stores/useWindowStore";
import { canvasTransform } from "@/lib/canvasTransform";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const LONG_PRESS_DURATION = 200;
const DRAG_THRESHOLD = 5;
const EDGE_RESIZE_HIT_SIZE = 28;
const CORNER_RESIZE_HIT_SIZE = 76;

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

const MOBILE_RESIZE_CONFIG = {
  bottomRight: true,
  bottomLeft: false,
  topRight: false,
  topLeft: false,
  right: false,
  left: false,
  bottom: false,
  top: false,
};

interface WindowFrameProps {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultX?: number;
  defaultY?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}

export default function WindowFrame({
  id,
  title,
  children,
  defaultX = 50,
  defaultY = 50,
  defaultWidth = 400,
  defaultHeight = 300,
}: WindowFrameProps) {
  const win = useWindowStore((s) => s.windows.find((w) => w.id === id));
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const focusTargetId = useWindowStore((s) => s.focusTargetId);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const maximizeWindow = useWindowStore((s) => s.maximizeWindow);
  const bringToFront = useWindowStore((s) => s.bringToFront);
  const setDragging = useWindowStore((s) => s.setDragging);
  const clearDragging = useWindowStore((s) => s.clearDragging);
  const renameWindow = useWindowStore((s) => s.renameWindow);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const frameRef = useRef<any>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pointerDownTime = useRef<number>(0);
  const pointerDownPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isLongPress = useRef(false);
  const isDraggingRef = useRef(false);

  const handleScroll = useCallback(
    (direction: "up" | "down") => {
      const action = direction === "up" ? "pageup" : "pagedown";

      // Dispatch page up/down event for apps that support it
      const event = new CustomEvent(`app-page-${id}`, {
        detail: { action },
      });
      window.dispatchEvent(event);

      // Also dispatch old scroll event for compatibility
      const amount = direction === "up" ? -150 : 150;
      const scrollEvent = new CustomEvent(`app-scroll-${id}`, {
        detail: { amount, direction },
      });
      window.dispatchEvent(scrollEvent);

      // Manual fallback for standard scrollable elements
      if (contentRef.current) {
        const targets = contentRef.current.querySelectorAll(
          ".overflow-auto, .xterm-viewport",
        );
        targets.forEach((t) => t.scrollBy({ top: amount, behavior: "smooth" }));
      }
    },
    [id],
  );

  const z = win?.z ?? 1;
  const scale = (canvasTransform.current as any)?.state?.scale ?? 1;
  const isActive = focusTargetId === id;
  const isMaximized = win?.maximized;
  const isMinimized = win?.minimized;
  const maxZ = useWindowStore((s) => Math.max(...s.windows.map((w) => w.z), 0));
  const resizeConfig = isMobile ? MOBILE_RESIZE_CONFIG : RESIZE_CONFIG;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateIsMobile = (event?: MediaQueryList | MediaQueryListEvent) => {
      setIsMobile(event?.matches ?? mediaQuery.matches);
    };

    updateIsMobile(mediaQuery);
    mediaQuery.addEventListener("change", updateIsMobile);

    return () => {
      mediaQuery.removeEventListener("change", updateIsMobile);
    };
  }, []);

  const getViewBounds = useCallback(() => {
    const inst = canvasTransform.current as any;
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

  const handleDragStart = useCallback(
    (e: any, _d: any) => {
      const elapsed = Date.now() - pointerDownTime.current;
      const dx = e.clientX - pointerDownPos.current.x;
      const dy = e.clientY - pointerDownPos.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (elapsed < LONG_PRESS_DURATION && distance < DRAG_THRESHOLD) {
        return;
      }
      isDraggingRef.current = true;
      setIsDragging(true);
      setDragging(id);
      bringToFront(id);
      const inst = canvasTransform.current as any;
      if (inst?.setup?.panning) inst.setup.panning.disabled = true;
    },
    [id, bringToFront, setDragging],
  );

  const handleDragStop = useCallback(
    (_e: any, data: any) => {
      setIsDragging(false);
      isDraggingRef.current = false;
      if (isMaximized) return;
      useWindowStore.getState().updateWindowPosition(id, { x: data.x, y: data.y });
      setTimeout(() => clearDragging(), 50);
      const inst = canvasTransform.current as any;
      if (inst?.setup?.panning) inst.setup.panning.disabled = false;
    },
    [clearDragging, id, isMaximized],
  );

  const handleResizeStop = useCallback(
    (_e: any, _dir: any, _ref: any, delta: { width: number; height: number }, position: { x: number; y: number }) => {
      setIsResizing(false);
      const state = useWindowStore.getState();
      const currentWin = state.windows.find((w) => w.id === id);
      if (currentWin) {
        state.updateWindowPosition(id, {
          width: currentWin.width + delta.width,
          height: currentWin.height + delta.height,
          x: position.x,
          y: position.y,
        });
      }
      setTimeout(() => clearDragging(), 50);
      // Re-enable canvas panning after resize
      const inst = canvasTransform.current as any;
      if (inst?.setup?.panning) inst.setup.panning.disabled = false;
    },
    [clearDragging, id],
  );

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    setDragging(id);
    bringToFront(id);
    // Disable canvas panning while resizing window
    const inst = canvasTransform.current as any;
    if (inst?.setup?.panning) inst.setup.panning.disabled = true;
  }, [id, bringToFront, setDragging]);

  const handleHeaderPointerDown = useCallback((e: any) => {
    e.stopPropagation();
    pointerDownTime.current = Date.now();
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    isLongPress.current = false;
    isDraggingRef.current = false;
  }, []);

  const handleDoubleClick = useCallback(
    (e: any) => {
      e.stopPropagation();
      maximizeWindow(id);
    },
    [id, maximizeWindow],
  );

  const handleWindowPointerDown = useCallback(() => {
    bringToFront(id);
  }, [id, bringToFront]);

  const handleContentDoubleClick = useCallback((e: any) => {
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
    <div
      className="flex items-center ml-auto gap-0 touch-manipulation"
      onPointerDown={(e: any) => e.stopPropagation()}
    >
      <button
        onPointerDown={(e: any) => e.stopPropagation()}
        onClick={(e: any) => {
          e.stopPropagation();
          setEditValue(title);
          setIsEditing(true);
        }}
        className="w-10 h-10 flex items-center justify-center hover:bg-neutral-600 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer active:bg-neutral-500 touch-manipulation"
        title="Rename"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button
        onPointerDown={(e: any) => e.stopPropagation()}
        onClick={(e: any) => {
          e.stopPropagation();
          minimizeWindow(id);
        }}
        className="w-12 h-10 flex items-center justify-center hover:bg-neutral-600 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer active:bg-neutral-500 touch-manipulation"
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        onPointerDown={(e: any) => e.stopPropagation()}
        onClick={(e: any) => {
          e.stopPropagation();
          maximizeWindow(id);
        }}
        className="w-12 h-10 flex items-center justify-center hover:bg-neutral-600 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer active:bg-neutral-500 touch-manipulation"
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
        onPointerDown={(e: any) => e.stopPropagation()}
        onClick={(e: any) => {
          e.stopPropagation();
          closeWindow(id);
        }}
        className="w-12 h-10 flex items-center justify-center hover:bg-red-600 text-neutral-400 hover:text-white transition-colors cursor-pointer active:bg-red-500 touch-manipulation"
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
    const isTopWindow = z >= maxZ;
    return (
      <div
        style={{
          zIndex: isTopWindow ? 10001 : z,
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
        }}
        className={`flex flex-col overflow-hidden bg-neutral-900 ${isTopWindow ? "ring-1 ring-neutral-700" : ""}`}
      >
        <div
          className={`flex items-center h-10 px-3 ${headerBg} border-b border-neutral-700 select-none shrink-0`}
          onPointerDown={handleHeaderPointerDown}
          onDoubleClick={handleDoubleClick}
          onClick={(e: any) => e.stopPropagation()}
        >
          {isEditing ? (
            <input
              autoFocus
              className="text-sm text-neutral-100 font-medium bg-neutral-700 border border-neutral-500 rounded px-1.5 py-0.5 outline-none w-48 max-w-full"
              value={editValue}
              onChange={(e: any) => setEditValue(e.target.value)}
              onBlur={() => { renameWindow(id, editValue || title); setIsEditing(false); }}
              onKeyDown={(e: any) => {
                if (e.key === "Enter") { renameWindow(id, editValue || title); setIsEditing(false); }
                if (e.key === "Escape") setIsEditing(false);
                e.stopPropagation();
              }}
              onPointerDown={(e: any) => e.stopPropagation()}
              onClick={(e: any) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm text-neutral-300 font-medium truncate pr-32">{title}</span>
          )}
        </div>

        {/* Floating buttons outside of drag handle */}
        <div
          className="absolute top-0 right-0 h-10 flex items-center z-[60]"
          onPointerDown={(e: any) => e.stopPropagation()}
        >
          {headerButtons}
        </div>

        <div
          ref={contentRef}
          className="flex-1 min-h-0 w-full overflow-hidden text-neutral-200"
          style={{ height: "calc(100vh - 40px)" }}
          onPointerDown={(e: any) => {
            handleWindowPointerDown();
            e.stopPropagation();
          }}
          onDoubleClick={handleContentDoubleClick}
          onClick={(e: any) => e.stopPropagation()}
        >
          {cloneElement(children as any, {
            windowId: id,
            connectionId: win?.metadata?.connectionId,
            initialUrl: win?.metadata?.initialUrl,
          })}
        </div>

        {/* Floating scroll buttons for mobile - Right edge */}
        <div
          className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-[100]"
          onPointerDown={(e: any) => e.stopPropagation()}
        >
          <button
            onPointerDown={(e: any) => {
              e.stopPropagation();
              handleScroll("up");
            }}
            className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
          <button
            onPointerDown={(e: any) => {
              e.stopPropagation();
              handleScroll("down");
            }}
            className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
      </div>
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
      style={{ zIndex: z, display: "flex", willChange: "transform" }}
      scale={scale}
      dragHandleClassName="window-drag-handle"
      disableDragging={false}
      enableResizing={resizeConfig}
      resizeHandleStyles={{
        bottom: { height: `${EDGE_RESIZE_HIT_SIZE}px`, bottom: 0 },
        right: { width: `${EDGE_RESIZE_HIT_SIZE}px`, right: 0 },
        bottomRight: {
          width: `${CORNER_RESIZE_HIT_SIZE}px`,
          height: `${CORNER_RESIZE_HIT_SIZE}px`,
          right: 0,
          bottom: 0,
        },
        bottomLeft: {
          width: `${CORNER_RESIZE_HIT_SIZE}px`,
          height: `${CORNER_RESIZE_HIT_SIZE}px`,
          left: 0,
          bottom: 0,
        },
        topRight: {
          width: `${CORNER_RESIZE_HIT_SIZE}px`,
          height: `${CORNER_RESIZE_HIT_SIZE}px`,
          right: 0,
          top: 0,
        },
        topLeft: {
          width: `${CORNER_RESIZE_HIT_SIZE}px`,
          height: `${CORNER_RESIZE_HIT_SIZE}px`,
          left: 0,
          top: 0,
        },
      }}
      onDragStart={handleDragStart}
      onDragStop={handleDragStop}
      onResizeStart={handleResizeStart}
      onResizeStop={handleResizeStop}
      className={`flex flex-col rounded-lg bg-neutral-900 border transition-[border-color,box-shadow] duration-150 ${activeClass}`}
    >
      <div
        className={`window-drag-handle flex items-center h-10 px-3 ${headerBg} border-b border-neutral-700 cursor-grab select-none shrink-0 active:cursor-grabbing active:bg-neutral-700 touch-none`}
        onPointerDown={handleHeaderPointerDown}
        onDoubleClick={handleDoubleClick}
        onClick={(e: any) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1 mr-2 opacity-40">
          <div className="w-4 h-0.5 bg-neutral-400 rounded-full" />
          <div className="w-4 h-0.5 bg-neutral-400 rounded-full" />
        </div>
        {isEditing ? (
          <input
            autoFocus
            className="text-sm text-neutral-100 font-medium bg-neutral-700 border border-neutral-500 rounded px-1.5 py-0.5 outline-none w-48 max-w-full"
            value={editValue}
            onChange={(e: any) => setEditValue(e.target.value)}
            onBlur={() => { renameWindow(id, editValue || title); setIsEditing(false); }}
            onKeyDown={(e: any) => {
              if (e.key === "Enter") { renameWindow(id, editValue || title); setIsEditing(false); }
              if (e.key === "Escape") setIsEditing(false);
              e.stopPropagation();
            }}
            onPointerDown={(e: any) => { if (e.button === 1) e.preventDefault(); e.stopPropagation(); }}
            onClick={(e: any) => e.stopPropagation()}
          />
        ) : (
          <span className="text-sm text-neutral-300 font-medium truncate pr-32">{title}</span>
        )}
      </div>

      {/* Floating buttons outside of drag handle */}
      <div
        className="absolute top-0 right-0 h-10 flex items-center z-[60]"
        onPointerDown={(e: any) => e.stopPropagation()}
      >
        {headerButtons}
      </div>

      <div
        ref={contentRef}
        className="flex-1 min-h-0 w-full overflow-hidden text-neutral-200 pb-2 h-full"
        onPointerDown={(e: any) => {
          handleWindowPointerDown();
          e.stopPropagation();
        }}
        onMouseDown={(e: any) => {
          if (e.button === 1) e.preventDefault();
        }}
        onDoubleClick={handleContentDoubleClick}
        onClick={(e: any) => e.stopPropagation()}
      >
        {cloneElement(children as any, {
          windowId: id,
          connectionId: win?.metadata?.connectionId,
          initialUrl: win?.metadata?.initialUrl,
        })}
      </div>
      {/* Visual resize handle for mobile */}
      <div className="absolute bottom-0.5 right-0.5 h-8 w-8 pointer-events-none text-blue-400/90 opacity-80 md:hidden">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        >
          <line x1="20" y1="12" x2="12" y2="20" />
          <line x1="20" y1="18" x2="18" y2="20" />
        </svg>
      </div>

      {/* Scroll Helper Buttons for Mobile - Floating to the right */}
      <div
        className="absolute -right-14 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-[100] md:hidden"
        onPointerDown={(e: any) => e.stopPropagation()}
      >
        <button
          onPointerDown={(e: any) => {
            e.stopPropagation();
            handleScroll("up");
          }}
          className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
        <button
          onPointerDown={(e: any) => {
            e.stopPropagation();
            handleScroll("down");
          }}
          className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
    </Rnd>
  );
}
