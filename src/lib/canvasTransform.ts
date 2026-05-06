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
};
