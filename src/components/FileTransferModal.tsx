import {
  ChevronLeft,
  Download,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
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

function parseRemotePaths(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const CHUNK_SIZE = 64 * 1024;

type TransferMode = "upload" | "download";

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
  isIndeterminate?: boolean;
};

type RemoteBrowserEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
};

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

export default function FileTransferWindow({ windowId }: { windowId?: string }) {
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const metadata = useWindowStore((s) => s.windows.find((w) => w.id === windowId)?.metadata);

  const initialMode: TransferMode = metadata?.mode === "download" ? "download" : "upload";
  const connectionId = typeof metadata?.connectionId === "number" ? metadata.connectionId : null;
  const connectionName = typeof metadata?.connectionName === "string" ? metadata.connectionName : "SSH Session";
  const connection = useMemo(
    () => (connectionId === null ? null : { id: connectionId, name: connectionName }),
    [connectionId, connectionName],
  );

  const [viewMode, setViewMode] = useState<TransferMode>(initialMode);
  const isUpload = viewMode === "upload";

  const [status, setStatus] = useState<"input" | "connecting" | "transferring" | "done" | "error">("input");
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [uploadPath, setUploadPath] = useState("./");
  const uploadPathRef = useRef(uploadPath);
  useEffect(() => { uploadPathRef.current = uploadPath; }, [uploadPath]);

  const [downloadPath, setDownloadPath] = useState("");
  const downloadPathRef = useRef(downloadPath);
  useEffect(() => { downloadPathRef.current = downloadPath; }, [downloadPath]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<UploadSelection[]>([]);
  const selectedFilesRef = useRef<UploadSelection[]>([]);
  useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);
  const pendingUploadsRef = useRef<UploadSelection[]>([]);
  const activeUploadRef = useRef<UploadSelection | null>(null);
  const completedUploadsRef = useRef(0);

  const downloadChunksRef = useRef<Uint8Array[]>([]);
  const downloadNameRef = useRef("");
  const pendingDownloadsRef = useRef<string[]>([]);
  const activeDownloadRef = useRef("");
  const completedDownloadsRef = useRef(0);

  const [browserPathInput, setBrowserPathInput] = useState(".");
  const browserRequestedPathRef = useRef(".");
  const [browserCurrentPath, setBrowserCurrentPath] = useState(".");
  const [browserParentPath, setBrowserParentPath] = useState<string | null>(null);
  const [browserEntries, setBrowserEntries] = useState<RemoteBrowserEntry[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState("");
  const [browserSessionKey, setBrowserSessionKey] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const browserWsRef = useRef<WebSocket | null>(null);
  const uploadIdRef = useRef("");
  const downloadIdRef = useRef("");
  const [connectKey, setConnectKey] = useState(0);

  const wsUrl = useMemo(() => {
    if (!connection) return null;
    return buildWsUrl("/ws/sftp", { connectionId: connection.id, r: connectKey });
  }, [connection, connectKey]);

  const browserWsUrl = useMemo(() => {
    if (!connection || isUpload) return null;
    return buildWsUrl("/ws/sftp", { connectionId: connection.id, b: browserSessionKey });
  }, [browserSessionKey, connection, isUpload]);

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
      destPath: uploadPathRef.current,
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

  const sendBrowserListRequest = useCallback((ws: WebSocket, targetPath: string) => {
    ws.send(JSON.stringify({
      type: "list_request",
      requestPath: targetPath.trim() || ".",
    }));
  }, []);

  const requestBrowserDirectory = useCallback((targetPath: string, wsOverride?: WebSocket) => {
    const nextPath = targetPath.trim() || ".";
    browserRequestedPathRef.current = nextPath;
    setBrowserLoading(true);
    setBrowserError("");

    const ws = wsOverride ?? browserWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendBrowserListRequest(ws, nextPath);
      return;
    }

    setBrowserSessionKey((key) => key + 1);
  }, [sendBrowserListRequest]);

  const appendDownloadTarget = useCallback((targetPath: string) => {
    setDownloadPath((current) => {
      const existing = parseRemotePaths(current);
      if (existing.includes(targetPath)) return current;
      return existing.length > 0 ? `${existing.join("\n")}\n${targetPath}` : targetPath;
    });
  }, []);

  const removeDownloadTarget = useCallback((targetPath: string) => {
    setDownloadPath((current) => (
      parseRemotePaths(current)
        .filter((entry) => entry !== targetPath)
        .join("\n")
    ));
  }, []);

  const clearDownloadTargets = useCallback(() => {
    setDownloadPath("");
  }, []);

  useEffect(() => {
    if (!wsUrl || connectKey === 0) return;
    if (isUpload && selectedFilesRef.current.length === 0) return;
    if (!isUpload && parseRemotePaths(downloadPathRef.current).length === 0) return;

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "connected") {
          if (isUpload) {
            pendingUploadsRef.current = [...selectedFilesRef.current];
            completedUploadsRef.current = 0;
            setStatus("transferring");
            startNextUpload(ws);
          } else {
            pendingDownloadsRef.current = parseRemotePaths(downloadPathRef.current);
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
            currentLabel: currentFile?.displayPath || "Upload",
            itemIndex: Math.min(completedUploadsRef.current + 1, totalItems || 1),
            itemCount: totalItems || 1,
          });
        } else if (msg.type === "upload_complete") {
          completedUploadsRef.current += 1;
          setProgress((current) => current ? { ...current, bytesDone: current.total } : null);
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
            isIndeterminate: Boolean(msg.isArchive) || msg.fileSize === 0,
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
            isIndeterminate: current?.isIndeterminate || msg.total === 0,
          }));
        } else if (msg.type === "download_complete") {
          const allChunks = downloadChunksRef.current;
          const totalBytes = allChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const allBytes = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of allChunks) {
            allBytes.set(chunk, offset);
            offset += chunk.length;
          }
          const blob = new Blob([allBytes]);
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = downloadNameRef.current || "download";
          anchor.click();
          URL.revokeObjectURL(url);
          downloadChunksRef.current = [];
          completedDownloadsRef.current += 1;
          setProgress((current) => current ? { ...current, bytesDone: Math.max(current.bytesDone, current.total) } : null);
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
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMessage("WebSocket connection failed");
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [connectKey, isUpload, sendFileChunks, startNextDownload, startNextUpload, wsUrl]);

  useEffect(() => {
    if (!browserWsUrl) return;

    const ws = new WebSocket(browserWsUrl);
    browserWsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "connected") {
          requestBrowserDirectory(browserRequestedPathRef.current, ws);
        } else if (msg.type === "list_response") {
          setBrowserCurrentPath(msg.currentPath || browserRequestedPathRef.current);
          setBrowserPathInput(msg.currentPath || browserRequestedPathRef.current);
          setBrowserParentPath(msg.parentPath || null);
          setBrowserEntries(Array.isArray(msg.entries) ? msg.entries : []);
          setBrowserLoading(false);
          setBrowserError("");
        } else if (msg.type === "list_error") {
          setBrowserLoading(false);
          setBrowserError(msg.message || "Failed to list directory");
        } else if (msg.type === "error") {
          setBrowserLoading(false);
          setBrowserError(msg.message || "Connection failed");
        }
      } catch {}
    };

    ws.onclose = () => {
      if (browserWsRef.current === ws) {
        browserWsRef.current = null;
      }
      setBrowserLoading(false);
    };

    ws.onerror = () => {
      setBrowserLoading(false);
      setBrowserError("Browser connection failed");
    };

    return () => {
      ws.close();
      if (browserWsRef.current === ws) {
        browserWsRef.current = null;
      }
    };
  }, [browserWsUrl, requestBrowserDirectory]);

  const applyUploadSelection = useCallback((nextFiles: UploadSelection[]) => {
    setSelectedFiles(nextFiles);
    setUploadPath((currentPath) => currentPath.trim() || "./");
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
    setConnectKey((key) => key + 1);
    setStatus("input");
  }, []);

  const handleCancel = useCallback(() => {
    wsRef.current?.close();
    browserWsRef.current?.close();
    if (windowId) closeWindow(windowId);
  }, [closeWindow, windowId]);

  const handleModeSwitch = useCallback((nextMode: TransferMode) => {
    if (status === "connecting" || status === "transferring" || nextMode === viewMode) return;
    setErrorMessage("");
    setProgress(null);
    setStatus("input");
    setViewMode(nextMode);
  }, [status, viewMode]);

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
    ? selectedFiles.slice(0, 3).map((item) => item.displayPath).join(", ")
    : "";
  const downloadTargets = parseRemotePaths(downloadPath);
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
            <h3 className="text-sm font-semibold text-white">File Transfer</h3>
            <p className="text-[10px] text-neutral-500 truncate">{connection.name}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => handleModeSwitch("upload")}
            disabled={isTransferring}
            className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:cursor-not-allowed ${
              isUpload
                ? "border-blue-500 bg-blue-500/15 text-blue-300"
                : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
          >
            Upload
          </button>
          <button
            onClick={() => handleModeSwitch("download")}
            disabled={isTransferring}
            className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:cursor-not-allowed ${
              !isUpload
                ? "border-green-500 bg-green-500/15 text-green-300"
                : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
          >
            Download
          </button>
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

        {isInput && isUpload && (
          <div className="mb-4">
            <label className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1.5 block">
              Destination directory
            </label>
            <input
              type="text"
              value={uploadPath}
              onChange={(e) => setUploadPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
              placeholder="./"
              className="w-full px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
            />
          </div>
        )}

        {isInput && !isUpload && (
          <>
            <div className="mb-4 border border-neutral-800 rounded-lg overflow-hidden bg-neutral-925">
              <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium text-white">Remote files</p>
                    <p className="text-[10px] text-neutral-500">Open folders. Add files or folder archives to queue.</p>
                  </div>
                </div>
              </div>

              <div className="p-3 space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => browserParentPath && requestBrowserDirectory(browserParentPath)}
                    disabled={!browserParentPath || browserLoading}
                    className="px-2 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300 disabled:text-neutral-600 disabled:border-neutral-800 cursor-pointer disabled:cursor-not-allowed"
                    title="Go up"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <input
                    type="text"
                    value={browserPathInput}
                    onChange={(e) => setBrowserPathInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") requestBrowserDirectory(browserPathInput); }}
                    className="flex-1 px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
                    placeholder="."
                  />
                  <button
                    onClick={() => requestBrowserDirectory(browserPathInput)}
                    disabled={browserLoading}
                    className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-300 hover:border-neutral-500 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    Go
                  </button>
                  <button
                    onClick={() => requestBrowserDirectory(browserCurrentPath)}
                    disabled={browserLoading}
                    className="px-2 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300 hover:border-neutral-500 transition-colors cursor-pointer disabled:cursor-not-allowed"
                    title="Refresh"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>

                <div className="px-2.5 py-2 bg-neutral-800/70 border border-neutral-700 rounded-lg text-[10px] text-neutral-400 break-all">
                  {browserCurrentPath}
                </div>

                <div className="h-56 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950">
                  {browserLoading ? (
                    <div className="h-full flex items-center justify-center text-xs text-neutral-500">
                      Loading files...
                    </div>
                  ) : browserError ? (
                    <div className="h-full flex items-center justify-center px-4 text-center text-xs text-red-400">
                      {browserError}
                    </div>
                  ) : browserEntries.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-neutral-500">
                      Empty directory
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-800">
                      {browserEntries.map((entry) => (
                        <div key={entry.path} className="flex items-center gap-2 px-2 py-2">
                          <button
                            onClick={() => entry.isDirectory ? requestBrowserDirectory(entry.path) : appendDownloadTarget(entry.path)}
                            className="min-w-0 flex-1 flex items-center gap-2 text-left text-xs text-neutral-300 hover:text-white transition-colors cursor-pointer"
                          >
                            {entry.isDirectory ? <Folder size={14} className="text-amber-300 shrink-0" /> : <FileText size={14} className="text-neutral-500 shrink-0" />}
                            <span className="truncate">{entry.name}</span>
                          </button>
                          <span className="shrink-0 text-[10px] text-neutral-500">
                            {entry.isDirectory ? "Folder" : formatSize(entry.size)}
                          </span>
                          <button
                            onClick={() => appendDownloadTarget(entry.path)}
                            className="shrink-0 p-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-300 hover:border-neutral-500 transition-colors cursor-pointer"
                            title={entry.isDirectory ? "Add folder archive" : "Add file"}
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-4 border border-neutral-800 rounded-lg overflow-hidden bg-neutral-925">
              <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-white">Download queue</p>
                  <p className="text-[10px] text-neutral-500">
                    {downloadTargets.length > 0
                      ? `${downloadTargets.length} item${downloadTargets.length > 1 ? "s" : ""} selected`
                      : "Select items from browser above"}
                  </p>
                </div>
                {downloadTargets.length > 0 && (
                  <button
                    onClick={clearDownloadTargets}
                    className="px-2 py-1 text-[10px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="max-h-32 overflow-auto bg-neutral-950">
                {downloadTargets.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-neutral-500">
                    No items queued yet.
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-800">
                    {downloadTargets.map((targetPath) => (
                      <div key={targetPath} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{targetPath}</span>
                        <button
                          onClick={() => removeDownloadTarget(targetPath)}
                          className="shrink-0 p-1 rounded-md text-neutral-500 hover:text-white transition-colors cursor-pointer"
                          title="Remove from queue"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {isTransferring && progress && (
          <div className="mb-4">
            <div className="flex justify-between gap-2 text-[10px] text-neutral-500 mb-1">
              <span className="truncate">
                {progress.itemCount > 1 ? `${progress.itemIndex}/${progress.itemCount}` : "1/1"} {progress.currentLabel}
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-neutral-500 mb-1">
              <span>{progress.isIndeterminate ? "Streaming..." : `${progressPct}%`}</span>
              <span>
                {progress.isIndeterminate
                  ? formatSize(progress.bytesDone)
                  : `${formatSize(progress.bytesDone)} / ${formatSize(progress.total)}`}
              </span>
            </div>
            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 bg-blue-500"
                style={{ width: progress.isIndeterminate ? "100%" : `${progressPct}%`, opacity: progress.isIndeterminate ? 0.7 : 1 }}
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
              disabled={(isUpload && selectedFiles.length === 0) || (isUpload && !uploadPath.trim()) || (!isUpload && downloadTargets.length === 0)}
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
