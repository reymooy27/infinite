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
};
