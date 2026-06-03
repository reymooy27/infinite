import type { WindowData } from "@/types";

export const canvasTransform = {
  current: null as any,
  resetZoom: () => {
    const inst = canvasTransform.current;
    if (inst?.setState) {
      const wrapper = (inst as unknown as { wrapperComponent?: HTMLElement })?.wrapperComponent;
      if (wrapper) {
        inst.setState(1, wrapper.offsetWidth / 2 - 5000, wrapper.offsetHeight / 2 - 5000);
      }
    }
  },
  centerOnWindow: (win: { x: number; y: number; width?: number; height?: number }) => {
    const inst = canvasTransform.current;
    if (!inst?.state) return;
    const wrapper = (inst as unknown as { wrapperComponent?: HTMLElement })?.wrapperComponent;
    if (!wrapper) return;
    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;
    const winW = win.width || 400;
    const winH = win.height || 300;
    const winCenterX = win.x + winW / 2;
    const winCenterY = win.y + winH / 2;
    const scale = inst.state.scale || 1;
    const tx = vw / 2 - winCenterX * scale;
    const ty = vh / 2 - winCenterY * scale;
    inst.setState?.(scale, tx, ty);
  },
  fitToWindows: (windows: WindowData[]) => {
    const inst = canvasTransform.current;
    const wrapper = (inst as unknown as { wrapperComponent?: HTMLElement })?.wrapperComponent;
    if (!inst?.setTransform || !wrapper || windows.length === 0) return;

    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;
    const padding = 80;

    // Compute bounding box of all windows
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of windows) {
      const winW = w.width || 400;
      const winH = w.height || 300;
      if (w.x < minX) minX = w.x;
      if (w.y < minY) minY = w.y;
      if (w.x + winW > maxX) maxX = w.x + winW;
      if (w.y + winH > maxY) maxY = w.y + winH;
    }

    const boxW = maxX - minX;
    const boxH = maxY - minY;
    if (boxW <= 0 || boxH <= 0) return;

    // Calculate scale to fit with padding
    const availW = vw - padding * 2;
    const availH = vh - padding * 2;
    const scale = Math.min(availW / boxW, availH / boxH, 1.2);

    // Center the bounding box in the viewport
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const tx = vw / 2 - centerX * scale;
    const ty = vh / 2 - centerY * scale;

    inst.setTransform(tx, ty, scale, 0);
  },
};
