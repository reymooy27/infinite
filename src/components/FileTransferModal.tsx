import { Upload, Download, X, FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export default function FileTransferWindow({ windowId }: { windowId?: string }) {
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const metadata = useWindowStore((s) => s.windows.find((w) => w.id === windowId)?.metadata);

  const mode = metadata?.mode === "download" ? "download" : "upload";
  const connectionId = typeof metadata?.connectionId === "number" ? metadata.connectionId : null;
  const connectionName = typeof metadata?.connectionName === "string" ? metadata.connectionName : "SSH Session";
  const connection = connectionId === null ? null : { id: connectionId, name: connectionName };

  // Internal state
  const [status, setStatus] = useState<"input" | "connecting" | "transferring" | "done" | "error">("input");
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const [progress, setProgress] = useState<{ bytesDone: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [path, setPath] = useState("");

  // Upload-specific
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Download-specific
  const downloadChunksRef = useRef<Uint8Array[]>([]);
  const downloadNameRef = useRef("");

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

  // Reset state when the transfer window opens.
  useEffect(() => {
    setStatus("input");
    setProgress(null);
    setErrorMessage("");
    setPath(isUpload ? "./" : "");
    setSelectedFile(null);
    downloadChunksRef.current = [];
    uploadIdRef.current = "";
    downloadIdRef.current = "";
  }, [windowId, isUpload]);

  // Connect WS once the user starts a transfer.
  useEffect(() => {
    if (!wsUrl || status !== "input") return;
    if (mode === "upload" && !selectedFile) return;
    if (mode === "download" && !path.trim()) return;

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "connected") {
          // SFTP session ready — start the transfer now
          if (mode === "upload" && selectedFile) {
            const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            uploadIdRef.current = uploadId;
            ws.send(JSON.stringify({
              type: "upload_start",
              uploadId,
              fileName: selectedFile.name,
              fileSize: selectedFile.size,
              destPath: path,
            }));
            setStatus("transferring");
            setProgress({ bytesDone: 0, total: selectedFile.size });
            sendFileChunks(ws, selectedFile, uploadId);
          } else if (mode === "download") {
            const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            downloadIdRef.current = downloadId;
            ws.send(JSON.stringify({
              type: "download_request",
              downloadId,
              remotePath: path,
            }));
            setStatus("transferring");
          }
        } else if (msg.type === "upload_progress") {
          setProgress({ bytesDone: msg.bytesWritten, total: msg.fileSize });
        } else if (msg.type === "upload_complete") {
          setProgress((p) => p ? { ...p, bytesDone: p.total } : null);
          setStatus("done");
        } else if (msg.type === "upload_error") {
          setErrorMessage(msg.message);
          setStatus("error");
        } else if (msg.type === "download_start") {
          downloadNameRef.current = msg.fileName;
          setProgress({ bytesDone: 0, total: msg.fileSize });
        } else if (msg.type === "download_chunk") {
          const binaryStr = atob(msg.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          downloadChunksRef.current.push(bytes);
          setProgress({ bytesDone: msg.offset + bytes.length, total: msg.total });
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
          setProgress((p) => p ? { ...p, bytesDone: p.total } : null);
          setStatus("done");
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
  }, [wsUrl]); // Only connect on input -> connecting transition

  async function sendFileChunks(ws: WebSocket, file: File, uploadId: string) {
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
  }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPath(`./${file.name}`);
    }
    e.target.value = "";
  }, []);

  const handleStart = useCallback(() => {
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
              {isUpload ? "Upload File" : "Download File"}
            </h3>
            <p className="text-[10px] text-neutral-500 truncate">{connection.name}</p>
          </div>
        </div>

        {isInput && isUpload && (
          <div className="mb-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-2 px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-400 hover:border-neutral-500 transition-colors cursor-pointer"
            >
              <FileText size={14} />
              {selectedFile ? (
                <span className="text-white truncate">{selectedFile.name} ({formatSize(selectedFile.size)})</span>
              ) : (
                <span>Select file...</span>
              )}
            </button>
          </div>
        )}

        {isInput && (
          <div className="mb-4">
            <label className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1.5 block">
              {isUpload ? "Destination path" : "Remote file path"}
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
              placeholder={isUpload ? "~/downloads/" : "/home/user/file.txt"}
              className="w-full px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
            />
          </div>
        )}

        {isTransferring && progress && (
          <div className="mb-4">
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
              disabled={(isUpload && !selectedFile) || !path.trim()}
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
