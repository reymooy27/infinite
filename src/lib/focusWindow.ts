import { canvasTransform } from "@/lib/canvasTransform";
import { useWindowStore } from "@/stores/useWindowStore";

const DEFAULT_ATTEMPTS = 30;

export const centerWindowById = (windowId: string, attempts = DEFAULT_ATTEMPTS) => {
  let tries = 0;

  const tryCenter = () => {
    const win = useWindowStore.getState().windows.find((item) => item.id === windowId);
    if (!win) return;
    if (canvasTransform.centerOnWindow(win) || tries++ >= attempts) return;
    requestAnimationFrame(tryCenter);
  };

  requestAnimationFrame(tryCenter);
};
