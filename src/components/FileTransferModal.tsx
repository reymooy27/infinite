import { Upload, Download, X, FileText, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes } from "react";
import { buildWsUrl } from "@/lib/ws";
import { useWindowStore } from "@/stores/useWindowStore";

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const CHUNK_SIZE = 64 * 1024;

type UploadSelection = {
  file: File;
  displayPath: string;
  relativePath?: string;
  treatDestAsDirectory: boolean;
};

type TransferProgress = {
  bytesDone: number;
  total: number;
  currentLabel: string;
  itemIndex: number;
  itemCount: number;
};

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

export default function FileTransferWindow({ windowId }: { windowId?: string }) {
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const metadata = useWindowStore((s) => s.windows.find((w) => w.id === windowId)?.metadata);

  const mode = metadata?.mode === "download" ? "download" : "upload";
  const connectionId = typeof metadata?.connectionId === "number" ? metadata.connectionId : null;
  const connectionName = typeof metadata?.connectionName === "string" ? metadata.connectionName : "SSH Session";
  const connection = useMemo(
    () => (connectionId === null ? null : { id: connectionId, name: connectionName }),
    [connectionId, connectionName],
  );

  // Internal state
  const [status, setStatus] = useState<"input" | "connecting" | "transferring" | "done" | "error">("input");
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [path, setPath] = useState(mode === "upload" ? "./" : "");
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);

  // Upload-specific
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<UploadSelection[]>([]);
  const selectedFilesRef = useRef<UploadSelection[]>([]);
  useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);
  const pendingUploadsRef = useRef<UploadSelection[]>([]);
  const activeUploadRef = useRef<UploadSelection | null>(null);
  const completedUploadsRef = useRef(0);

  // Download-specific
  const downloadChunksRef = useRef<Uint8Array[]>([]);
  const downloadNameRef = useRef("");
  const pendingDownloadsRef = useRef<string[]>([]);
  const activeDownloadRef = useRef("");
  const completedDownloadsRef = useRef(0);

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const uploadIdRef = useRef("");
  const downloadIdRef = useRef("");

  const isUpload = mode === "upload";
  const [connectKey, setConnectKey] = useState(0);

  const wsUrl = useMemo(() => {
    if (!connection) return null;
    return buildWsUrl("/ws/sftp", { connectionId: connection.id, r: connectKey });
  }, [connection, connectKey]);

  const startNextUpload = useCallback((ws: WebSocket) => {
    const nextFile = pendingUploadsRef.current.shift();
    if (!nextFile) {
      setStatus("done");
      return;
    }

    const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    uploadIdRef.current = uploadId;
    activeUploadRef.current = nextFile;
    setProgress({
      bytesDone: 0,
      total: nextFile.file.size,
      currentLabel: nextFile.displayPath,
      itemIndex: completedUploadsRef.current + 1,
      itemCount: selectedFilesRef.current.length,
    });
    ws.send(JSON.stringify({
      type: "upload_start",
      uploadId,
      fileName: nextFile.file.name,
      fileSize: nextFile.file.size,
      destPath: pathRef.current,
      relativePath: nextFile.relativePath,
      treatDestAsDirectory: nextFile.treatDestAsDirectory,
    }));
  }, []);

  const startNextDownload = useCallback((ws: WebSocket) => {
    const remotePath = pendingDownloadsRef.current.shift();
    if (!remotePath) {
      setStatus("done");
      return;
    }

    downloadChunksRef.current = [];
    downloadNameRef.current = "";
    activeDownloadRef.current = remotePath;
    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    downloadIdRef.current = downloadId;
    setProgress({
      bytesDone: 0,
      total: 0,
      currentLabel: remotePath,
      itemIndex: completedDownloadsRef.current + 1,
      itemCount: completedDownloadsRef.current + pendingDownloadsRef.current.length + 1,
    });
    ws.send(JSON.stringify({
      type: "download_request",
      downloadId,
      remotePath,
    }));
  }, []);

  const sendFileChunks = useCallback(async (ws: WebSocket, file: File, uploadId: string) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      if (ws.readyState !== WebSocket.OPEN) break;
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const buffer = await chunk.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let j = 0; j < bytes.length; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
      ws.send(JSON.stringify({
        type: "upload_chunk",
        uploadId,
        data: btoa(binary),
        offset: start,
      }));
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "upload_end", uploadId }));
    }
  }, []);

  // Connect WS once the user starts a transfer.
  useEffect(() => {
    if (!wsUrl || connectKey === 0) return;
    if (mode === "upload" && selectedFilesRef.current.length === 0) return;
    if (mode === "download" && parseRemotePaths(pathRef.current).length === 0) return;

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "connected") {
          if (mode === "upload") {
            pendingUploadsRef.current = [...selectedFilesRef.current];
            completedUploadsRef.current = 0;
            setStatus("transferring");
            startNextUpload(ws);
          } else if (mode === "download") {
            pendingDownloadsRef.current = parseRemotePaths(pathRef.current);
            completedDownloadsRef.current = 0;
            setStatus("transferring");
            startNextDownload(ws);
          }
        } else if (msg.type === "upload_ack") {
          if (activeUploadRef.current) {
            sendFileChunks(ws, activeUploadRef.current.file, msg.uploadId);
          }
        } else if (msg.type === "upload_progress") {
          const currentFile = activeUploadRef.current;
          const totalItems = selectedFilesRef.current.length;
          setProgress({
            bytesDone: msg.bytesWritten,
            total: msg.fileSize,
            currentLabel: currentFile?.displayPath || msg.path || "Upload",
            itemIndex: Math.min(completedUploadsRef.current + 1, totalItems || 1),
            itemCount: totalItems || 1,
          });
        } else if (msg.type === "upload_complete") {
          completedUploadsRef.current += 1;
          setProgress((p) => p ? { ...p, bytesDone: p.total } : null);
          if (pendingUploadsRef.current.length > 0) {
            startNextUpload(ws);
          } else {
            activeUploadRef.current = null;
            setStatus("done");
          }
        } else if (msg.type === "upload_error") {
          setErrorMessage(msg.message);
          setStatus("error");
        } else if (msg.type === "download_start") {
          downloadNameRef.current = msg.fileName;
          setProgress({
            bytesDone: 0,
            total: msg.fileSize,
            currentLabel: msg.fileName,
            itemIndex: Math.min(completedDownloadsRef.current + 1, completedDownloadsRef.current + pendingDownloadsRef.current.length + 1),
            itemCount: completedDownloadsRef.current + pendingDownloadsRef.current.length + 1,
          });
        } else if (msg.type === "download_chunk") {
          const binaryStr = atob(msg.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          downloadChunksRef.current.push(bytes);
          setProgress((current) => ({
            bytesDone: msg.offset + bytes.length,
            total: msg.total,
            currentLabel: current?.currentLabel || downloadNameRef.current || activeDownloadRef.current,
            itemIndex: current?.itemIndex || completedDownloadsRef.current + 1,
            itemCount: current?.itemCount || completedDownloadsRef.current + pendingDownloadsRef.current.length + 1,
          }));
        } else if (msg.type === "download_complete") {
          const allChunks = downloadChunksRef.current;
          const totalBytes = allChunks.reduce((sum, c) => sum + c.length, 0);
          const allBytes = new Uint8Array(totalBytes);
          let off = 0;
          for (const chunk of allChunks) {
            allBytes.set(chunk, off);
            off += chunk.length;
          }
          const blob = new Blob([allBytes]);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = downloadNameRef.current || "download";
          a.click();
          URL.revokeObjectURL(url);
          downloadChunksRef.current = [];
          completedDownloadsRef.current += 1;
          setProgress((p) => p ? { ...p, bytesDone: p.total } : null);
          if (pendingDownloadsRef.current.length > 0) {
            startNextDownload(ws);
          } else {
            activeDownloadRef.current = "";
            setStatus("done");
          }
        } else if (msg.type === "download_error") {
          setErrorMessage(msg.message);
          setStatus("error");
        } else if (msg.type === "error") {
          setErrorMessage(msg.message);
          setStatus("error");
        }
      } catch {}
    };

    ws.onclose = () => {
      if (statusRef.current !== "done" && statusRef.current !== "error") {
        setStatus("error");
        setErrorMessage("Connection lost");
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMessage("WebSocket connection failed");
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [connectKey, mode, sendFileChunks, startNextDownload, startNextUpload, wsUrl]);

  const applyUploadSelection = useCallback((nextFiles: UploadSelection[]) => {
    setSelectedFiles(nextFiles);
    setPath((currentPath) => currentPath.trim() || "./");
  }, []);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      applyUploadSelection(files.map((file) => ({
        file,
        displayPath: file.name,
        treatDestAsDirectory: files.length > 1,
      })));
    }
    e.target.value = "";
  }, [applyUploadSelection]);

  const handleFolderSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      applyUploadSelection(files.map((file) => ({
        file,
        displayPath: file.webkitRelativePath || file.name,
        relativePath: file.webkitRelativePath || file.name,
        treatDestAsDirectory: true,
      })));
    }
    e.target.value = "";
  }, [applyUploadSelection]);

  const handleStart = useCallback(() => {
    setErrorMessage("");
    setProgress(null);
    downloadChunksRef.current = [];
    uploadIdRef.current = "";
    downloadIdRef.current = "";
    pendingUploadsRef.current = [];
    activeUploadRef.current = null;
    completedUploadsRef.current = 0;
    pendingDownloadsRef.current = [];
    activeDownloadRef.current = "";
    completedDownloadsRef.current = 0;
    setConnectKey(k => k + 1);
    setStatus("input");
  }, []);

  const handleCancel = useCallback(() => {
    wsRef.current?.close();
    if (windowId) closeWindow(windowId);
  }, [closeWindow, windowId]);

  if (!connection) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-neutral-950 p-4">
        <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-[11px] text-red-400">Missing SSH connection</p>
        </div>
      </div>
    );
  }

  const progressPct = progress && progress.total > 0
    ? Math.round((progress.bytesDone / progress.total) * 100)
    : 0;

  const isInput = status === "input";
  const isTransferring = status === "connecting" || status === "transferring";
  const uploadSummary = selectedFiles.length > 0
    ? selectedFiles
      .slice(0, 3)
      .map((item) => item.displayPath)
      .join(", ")
    : "";
  const downloadTargets = parseRemotePaths(path);
  const folderPickerProps: DirectoryInputProps = {
    webkitdirectory: "",
    directory: "",
    multiple: true,
  };

  return (
    <div className="w-full h-full bg-neutral-950 p-4 overflow-auto">
      <div className="relative bg-neutral-900 border border-neutral-800 rounded-lg p-4 shadow-xl w-full min-h-full">
        <button
          onClick={handleCancel}
          className="absolute top-3 right-3 text-neutral-500 hover:text-white transition-colors cursor-pointer"
          title={isTransferring ? "Close and cancel transfer" : "Close"}
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className={`p-1.5 rounded-lg ${isUpload ? "bg-blue-500/20 text-blue-400" : "bg-green-500/20 text-green-400"}`}>
            {isUpload ? <Upload size={16} /> : <Download size={16} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">
              {isUpload ? "Upload Files" : "Download Files"}
            </h3>
            <p className="text-[10px] text-neutral-500 truncate">{connection.name}</p>
          </div>
        </div>

        {isInput && isUpload && (
          <div className="mb-3 space-y-2">
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              type="file"
              ref={folderInputRef}
              onChange={handleFolderSelect}
              className="hidden"
              {...folderPickerProps}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-300 hover:border-neutral-500 transition-colors cursor-pointer"
              >
                <FileText size={14} />
                Select files
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center justify-center gap-2 px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-300 hover:border-neutral-500 transition-colors cursor-pointer"
              >
                <FolderOpen size={14} />
                Select folder
              </button>
            </div>
            <div className="px-2.5 py-2 bg-neutral-800/70 border border-neutral-700 rounded-lg">
              {selectedFiles.length > 0 ? (
                <>
                  <p className="text-[11px] text-white">
                    {selectedFiles.length} item{selectedFiles.length > 1 ? "s" : ""} selected
                  </p>
                  <p className="text-[10px] text-neutral-500 break-words">
                    {uploadSummary}
                    {selectedFiles.length > 3 ? `, +${selectedFiles.length - 3} more` : ""}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-neutral-500">Choose many files or whole folder.</p>
              )}
            </div>
          </div>
        )}

        {isInput && (
          <div className="mb-4">
            <label className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1.5 block">
              {isUpload ? "Destination directory" : "Remote file paths"}
            </label>
            {isUpload ? (
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
                placeholder="./"
                className="w-full px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
              />
            ) : (
              <>
                <textarea
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleStart(); }}
                  placeholder={"/home/user/file-1.txt\n/home/user/file-2.log"}
                  rows={4}
                  className="w-full px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors resize-none"
                />
                <p className="mt-1 text-[10px] text-neutral-500">
                  One file path per line. Browser may ask permission for multiple downloads.
                </p>
              </>
            )}
          </div>
        )}

        {isTransferring && progress && (
          <div className="mb-4">
            <div className="flex justify-between gap-2 text-[10px] text-neutral-500 mb-1">
              <span className="truncate">
                {progress.itemCount > 1 ? `${progress.itemIndex}/${progress.itemCount}` : "1/1"} {progress.currentLabel}
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-neutral-500 mb-1">
              <span>{progressPct}%</span>
              <span>{formatSize(progress.bytesDone)} / {formatSize(progress.total)}</span>
            </div>
            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 bg-blue-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {status === "connecting" && !progress && (
          <div className="mb-4 text-center text-xs text-neutral-500">
            Connecting to server...
          </div>
        )}

        {status === "error" && errorMessage && (
          <div className="mb-4 px-2.5 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-[11px] text-red-400">{errorMessage}</p>
          </div>
        )}

        {status === "done" && (
          <div className="mb-4 px-2.5 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-[11px] text-green-400">
              {isUpload ? "Upload complete" : "Download complete"}
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            {status === "done" || status === "error" ? "Close" : "Cancel"}
          </button>
          {isInput && (
            <button
            onClick={handleStart}
              disabled={(isUpload && selectedFiles.length === 0) || (!isUpload && downloadTargets.length === 0) || (isUpload && !path.trim())}
              className={`px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed ${
                isUpload
                  ? "bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/30"
                  : "bg-green-600 hover:bg-green-500 disabled:bg-green-600/30"
              }`}
            >
              {isUpload ? "Upload" : "Download"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function parseRemotePaths(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
