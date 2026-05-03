import { create } from "zustand";

type NavigationCallback = () => void;

interface NavigationBlockState {
  isBlocked: boolean;
  message: string;
  onConfirm: NavigationCallback | null;
  block: (message: string, onConfirm?: NavigationCallback) => void;
  unblock: () => void;
  confirm: () => void;
}

export const useNavigationBlockStore = create<NavigationBlockState>((set, get) => ({
  isBlocked: false,
  message: "",
  onConfirm: null,

  block: (message, onConfirm) => set({
    isBlocked: true,
    message,
    onConfirm: onConfirm || null,
  }),

  unblock: () => set({
    isBlocked: false,
    message: "",
    onConfirm: null,
  }),

  confirm: () => {
    const { onConfirm } = get();
    if (onConfirm) onConfirm();
    get().unblock();
  },
}));