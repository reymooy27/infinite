"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useRef, useState, cloneElement } from "react";
import { Rnd } from "react-rnd";
import { useWindowStore } from "@/stores/useWindowStore";
import { canvasTransform } from "@/lib/canvasTransform";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const LONG_PRESS_DURATION = 200;
const DRAG_THRESHOLD = 5;

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

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const frameRef = useRef<any>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pointerDownTime = useRef<number>(0);
  const pointerDownPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isLongPress = useRef(false);
  const isDraggingRef = useRef(false);

  const handleScroll = useCallback((direction: "up" | "down") => {
    const amount = direction === "up" ? -150 : 150;
    
    // Dispatch a custom event that components can listen to
    const event = new CustomEvent(`app-scroll-${id}`, { 
      detail: { amount, direction } 
    });
    window.dispatchEvent(event);

    // Manual fallback for standard scrollable elements
    if (contentRef.current) {
      const targets = contentRef.current.querySelectorAll('.overflow-auto, .xterm-viewport');
      targets.forEach(t => t.scrollBy({ top: amount, behavior: 'smooth' }));
    }
  }, [id]);

  const z = win?.z ?? 1;
  const scale = (canvasTransform.current as any)?.state?.scale ?? 1;
  const isActive = focusTargetId === id;
  const isMaximized = win?.maximized;
  const isMinimized = win?.minimized;

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

  const handleDragStart = useCallback((e: any, _d: any) => {
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
  }, [id, bringToFront, setDragging]);

  const handleDragStop = useCallback(
    (_e: any, _d: any) => {
      setIsDragging(false);
      isDraggingRef.current = false;
      if (isMaximized) return;
      setTimeout(() => clearDragging(), 50);
      const inst = canvasTransform.current as any;
      if (inst?.setup?.panning) inst.setup.panning.disabled = false;
    },
    [clearDragging, isMaximized],
  );

  const handleResizeStop = useCallback(
    (_e: any, _dir: any, _ref: any, _d: any) => {
      setIsResizing(false);
      setTimeout(() => clearDragging(), 50);
      // Re-enable canvas panning after resize
      const inst = canvasTransform.current as any;
      if (inst?.setup?.panning) inst.setup.panning.disabled = false;
    },
    [clearDragging],
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
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="2" y="3" width="5" height="5" rx="0.5" />
            <path d="M3 3V1.5a1 1 0 011-1h4.5a1 1 0 011 1V6" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
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
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5">
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
          className={`window-drag-handle flex items-center h-10 px-3 ${headerBg} border-b border-neutral-700 select-none shrink-0`}
          onPointerDown={handleHeaderPointerDown}
          onDoubleClick={handleDoubleClick}
          onClick={(e: any) => e.stopPropagation()}
        >
          <span className="text-sm text-neutral-300 font-medium truncate pr-32">
            {title}
          </span>
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
          className="flex-1 min-h-0 w-full overflow-hidden text-neutral-200 pb-16 h-full touch-auto"
          onPointerDown={(e: any) => {
            handleWindowPointerDown();
            e.stopPropagation();
          }}
          onDoubleClick={handleContentDoubleClick}
          onClick={(e: any) => e.stopPropagation()}
        >
          {cloneElement(children as any, { windowId: id })}
        </div>

        {/* Floating scroll buttons for mobile - Right edge */}
        <div 
          className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-[100]"
          onPointerDown={(e: any) => e.stopPropagation()}
        >
          <button 
            onPointerDown={(e: any) => { e.stopPropagation(); handleScroll('up'); }}
            className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
          <button 
            onPointerDown={(e: any) => { e.stopPropagation(); handleScroll('down'); }}
            className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
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
      disableDragging={false}
      enableResizing={RESIZE_CONFIG}
      resizeHandleStyles={{
        bottom: { height: "20px", bottom: "-10px" },
        right: { width: "20px", right: "-10px" },
        bottomRight: { width: "30px", height: "30px", right: "-15px", bottom: "-15px" },
        bottomLeft: { width: "30px", height: "30px", left: "-15px", bottom: "-15px" },
        topRight: { width: "30px", height: "30px", right: "-15px", top: "-15px" },
        topLeft: { width: "30px", height: "30px", left: "-15px", top: "-15px" },
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
        <span className="text-sm text-neutral-300 font-medium truncate pr-32">
          {title}
        </span>
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
        className="flex-1 min-h-0 w-full overflow-hidden text-neutral-200 pb-16 h-full"
        onPointerDown={(e: any) => {
          handleWindowPointerDown();
          e.stopPropagation();
        }}
        onDoubleClick={handleContentDoubleClick}
        onClick={(e: any) => e.stopPropagation()}
      >
        {cloneElement(children as any, { windowId: id })}
      </div>

      {/* Visual resize handle for mobile */}
      <div className="absolute bottom-1 right-1 w-4 h-4 pointer-events-none opacity-30">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="20" y1="12" x2="12" y2="20" />
          <line x1="20" y1="18" x2="18" y2="20" />
        </svg>
      </div>

      {/* Scroll Helper Buttons for Mobile - Floating to the right */}
      <div 
        className="absolute -right-14 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-[100]"
        onPointerDown={(e: any) => e.stopPropagation()}
      >
        <button 
          onPointerDown={(e: any) => { e.stopPropagation(); handleScroll('up'); }}
          className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
        <button 
          onPointerDown={(e: any) => { e.stopPropagation(); handleScroll('down'); }}
          className="w-12 h-12 rounded-full bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-white active:bg-neutral-600 shadow-2xl backdrop-blur-sm"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
    </Rnd>
    );

}
