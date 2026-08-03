import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface CodeEditorProps {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  height?: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  sh: "shell",
  bash: "shell",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  sql: "sql",
  dockerfile: "dockerfile",
  prisma: "plaintext",
  env: "ini",
  conf: "ini",
  ini: "ini",
  txt: "plaintext",
  log: "plaintext",
};

function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_MAP[ext] ?? "plaintext";
}

const THEME_RULES = [
  { token: "comment", foreground: "6a737d", fontStyle: "italic" },
  { token: "keyword", foreground: "ff7b72" },
  { token: "string", foreground: "a5d6ff" },
  { token: "number", foreground: "79c0ff" },
  { token: "type", foreground: "ffa657" },
  { token: "variable", foreground: "e6edf3" },
  { token: "function", foreground: "d2a8ff" },
  { token: "operator", foreground: "ff7b72" },
  { token: "delimiter", foreground: "8b949e" },
];

const THEME_COLORS = {
  "editor.background": "#0a0a0a",
  "editor.foreground": "#e0e0e0",
  "editor.lineHighlightBackground": "#151515",
  "editor.selectionBackground": "#264f78",
  "editor.inactiveSelectionBackground": "#1a3a5c",
  "editorCursor.foreground": "#e0e0e0",
  "editorLineNumber.foreground": "#444444",
  "editorLineNumber.activeForeground": "#888888",
  "editorIndentGuide.background": "#1a1a1a",
  "editorIndentGuide.activeBackground": "#333333",
  "editorWidget.background": "#111111",
  "editorWidget.border": "#333333",
  "editorSuggestWidget.background": "#111111",
  "editorSuggestWidget.border": "#333333",
  "editorSuggestWidget.selectedBackground": "#1a1a1a",
  "minimap.background": "#0a0a0a",
  "scrollbarSlider.background": "#33333380",
  "scrollbarSlider.hoverBackground": "#444444aa",
};

export default function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  readOnly = false,
  height = "100%",
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);
  const language = useMemo(() => getLanguage(path), [path]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      setMounted(true);
      monaco.editor.defineTheme("infinite-dark", {
        base: "vs-dark",
        inherit: true,
        rules: THEME_RULES,
        colors: THEME_COLORS,
      });
      monaco.editor.setTheme("infinite-dark");

      // Ctrl+S / Cmd+S save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave?.();
      });

      // Trigger suggest on typing
      editor.updateOptions({
        quickSuggestions: { other: "on", comments: "off", strings: "off" },
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: "currentDocument",
        tabSize: 2,
        fontSize: 12,
        fontFamily: '"JetBrains Mono", monospace',
        lineHeight: 20,
        minimap: { enabled: false },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        renderLineHighlight: "line",
        scrollBeyondLastLine: false,
        padding: { top: 8, bottom: 8 },
      });
    },
    [onSave],
  );

  // Long-press to select word on mobile
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const dom = ed.getDomNode();
    if (!dom) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let selecting = false;
    let startPos: { x: number; y: number } | null = null;

    const clearTimer = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startPos = { x: touch.clientX, y: touch.clientY };
      selecting = false;

      timer = setTimeout(() => {
        const model = ed.getModel();
        if (!model || !startPos) return;
        const target = ed.getTargetAtClientPoint(startPos.x, startPos.y);
        if (!target?.position) return;
        const word = model.getWordAtPosition(target.position);
        if (word) {
          const { lineNumber } = target.position;
          ed.setSelection(
            new (monacoRef.current as any).Selection(lineNumber, word.startColumn, lineNumber, word.endColumn),
          );
          selecting = true;
          // Haptic feedback if available
          navigator.vibrate?.(30);
        }
      }, 400);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!selecting || e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const target = ed.getTargetAtClientPoint(touch.clientX, touch.clientY);
      if (!target?.position) return;
      const curSel = ed.getSelection();
      if (curSel) {
        ed.setSelection(
          new (monacoRef.current as any).Selection(
            curSel.selectionStartLineNumber,
            curSel.selectionStartColumn,
            target.position.lineNumber,
            target.position.column,
          ),
        );
      }
    };

    const onTouchEnd = () => {
      clearTimer();
      selecting = false;
      startPos = null;
    };

    // Cancel long-press if finger moves too much before timer
    const onTouchMoveCancel = (e: TouchEvent) => {
      if (selecting || !startPos || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dist = Math.hypot(t.clientX - startPos.x, t.clientY - startPos.y);
      if (dist > 10) clearTimer();
    };

    dom.addEventListener("touchstart", onTouchStart, { passive: true });
    dom.addEventListener("touchmove", onTouchMove, { passive: false });
    dom.addEventListener("touchmove", onTouchMoveCancel, { passive: true });
    dom.addEventListener("touchend", onTouchEnd, { passive: true });
    dom.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      clearTimer();
      dom.removeEventListener("touchstart", onTouchStart);
      dom.removeEventListener("touchmove", onTouchMove);
      dom.removeEventListener("touchmove", onTouchMoveCancel);
      dom.removeEventListener("touchend", onTouchEnd);
      dom.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [mounted]);

  const handleChange = useCallback(
    (val: string | undefined) => {
      onChange(val ?? "");
    },
    [onChange],
  );

  return (
    <div className="h-full touch-auto select-text">
    <Editor
      height={height}
      language={language}
      value={value}
      onChange={handleChange}
      onMount={handleMount}
      theme="vs-dark"
      options={{
        readOnly,
        domReadOnly: readOnly,
        automaticLayout: true,
        wordWrap: "on",
      }}
      loading={
        <div className="flex items-center justify-center h-full text-neutral-500 text-xs">
          Loading editor...
        </div>
      }
    />
    </div>
  );
}
