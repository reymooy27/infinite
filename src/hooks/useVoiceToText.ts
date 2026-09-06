import { useCallback, useRef, useState } from "react";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export type VoiceStatus = "idle" | "recording" | "processing" | "editable" | "error";

export interface VoiceResult {
  transcript: string;
  isFinal: boolean;
}

export interface UseVoiceToTextOptions {
  lang?: string;
  interimResults?: boolean;
  onResult?: (result: VoiceResult) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: VoiceStatus) => void;
}

export function useVoiceToText(options: UseVoiceToTextOptions = {}) {
  const {
    lang = "id-ID",
    interimResults = true,
    onResult,
    onError,
    onStatusChange,
  } = options;

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<Error | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isListeningRef = useRef(false);
  const statusRef = useRef<VoiceStatus>("idle");
  const manualStopRef = useRef(false);
  const accumulatedRef = useRef("");

  const updateStatus = useCallback((newStatus: VoiceStatus) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onstart = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current = null;
    }
    isListeningRef.current = false;
  }, []);

  const start = useCallback(() => {
    if (isListeningRef.current) return;

    manualStopRef.current = false;
    // Only clear accumulated transcript on manual start, not on auto-restart after pause
    if (statusRef.current !== "recording") {
      accumulatedRef.current = "";
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      const err = new Error("Speech Recognition tidak didukung di browser ini");
      setError(err);
      onError?.(err);
      updateStatus("error");
      return;
    }

    cleanup();

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListeningRef.current = true;
      updateStatus("recording");
      setError(null);
    };

    recognition.onresult = (event) => {
      let newFinalText = "";

      // Process only new results starting from resultIndex to avoid double-counting.
      // In continuous mode, event.results accumulates all results from the start,
      // and some browsers emit cumulative final results that include previous text.
      const startIndex = event.resultIndex ?? 0;
      for (let i = startIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          newFinalText += result[0].transcript + " ";
        }
      }

      newFinalText = newFinalText.trim();

      if (newFinalText) {
        // Detect cumulative final results from browser (common in Chrome/Edge).
        // If newFinalText already starts with accumulatedRef, extract only the new portion.
        const prev = accumulatedRef.current;
        let toAppend = newFinalText;
        if (prev && newFinalText.startsWith(prev)) {
          toAppend = newFinalText.slice(prev.length).trimStart();
        }

        accumulatedRef.current = prev
          ? (prev + (toAppend ? " " + toAppend : ""))
          : newFinalText;

        setFinalTranscript(accumulatedRef.current);
        setInterimTranscript("");
        onResult?.({ transcript: toAppend || newFinalText, isFinal: true });
      }

      for (let i = event.results.length - 1; i >= 0; i--) {
        if (!event.results[i].isFinal) {
          const lastInterim = event.results[i][0].transcript;
          // Only show interim if it's not already part of the accumulated final text
          if (lastInterim && !accumulatedRef.current.includes(lastInterim)) {
            setInterimTranscript(lastInterim);
            onResult?.({ transcript: lastInterim, isFinal: false });
          }
          break;
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" && !manualStopRef.current) {
        setInterimTranscript("");
        return;
      }
      const err = new Error(`Speech error: ${event.error}`);
      setError(err);
      onError?.(err);
      cleanup();
      updateStatus("error");
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      if (statusRef.current === "recording" && !manualStopRef.current) {
        // Auto-restart on silence timeout (browser stops after ~30-60s silence).
        // Use setTimeout + ref to call the start callback (creates fresh recognition).
        setTimeout(() => {
          if (statusRef.current === "recording" && !manualStopRef.current) {
            start();
          }
        }, 100);
      } else if (statusRef.current === "recording" || manualStopRef.current) {
        updateStatus("processing");
        setTimeout(() => {
          if (statusRef.current === "processing") {
            updateStatus("editable");
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      const error = new Error(`Gagal memulai speech recognition: ${err}`);
      setError(error);
      onError?.(error);
      updateStatus("error");
    }
  }, [lang, interimResults, onResult, onError, updateStatus, cleanup]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    if (recognitionRef.current && isListeningRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
      }
    }
    cleanup();
  }, [cleanup]);

  const stopAndEdit = useCallback(() => {
    manualStopRef.current = true;
    if (recognitionRef.current && isListeningRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
      }
    }
    cleanup();
    updateStatus("editable");
  }, [cleanup, updateStatus]);

  const reset = useCallback(() => {
    manualStopRef.current = true;
    cleanup();
    setFinalTranscript("");
    setInterimTranscript("");
    setError(null);
    accumulatedRef.current = "";
    updateStatus("idle");
  }, [cleanup, updateStatus]);

  return {
    status,
    transcript: finalTranscript + interimTranscript,
    finalTranscript,
    interimTranscript,
    error,
    isListening: isListeningRef.current,
    start,
    stop,
    stopAndEdit,
    reset,
  };
}