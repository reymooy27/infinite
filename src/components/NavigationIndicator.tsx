"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canvasTransform } from "@/lib/canvasTransform";
import { centerWindowById } from "@/lib/focusWindow";
import { useWindowStore } from "@/stores/useWindowStore";

export default function NavigationIndicator() {
  const windows = useWindowStore((s) => s.windows);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const [dir, setDir] = useState<{ angle: number; dist: number; targetId: string } | null>(null);
  const showing = useRef(false);

  useEffect(() => {
    let raf: number;
    let prevKey = "";

    const check = () => {
      const inst = canvasTransform.getInstance();
      if (!inst?.state?.scale) {
        raf = requestAnimationFrame(check);
        return;
      }

      const scale = inst.state.scale;
      const positionX = inst.state.positionX ?? 0;
      const positionY = inst.state.positionY ?? 0;
      const wrapper = inst.wrapperComponent as HTMLElement | undefined;
      if (!wrapper) {
        raf = requestAnimationFrame(check);
        return;
      }

      const vw = wrapper.offsetWidth;
      const vh = wrapper.offsetHeight;

      const vpX = -positionX / scale;
      const vpY = -positionY / scale;
      const vpW = vw / scale;
      const vpH = vh / scale;
      const vpCX = vpX + vpW / 2;
      const vpCY = vpY + vpH / 2;

      let anyVisible = false;
      let nearest: (typeof windows)[0] | null = null;
      let nearestDist = Infinity;

      for (const win of windows) {
        const wx = win.x;
        const wy = win.y;
        const ww = win.width || 400;
        const wh = win.height || 300;

        if (
          wx + ww > vpX &&
          wx < vpX + vpW &&
          wy + wh > vpY &&
          wy < vpY + vpH
        ) {
          anyVisible = true;
          break;
        }

        const cx = wx + ww / 2;
        const cy = wy + wh / 2;
        const dx = cx - vpCX;
        const dy = cy - vpCY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = win;
        }
      }

      if (!anyVisible && nearest && windows.length > 0) {
        const cx = nearest.x + (nearest.width || 400) / 2;
        const cy = nearest.y + (nearest.height || 300) / 2;
        const dx = cx - vpCX;
        const dy = cy - vpCY;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI) - 90;

        const key = `${angle.toFixed(1)}-${nearestDist.toFixed(0)}`;
        if (key !== prevKey) {
          prevKey = key;
          setDir({ angle, dist: nearestDist, targetId: nearest.id });
        }
        showing.current = true;
      } else {
        if (showing.current) {
          showing.current = false;
          setDir(null);
        }
      }

      raf = requestAnimationFrame(check);
    };

    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [windows]);

  const handleClick = useCallback(() => {
    if (!dir) return;
    focusWindow(dir.targetId);
    centerWindowById(dir.targetId);
  }, [dir, focusWindow]);

  if (!dir) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9998] flex flex-col items-center gap-1 pointer-events-none">
      <button
        onClick={handleClick}
        className="w-10 h-10 flex items-center justify-center bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-full shadow-2xl cursor-pointer pointer-events-auto hover:bg-neutral-800 transition-colors active:bg-neutral-700"
        style={{ transform: `rotate(${dir.angle}deg)` }}
        title={`Navigate to nearest window (${Math.round(dir.dist / 100) * 100}px)`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-blue-400"
        >
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </button>
      <span className="text-[10px] text-neutral-500 font-mono pointer-events-auto">
        {Math.round(dir.dist / 100) * 100}px
      </span>
    </div>
  );
}
