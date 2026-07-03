import { create } from "zustand";
import { useWindowStore } from "@/stores/useWindowStore";

type TransferMode = "upload" | "download";
type TransferConnection = { id: number; name: string };

interface FileTransferState {
  openUpload: (conn: TransferConnection) => void;
  openDownload: (conn: TransferConnection) => void;
}

function openTransferWindow(conn: TransferConnection, mode: TransferMode) {
  useWindowStore.getState().openApp("fileTransfer", undefined, undefined, {
    connectionId: conn.id,
    connectionName: conn.name,
    mode,
    title: `File Transfer - ${conn.name}`,
  });
}

export const useFileTransferStore = create<FileTransferState>(() => ({
  openUpload: (conn) => openTransferWindow(conn, "upload"),
  openDownload: (conn) => openTransferWindow(conn, "download"),
}));
