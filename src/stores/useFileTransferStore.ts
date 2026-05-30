import { create } from "zustand";

interface TransferInfo {
  id: string;
  connectionId: number;
  connectionName: string;
  mode: "upload" | "download";
  fileName: string;
  fileSize: number;
  bytesDone: number;
  status: "input" | "transferring" | "done" | "error";
  errorMessage?: string;
}

interface FileTransferState {
  showModal: boolean;
  modalMode: "upload" | "download" | null;
  modalConnection: { id: number; name: string } | null;
  showPanel: boolean;
  activeTransfers: TransferInfo[];
  openUpload: (conn: { id: number; name: string }) => void;
  openDownload: (conn: { id: number; name: string }) => void;
  closeModal: () => void;
  setShowPanel: (show: boolean) => void;
  togglePanel: () => void;
  upsertTransfer: (info: TransferInfo) => void;
  removeTransfer: (id: string) => void;
}

export const useFileTransferStore = create<FileTransferState>((set) => ({
  showModal: false,
  modalMode: null,
  modalConnection: null,
  showPanel: false,
  activeTransfers: [],

  openUpload: (conn) =>
    set({ showModal: true, modalMode: "upload", modalConnection: conn, showPanel: false }),

  openDownload: (conn) =>
    set({ showModal: true, modalMode: "download", modalConnection: conn, showPanel: false }),

  closeModal: () =>
    set({ showModal: false, modalMode: null, modalConnection: null }),

  setShowPanel: (show) => set({ showPanel: show }),

  togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),

  upsertTransfer: (info) =>
    set((s) => {
      const existing = s.activeTransfers.findIndex((t) => t.id === info.id);
      if (existing >= 0) {
        const next = [...s.activeTransfers];
        next[existing] = info;
        return { activeTransfers: next };
      }
      return { activeTransfers: [info, ...s.activeTransfers] };
    }),

  removeTransfer: (id) =>
    set((s) => ({
      activeTransfers: s.activeTransfers.filter((t) => t.id !== id),
    })),
}));
