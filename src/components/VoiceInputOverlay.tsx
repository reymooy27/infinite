import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, X, RotateCcw, Loader2, Sparkles } from "lucide-react";
import { useVoiceToText, type VoiceStatus } from "@/hooks/useVoiceToText";

interface VoiceInputOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  isMobile?: boolean;
  onTranslate?: (text: string) => Promise<string>;
}

const statusConfig: Record<VoiceStatus, { label: string; color: string; icon: React.ReactNode }> = {
  idle: { label: "Siap", color: "text-neutral-500", icon: <Mic className="w-5 h-5" /> },
  recording: { label: "Merekam...", color: "text-red-400 animate-pulse", icon: <Mic className="w-5 h-5 text-red-400 animate-pulse" /> },
  processing: { label: "Memproses...", color: "text-yellow-400", icon: <Loader2 className="w-5 h-5 animate-spin text-yellow-400" /> },
  editable: { label: "Siap Dikirim", color: "text-green-400", icon: <Sparkles className="w-5 h-5 text-green-400" /> },
  error: { label: "Error", color: "text-red-400", icon: <MicOff className="w-5 h-5 text-red-400" /> },
};

export default function VoiceInputOverlay({
  isOpen,
  onClose,
  onSend,
  isMobile = false,
  onTranslate,
}: VoiceInputOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editedText, setEditedText] = useState("");
  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const {
    status,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    stopAndEdit,
    reset,
  } = useVoiceToText({
    lang: "id-ID",
    interimResults: true,
  });

  useEffect(() => {
    if (isOpen) {
      setEditedText("");
      setShowTranslation(false);
      setTranslatedText("");
      reset();
      start();
    } else {
      stop();
    }
    return () => stop();
  }, [isOpen]);

  useEffect(() => {
    if ((status === "editable" || status === "processing")) {
      setEditedText(finalTranscript.trim());
    }
  }, [status, finalTranscript]);

  const handleTranslate = async () => {
    if (!editedText.trim() || !onTranslate) return;
    setIsTranslating(true);
    setShowTranslation(true);
    try {
      const result = await onTranslate(editedText);
      setTranslatedText(result.translated || result);
    } catch {
      setTranslatedText("Gagal menerjemahkan");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSend = () => {
    const textToSend = showTranslation && translatedText ? translatedText : editedText;
    if (textToSend.trim()) {
      onSend(textToSend.trim());
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  const handleRecordAgain = () => {
    setEditedText("");
    setShowTranslation(false);
    setTranslatedText("");
    reset();
    start();
  };

  // Handle mobile keyboard - adjust modal position when keyboard opens/closes
  useEffect(() => {
    if (!isMobile || !isOpen) return;

    const vp = window.visualViewport;
    if (!vp) return;

    const handleResize = () => {
      const height = window.innerHeight - vp.height;
      setKeyboardHeight(height > 0 ? height : 0);
    };

    vp.addEventListener("resize", handleResize);
    handleResize(); // initial

    return () => {
      vp.removeEventListener("resize", handleResize);
      setKeyboardHeight(0);
    };
  }, [isMobile, isOpen]);

  if (!isOpen) return null;

  const config = statusConfig[status];
  const isEditableState = status === "editable";
  const isRecordingState = status === "recording";

  return (
    <div
      className={`fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm ${
        isMobile ? "bottom-0 items-end rounded-t-2xl" : ""
      }`}
      style={isMobile ? { paddingBottom: keyboardHeight } : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Voice Input"
    >
      <div
        className={`w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden ${
          isMobile ? "rounded-b-none max-h-[80vh]" : "max-h-[70vh]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center">
              {config.icon}
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-100">Voice Input</p>
              <p className={`text-xs ${config.color}`}>{config.label}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors flex items-center justify-center"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-auto flex flex-col gap-3">
          {status === "recording" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-red-600/20 flex items-center justify-center animate-pulse">
                  <div className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center">
                    <Mic className="w-7 h-7 text-white" />
                  </div>
                </div>
                <div className="absolute -inset-2 rounded-full border-2 border-red-500/30 animate-ping" />
              </div>
              <div className="text-center">
                <p className="text-neutral-200 text-sm font-medium">Mendengarkan...</p>
                <p className="text-neutral-500 text-xs mt-1">Bicara sekarang</p>
              </div>
              <div className="w-full min-h-[80px] rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-3">
                {finalTranscript || interimTranscript ? (
                  <div className="flex flex-wrap gap-1">
                    {finalTranscript && (
                      <span className="text-neutral-100 text-sm">{finalTranscript}</span>
                    )}
                    {interimTranscript && (
                      <span className="text-neutral-400 text-sm italic">{interimTranscript}</span>
                    )}
                  </div>
                ) : (
                  <p className="text-neutral-500 text-sm italic">Menunggu suara...</p>
                )}
              </div>
              <button
                onClick={stopAndEdit}
                className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white transition-colors shadow-lg shadow-red-600/30 active:scale-95"
                aria-label="Hentikan rekaman"
              >
                <MicOff className="w-7 h-7" />
              </button>
              <p className="text-neutral-600 text-xs">Klik untuk berhenti merekam</p>
            </div>
          )}

          {status === "processing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
              <p className="text-neutral-400">Memproses suara...</p>
            </div>
          )}

          {isEditableState && (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <div className="flex items-center gap-2 px-2">
                <span className="text-xs text-neutral-500">Hasil:</span>
                {showTranslation ? (
                  <>
                    <span className="text-xs text-blue-400">Terjemahan</span>
                    <button
                      onClick={() => setShowTranslation(false)}
                      className="text-xs text-neutral-500 hover:text-neutral-300"
                    >
                      Lihat asli
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-neutral-500">Asli</span>
                    <button
                      onClick={handleTranslate}
                      disabled={isTranslating || !editedText.trim() || !onTranslate}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      {isTranslating ? "Menerjemahkan..." : "Terjemahkan ke Command"}
                    </button>
                  </>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={showTranslation && translatedText ? translatedText : editedText}
                onChange={(e) => setEditedText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Hasil voice akan muncul di sini..."
                className="flex-1 min-h-[120px] max-h-[60vh] bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-neutral-100 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                spellCheck={false}
                aria-label="Edit voice transcript"
              />

              <div className="flex items-center gap-2 pt-2 border-t border-neutral-700">
                <button
                  onClick={handleRecordAgain}
                  disabled={isRecordingState}
                  className="flex-1 py-2 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Ulangi
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-2 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Batal
                </button>
                <button
                  onClick={handleSend}
                  disabled={!editedText.trim() && !(showTranslation && translatedText.trim())}
                  className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Kirim
                </button>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center px-4">
              <MicOff className="w-12 h-12 text-red-400" />
              <p className="text-red-400 font-medium">{error?.message || "Terjadi kesalahan"}</p>
              <p className="text-neutral-500 text-sm">Coba lagi atau periksa izin mikrofon</p>
              <div className="flex gap-2">
                <button
                  onClick={handleRecordAgain}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                >
                  Coba Lagi
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm rounded-lg transition-colors"
                >
                  Tutup
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}