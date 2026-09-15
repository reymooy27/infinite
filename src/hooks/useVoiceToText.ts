import { useCallback, useRef, useState } from "react";
import { mergeFinalTranscript, normalizeTranscript } from "./transcriptMerge";

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
  const transientRef = useRef({ count: 0, at: 0 });

  const updateStatus = useCallback((newStatus: VoiceStatus) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
      }
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
      let incoming = "";

      // Process only new results starting from resultIndex to avoid processing
      // results we already saw in earlier events.
      const startIndex = event.resultIndex ?? 0;
      for (let i = startIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          incoming += result[0].transcript + " ";
        }
      }

      incoming = incoming.trim();

      if (incoming) {
        // Chrome/Edge re-emit the whole utterance as one final result with
        // different capitalization/punctuation; raw-string prefix checks
        // missed that and duplicated the sentence. Normalized merge fixes it.
        const { accumulated, appended } = mergeFinalTranscript(accumulatedRef.current, incoming);
        accumulatedRef.current = accumulated;

        setFinalTranscript(accumulated);
        setInterimTranscript("");
        if (appended) onResult?.({ transcript: appended, isFinal: true });
      }

      for (let i = event.results.length - 1; i >= 0; i--) {
        if (!event.results[i].isFinal) {
          const lastInterim = event.results[i][0].transcript;
          // Only show interim if it's not already part of the accumulated final text
          if (lastInterim && !normalizeTranscript(accumulatedRef.current).includes(normalizeTranscript(lastInterim))) {
            setInterimTranscript(lastInterim);
            onResult?.({ transcript: lastInterim, isFinal: false });
          }
          break;
        }
      }
    };

    recognition.onerror = (event) => {
      // no-speech/aborted also fire while a manual stop flushes trailing
      // silence; routing them to the error screen wiped the captured transcript.
      if (event.error === "no-speech" || event.error === "aborted") {
        setInterimTranscript("");
        return;
      }
      // Chrome kills continuous STT sessions every ~60s (shorter on mobile)
      // and reports mid-speech drops as a "network" error right before onend.
      // Swallow transient ones so the onend auto-restart reopens the session
      // transparently; give up only on 3 quick failures in a row (real offline).
      if (event.error === "network" && !manualStopRef.current && statusRef.current === "recording") {
        const now = Date.now();
        const quick = now - transientRef.current.at < 8000;
        transientRef.current = { count: quick ? transientRef.current.count + 1 : 1, at: now };
        if (transientRef.current.count <= 2) return;
      }
      // A manual stop already did its job; a late error must not replace the
      // finished transcript with the error screen.
      if (manualStopRef.current) {
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
        return;
      }
      // onend is the spec-guaranteed last event — final results have flushed,
      // so detaching here (instead of at stop()) never drops the utterance.
      cleanup();
      if (statusRef.current === "recording") {
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
      // Auto-restart can race the previous session's teardown (InvalidStateError);
      // retry after the old session has fully released the mic.
      setTimeout(() => {
        if (manualStopRef.current || isListeningRef.current || recognitionRef.current !== recognition) return;
        try {
          recognition.start();
        } catch (retryErr) {
          const error = new Error(`Gagal memulai speech recognition: ${retryErr}`);
          setError(error);
          onError?.(error);
          updateStatus("error");
        }
      }, 300);
    }
  }, [lang, interimResults, onResult, onError, updateStatus, cleanup]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    // Keep handlers attached: the browser flushes the last final result
    // before onend, and onend runs the cleanup. Detaching at stop() dropped
    // the just-spoken utterance when the user stopped right after speaking.
    if (!recognitionRef.current || !isListeningRef.current) cleanup();
    else {
      try {
        recognitionRef.current.stop();
      } catch {
      }
    }
  }, [cleanup]);

  const stopAndEdit = useCallback(() => {
    manualStopRef.current = true;
    updateStatus("editable");
    if (!recognitionRef.current || !isListeningRef.current) cleanup();
    else {
      try {
        recognitionRef.current.stop();
      } catch {
      }
    }
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