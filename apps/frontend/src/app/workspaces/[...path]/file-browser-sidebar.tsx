"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", html: "html", css: "css", scss: "scss",
    less: "less", xml: "xml", yaml: "yaml", yml: "yaml", toml: "ini",
    py: "python", rb: "ruby", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", h: "cpp", cs: "csharp", php: "php",
    sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
    sql: "sql", graphql: "graphql", dockerfile: "dockerfile",
    makefile: "makefile", svg: "xml", env: "ini", gitignore: "ini",
    lock: "json", mjs: "javascript", cjs: "javascript", mts: "typescript",
  };
  return map[ext] || "plaintext";
}

interface FileTreeEntry { name: string; isDirectory: boolean; }

function FileTree({
  relativePath, currentFile, onSelectFile,
}: {
  relativePath: string; currentFile: string | null;
  onSelectFile: (filePath: string) => void;
}) {
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, FileTreeEntry[]>>({});

  useEffect(() => {
    fetch(`${API_URL}/api/filesystem?path=${encodeURIComponent(relativePath)}`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(console.error);
  }, [relativePath]);

  const toggleDir = useCallback(async (dirPath: string) => {
    const next = new Set(expanded);
    if (next.has(dirPath)) {
      next.delete(dirPath);
    } else {
      next.add(dirPath);
      if (!children[dirPath]) {
        try {
          const res = await fetch(`${API_URL}/api/filesystem?path=${encodeURIComponent(dirPath)}`);
          const data = await res.json();
          setChildren((prev) => ({ ...prev, [dirPath]: data.entries ?? [] }));
        } catch (err) { console.error(err); }
      }
    }
    setExpanded(next);
  }, [expanded, children]);

  const renderEntries = (items: FileTreeEntry[], basePath: string, depth: number) => (
    <>
      {items.map((entry) => {
        const fullPath = `${basePath}/${entry.name}`;
        const isActive = fullPath === currentFile;
        if (entry.isDirectory) {
          const isOpen = expanded.has(fullPath);
          return (
            <div key={fullPath}>
              <button onClick={() => toggleDir(fullPath)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] text-fg-2 hover:bg-panel-2 hover:text-fg"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"
                  className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                  <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
                <span className="truncate font-mono">{entry.name}</span>
              </button>
              {isOpen && children[fullPath] && renderEntries(children[fullPath], fullPath, depth + 1)}
            </div>
          );
        }
        return (
          <button key={fullPath} onClick={() => onSelectFile(fullPath)}
            className={`flex w-full items-center gap-1.5 py-1 text-left text-[12px] hover:bg-panel-2 ${isActive ? "bg-panel-3 text-fg font-semibold" : "text-fg-2 hover:text-fg"}`}
            style={{ paddingLeft: `${depth * 12 + 22}px` }}>
            <span className="truncate font-mono">{entry.name}</span>
          </button>
        );
      })}
    </>
  );

  return <div className="overflow-y-auto">{renderEntries(entries, relativePath, 0)}</div>;
}

export default function FileBrowserSidebar({
  relativePath, onClose,
}: {
  relativePath: string; onClose: () => void;
}) {
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const contentRef = useRef<string>("");

  const fileName = currentFile?.split("/").pop() ?? "";
  const language = getLanguage(fileName);

  const loadFile = useCallback(async (fpath: string) => {
    setLoading(true); setError(null); setDirty(false);
    try {
      const res = await fetch(`${API_URL}/api/filesystem/read?path=${encodeURIComponent(fpath)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to load file"); setContent(null); }
      else { setContent(data.content); contentRef.current = data.content; }
    } catch { setError("Failed to load file"); }
    finally { setLoading(false); }
  }, []);

  const saveFile = useCallback(async () => {
    if (!dirty || !currentFile) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/filesystem/write`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentFile, content: contentRef.current }),
      });
      if (res.ok) setDirty(false);
    } catch {} finally { setSaving(false); }
  }, [currentFile, dirty]);

  const handleEditorMount = useCallback((ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = ed;
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { saveFile(); });
  }, [saveFile]);

  const handleChange = useCallback((value: string | undefined) => {
    contentRef.current = value ?? ""; setDirty(true);
  }, []);

  const handleSelectFile = useCallback((fpath: string) => {
    setCurrentFile(fpath); loadFile(fpath);
  }, [loadFile]);

  return (
    <div className="flex h-full flex-col bg-void">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-3">Files</span>
        <div className="flex items-center gap-1">
          {currentFile && (
            <>
              <button onClick={saveFile} disabled={!dirty || saving}
                className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg transition-colors hover:bg-panel-2 disabled:opacity-30">
                {saving ? "Saving\u2026" : "Save"}
              </button>
              <button onClick={() => { setCurrentFile(null); setContent(null); setError(null); setDirty(false); }}
                className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-3 transition-colors hover:text-fg">
                Back
              </button>
            </>
          )}
          <button onClick={onClose} className="p-1 text-fg-3 transition-colors hover:text-fg" aria-label="Close file browser">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
      </div>

      {currentFile ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-1 border-b border-edge px-3 py-1.5 text-[11px] font-mono text-fg-2">
            <span className="truncate">{fileName}</span>
            {dirty && <span className="text-fg">*</span>}
            <span className="ml-auto text-[10px] text-fg-3 uppercase">{language}</span>
          </div>
          <div className="flex-1">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center p-4 text-[12px] text-fg-3">{error}</div>
            ) : (
              <Editor height="100%" language={language} value={content ?? ""} theme="vs"
                onChange={handleChange} onMount={handleEditorMount}
                options={{
                  fontSize: 12, fontFamily: "var(--font-jetbrains-mono), monospace",
                  minimap: { enabled: false }, scrollBeyondLastLine: false,
                  lineNumbers: "on", renderLineHighlight: "line", padding: { top: 8 },
                  wordWrap: "on", tabSize: 2, automaticLayout: true,
                  lineNumbersMinChars: 3, folding: true, glyphMargin: false,
                }}
                loading={<div className="flex h-full items-center justify-center"><div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" /></div>}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          <FileTree relativePath={relativePath} currentFile={currentFile} onSelectFile={handleSelectFile} />
        </div>
      )}
    </div>
  );
}
