"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/** Map file extension to Monaco language id */
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
  // Also check full filename for things like Dockerfile, Makefile
  const nameMap: Record<string, string> = {
    dockerfile: "dockerfile", makefile: "makefile",
  };
  return map[ext] || nameMap[filename.toLowerCase()] || "plaintext";
}

interface FileTreeEntry {
  name: string;
  isDirectory: boolean;
}

function FileTree({
  relativePath,
  currentFile,
  onSelectFile,
}: {
  relativePath: string;
  currentFile: string;
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

  const toggleDir = useCallback(
    async (dirPath: string) => {
      const next = new Set(expanded);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        if (!children[dirPath]) {
          try {
            const res = await fetch(
              `${API_URL}/api/filesystem?path=${encodeURIComponent(dirPath)}`
            );
            const data = await res.json();
            setChildren((prev) => ({ ...prev, [dirPath]: data.entries ?? [] }));
          } catch (err) {
            console.error(err);
          }
        }
      }
      setExpanded(next);
    },
    [expanded, children]
  );

  const renderEntries = (items: FileTreeEntry[], basePath: string, depth: number) => (
    <>
      {items.map((entry) => {
        const fullPath = `${basePath}/${entry.name}`;
        const isActive = fullPath === currentFile;

        if (entry.isDirectory) {
          const isOpen = expanded.has(fullPath);
          return (
            <div key={fullPath}>
              <button
                onClick={() => toggleDir(fullPath)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] text-fg-2 hover:bg-panel-2 hover:text-fg"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
                <span className="truncate font-mono">{entry.name}</span>
              </button>
              {isOpen && children[fullPath] && renderEntries(children[fullPath], fullPath, depth + 1)}
            </div>
          );
        }

        return (
          <button
            key={fullPath}
            onClick={() => onSelectFile(fullPath)}
            className={`flex w-full items-center gap-1.5 py-1 text-left text-[12px] hover:bg-panel-2 ${
              isActive ? "bg-panel-3 text-fg font-semibold" : "text-fg-2 hover:text-fg"
            }`}
            style={{ paddingLeft: `${depth * 12 + 22}px` }}
          >
            <span className="truncate font-mono">{entry.name}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <div className="h-full overflow-y-auto border-r border-edge bg-panel">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-fg-3">
        Explorer
      </div>
      {renderEntries(entries, relativePath, 0)}
    </div>
  );
}

export default function EditorView({
  relativePath,
  filePath,
}: {
  relativePath: string;
  filePath: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentFile, setCurrentFile] = useState(filePath);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const contentRef = useRef<string>("");

  const fileName = currentFile.split("/").pop() ?? "";
  const language = getLanguage(fileName);

  const loadFile = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setDirty(false);
    try {
      const res = await fetch(
        `${API_URL}/api/filesystem/read?path=${encodeURIComponent(path)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load file");
        setContent(null);
      } else {
        setContent(data.content);
        contentRef.current = data.content;
      }
    } catch {
      setError("Failed to load file");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFile(currentFile);
  }, [currentFile, loadFile]);

  const saveFile = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/filesystem/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentFile, content: contentRef.current }),
      });
      if (res.ok) {
        setDirty(false);
      }
    } catch {
      // silent fail — user can retry
    } finally {
      setSaving(false);
    }
  }, [currentFile, dirty]);

  const handleEditorMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;

      // Ctrl/Cmd+S to save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveFile();
      });
    },
    [saveFile]
  );

  const handleChange = useCallback((value: string | undefined) => {
    contentRef.current = value ?? "";
    setDirty(true);
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setCurrentFile(path);
  }, []);

  const pathSegments = relativePath.split("/").filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-2">
        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-1 text-[11px] font-mono text-fg-3">
            <Link href="/workspaces" className="hover:text-fg transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" />
              </svg>
            </Link>
            {pathSegments.map((seg, i) => {
              const href = `/workspaces/${pathSegments.slice(0, i + 1).map(encodeURIComponent).join("/")}`;
              return (
                <span key={i} className="flex items-center gap-1">
                  <span>/</span>
                  <Link href={href} className="hover:text-fg transition-colors">{seg}</Link>
                </span>
              );
            })}
          </nav>
          <span className="text-[11px] font-mono text-fg-3 ml-1">
            / {fileName}
            {dirty && <span className="ml-1 text-fg">*</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-fg-3 uppercase">{language}</span>
          <button
            onClick={saveFile}
            disabled={!dirty || saving}
            className="bg-fg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-void transition-colors hover:bg-fg-2 disabled:opacity-30"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link
            href={`/workspaces/${encodePath(relativePath)}`}
            className="border-2 border-fg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg transition-colors hover:bg-panel-2"
          >
            Close
          </Link>
        </div>
      </div>

      {/* Main area: sidebar + editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-56 shrink-0">
          <FileTree
            relativePath={relativePath}
            currentFile={currentFile}
            onSelectFile={handleSelectFile}
          />
        </div>

        {/* Editor */}
        <div className="flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-fg-3">
              {error}
            </div>
          ) : (
            <Editor
              height="100%"
              language={language}
              value={content ?? ""}
              theme="vs"
              onChange={handleChange}
              onMount={handleEditorMount}
              options={{
                fontSize: 13,
                fontFamily: "var(--font-jetbrains-mono), monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                renderLineHighlight: "line",
                padding: { top: 12 },
                wordWrap: "on",
                tabSize: 2,
                automaticLayout: true,
              }}
              loading={
                <div className="flex h-full items-center justify-center">
                  <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
                </div>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
