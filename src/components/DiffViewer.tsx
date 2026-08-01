import { useCallback, useMemo } from "react";
import { DiffEditor, type OnMount } from "@monaco-editor/react";

interface DiffViewerProps {
  path: string;
  original: string;
  modified: string;
  height?: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  html: "html",
  css: "css",
  py: "python",
  go: "go",
  rs: "rust",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
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
];

const THEME_COLORS = {
  "editor.background": "#0a0a0a",
  "editor.foreground": "#e0e0e0",
  "editorCursor.foreground": "#e0e0e0",
  "diffEditor.insertedTextBackground": "#2ea04326",
  "diffEditor.removedTextBackground": "#f8514926",
  "diffEditor.insertedLineBackground": "#2ea04315",
  "diffEditor.removedLineBackground": "#f8514915",
  "diffEditor.border": "#333333",
  "editorLineNumber.foreground": "#444444",
  "minimap.background": "#0a0a0a",
};

export default function DiffViewer({
  path,
  original,
  modified,
  height = "100%",
}: DiffViewerProps) {
  const language = useMemo(() => getLanguage(path), [path]);

  const handleMount: OnMount = useCallback((_, monaco) => {
    monaco.editor.defineTheme("infinite-diff", {
      base: "vs-dark",
      inherit: true,
      rules: THEME_RULES,
      colors: THEME_COLORS,
    });
    monaco.editor.setTheme("infinite-diff");
  }, []);

  return (
    <DiffEditor
      height={height}
      language={language}
      original={original}
      modified={modified}
      onMount={handleMount}
      theme="vs-dark"
      options={{
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        wordWrap: "on",
        fontSize: 12,
        fontFamily: '"JetBrains Mono", monospace',
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 8, bottom: 8 },
      }}
      loading={
        <div className="flex items-center justify-center h-full text-neutral-500 text-xs">
          Loading diff...
        </div>
      }
    />
  );
}
