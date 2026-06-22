import type { WindowData } from "@/types";

type TransformState = {
  scale?: number;
  positionX?: number;
  positionY?: number;
};

type TransformInstance = {
  state?: TransformState;
  wrapperComponent?: HTMLElement;
  contentComponent?: HTMLElement;
  setState?: (scale: number, positionX: number, positionY: number) => void;
  setTransform?: (
    positionX: number,
    positionY: number,
    scale: number,
    animationTime?: number,
  ) => void;
  instance?: TransformInstance;
};

type TransformListener = (state: TransformState) => void;

type PendingCenterTarget = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

const getInstance = (): TransformInstance | null => {
  const current = canvasTransform.current as TransformInstance | null;
  return current?.instance ?? current ?? null;
};

const getWrapper = (inst: TransformInstance | null): HTMLElement | null =>
  inst?.wrapperComponent ?? null;

const listeners = new Set<TransformListener>();
let pendingCenterTarget: PendingCenterTarget | null = null;

const applyTransform = (
  inst: TransformInstance | null,
  positionX: number,
  positionY: number,
  scale: number,
) => {
  if (!inst) return false;
  if (inst?.setTransform) {
    inst.setTransform(positionX, positionY, scale, 0);
    return true;
  }
  if (inst?.setState) {
    if (!inst.contentComponent) return false;
    inst.setState(scale, positionX, positionY);
    return true;
  }
  return false;
};

export const canvasTransform = {
  current: null as TransformInstance | null,
  setCurrent: (inst: TransformInstance | null) => {
    canvasTransform.current = inst;
    canvasTransform.flushPendingCenter();
  },
  getInstance,
  getState: () => getInstance()?.state ?? null,
  subscribe: (listener: TransformListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  notify: (state: TransformState) => {
    listeners.forEach((listener) => listener(state));
  },
  applyTransform,
  flushPendingCenter: () => {
    if (!pendingCenterTarget) return false;
    const inst = getInstance();
    const wrapper = getWrapper(inst);
    if (!inst?.state || !wrapper || wrapper.offsetWidth === 0 || wrapper.offsetHeight === 0) {
      return false;
    }

    const target = pendingCenterTarget;
    pendingCenterTarget = null;
    canvasTransform.centerOnWindow(target);
    return true;
  },
  getViewportCenter: () => {
    const inst = getInstance();
    const wrapper = getWrapper(inst);
    const state = inst?.state;
    if (!wrapper || !state) return null;

    const scale = state.scale ?? 1;
    if (scale <= 0 || !isFinite(scale)) return null;

    return {
      x: (wrapper.offsetWidth / 2 - (state.positionX ?? 0)) / scale,
      y: (wrapper.offsetHeight / 2 - (state.positionY ?? 0)) / scale,
      scale,
    };
  },
  screenToCanvas: (clientX: number, clientY: number) => {
    const inst = getInstance();
    const wrapper = getWrapper(inst);
    const state = inst?.state;
    if (!wrapper || !state) return null;

    const scale = state.scale ?? 1;
    if (scale <= 0 || !isFinite(scale)) return null;

    const rect = wrapper.getBoundingClientRect();
    return {
      x: (clientX - rect.left - (state.positionX ?? 0)) / scale,
      y: (clientY - rect.top - (state.positionY ?? 0)) / scale,
      scale,
    };
  },
  resetZoom: () => {
    const inst = getInstance();
    if (inst?.setTransform || inst?.setState) {
      const wrapper = getWrapper(inst);
      if (wrapper) {
        applyTransform(
          inst,
          wrapper.offsetWidth / 2 - 5000,
          wrapper.offsetHeight / 2 - 5000,
          1,
        );
      }
    }
  },
  centerOnWindow: (win: { x: number; y: number; width?: number; height?: number }) => {
    const inst = getInstance();
    const wrapper = getWrapper(inst);
    if (!inst?.state || !wrapper || wrapper.offsetWidth === 0 || wrapper.offsetHeight === 0) {
      pendingCenterTarget = {
        x: win.x,
        y: win.y,
        width: win.width,
        height: win.height,
      };
      return false;
    }
    const vw = wrapper.offsetWidth;
    const vh = wrapper.offsetHeight;
    const winW = win.width || 400;
    const winH = win.height || 300;
    const winCenterX = win.x + winW / 2;
    const winCenterY = win.y + winH / 2;
    const scale = inst.state.scale || 1;
    const tx = vw / 2 - winCenterX * scale;
    const ty = vh / 2 - winCenterY * scale;
    pendingCenterTarget = null;
    return applyTransform(inst, tx, ty, scale);
  },
  fitToWindows: (windows: WindowData[]) => {
    const inst = getInstance();
    const wrapper = getWrapper(inst);
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

    applyTransform(inst, tx, ty, scale);
  },
};
