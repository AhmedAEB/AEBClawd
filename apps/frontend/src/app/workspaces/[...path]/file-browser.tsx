"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import Link from "next/link";

const TerminalPanel = lazy(() => import("@/components/terminal"));

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export default function FileBrowser({ relativePath }: { relativePath: string }) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);

  const pathSegments = relativePath.split("/").filter(Boolean);
  const dirName = pathSegments[pathSegments.length - 1] ?? "root";

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/filesystem?path=${encodeURIComponent(relativePath)}`
      );
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
    } finally {
      setLoading(false);
    }
  }, [relativePath]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await fetch(`${API_URL}/api/filesystem/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `${relativePath}/${name}` }),
    });
    setNewFolderName("");
    setShowNewFolder(false);
    fetchEntries();
  };

  const deleteFolder = async (name: string) => {
    await fetch(`${API_URL}/api/filesystem/rmdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `${relativePath}/${name}` }),
    });
    setDeleteConfirm(null);
    fetchEntries();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1 text-[11px] font-mono text-fg-3">
          <Link href="/workspaces" className="hover:text-fg transition-colors" aria-label="Home">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" /></svg>
          </Link>
          {pathSegments.map((seg, i) => {
            const href = `/workspaces/${pathSegments.slice(0, i + 1).map(encodeURIComponent).join("/")}`;
            const isLast = i === pathSegments.length - 1;
            return (
              <span key={i} className="flex items-center gap-1">
                <span>/</span>
                {isLast ? (
                  <span className="text-fg">{seg}</span>
                ) : (
                  <Link href={href} className="hover:text-fg transition-colors">
                    {seg}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-bold uppercase tracking-[0.1em]">
              {dirName}
            </h2>
            <Link
              href={`/workspaces/${encodePath(relativePath)}/sessions`}
              className="bg-fg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-void transition-colors hover:bg-fg-2"
            >
              Open Sessions
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={`${showTerminal ? "bg-fg text-void" : "border-2 border-fg text-fg hover:bg-panel-2"} px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors`}
            >
              Terminal
            </button>
            <button
              onClick={() => setShowNewFolder(!showNewFolder)}
              className="border-2 border-fg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg transition-colors hover:bg-panel-2"
            >
              New Folder
            </button>
          </div>
        </div>

        {showNewFolder && (
          <div className="mb-4 flex items-end gap-2 border-2 border-edge p-3">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="Folder name"
              autoFocus
              className="flex-1 border-b-2 border-edge bg-transparent px-2 py-1 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-fg"
            />
            <button
              onClick={createFolder}
              disabled={!newFolderName.trim()}
              className="bg-fg px-3 py-1.5 text-[11px] font-semibold text-void transition-colors hover:bg-fg-2 disabled:opacity-30"
            >
              Create
            </button>
            <button
              onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
              className="border-2 border-fg px-3 py-1.5 text-[11px] font-semibold text-fg transition-colors hover:bg-panel-2"
            >
              Cancel
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center text-sm text-fg-3">
            Empty directory. Use "Open Sessions" to start a Claude session here.
          </div>
        ) : (
          <div className="space-y-0">
            {entries.map((entry) => (
              <div
                key={entry.name}
                className="group flex items-center border-b border-edge transition-colors hover:bg-panel-2"
              >
                {entry.isDirectory ? (
                  <>
                    <Link
                      href={`/workspaces/${encodePath(relativePath)}/${encodeURIComponent(entry.name)}`}
                      className="flex flex-1 items-center gap-2 px-4 py-3 text-[13px] text-fg-2 group-hover:text-fg"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-fg-3">
                        <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z" />
                      </svg>
                      {entry.name}
                    </Link>
                    <Link
                      href={`/workspaces/${encodePath(relativePath)}/${encodeURIComponent(entry.name)}/sessions`}
                      className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-3 transition-colors hover:text-fg"
                    >
                      Sessions
                    </Link>
                    {deleteConfirm === entry.name ? (
                      <div className="flex items-center gap-1 pr-4">
                        <button
                          onClick={() => deleteFolder(entry.name)}
                          className="px-2 py-1 text-[10px] font-semibold uppercase text-fg transition-colors hover:bg-panel-3"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2 py-1 text-[10px] font-semibold uppercase text-fg-3 transition-colors hover:text-fg"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(entry.name)}
                        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-3 opacity-0 transition-all group-hover:opacity-100 hover:text-fg"
                      >
                        Delete
                      </button>
                    )}
                  </>
                ) : (
                  <Link
                    href={`/workspaces/${encodePath(relativePath)}/editor/${encodeURIComponent(entry.name)}`}
                    className="flex flex-1 items-center gap-2 px-4 py-3 text-[13px] text-fg-2 group-hover:text-fg"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-fg-3">
                      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Z" />
                    </svg>
                    {entry.name}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {showTerminal && (
        <Suspense fallback={
          <div className="flex items-center justify-center border-t-2 border-edge py-8">
            <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
          </div>
        }>
          <TerminalPanel
            relativePath={relativePath}
            onClose={() => setShowTerminal(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
