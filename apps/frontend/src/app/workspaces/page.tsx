"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export default function WorkspacesRootPage() {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/filesystem`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (err) {
      console.error("Failed to fetch directories:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await fetch(`${API_URL}/api/filesystem/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: name }),
    });
    setNewFolderName("");
    setShowNewFolder(false);
    fetchEntries();
  };

  const deleteFolder = async (name: string) => {
    await fetch(`${API_URL}/api/filesystem/rmdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: name }),
    });
    setDeleteConfirm(null);
    fetchEntries();
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display text-lg font-bold uppercase tracking-[0.1em]">
              Workspaces
            </h2>
            <div className="mt-1 flex items-center text-xs text-fg-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" /></svg>
            </div>
          </div>
          <button
            onClick={() => setShowNewFolder(!showNewFolder)}
            className="bg-fg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-void transition-colors hover:bg-fg-2"
          >
            New Folder
          </button>
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
            No directories found. Create one to get started.
          </div>
        ) : (
          <div className="space-y-0">
            {entries.map((entry) => (
              <div
                key={entry.name}
                className="group flex items-center border-b border-edge transition-colors hover:bg-panel-2"
              >
                <Link
                  href={`/workspaces/${entry.name}`}
                  className="flex-1 px-4 py-3 text-[13px] text-fg-2 group-hover:text-fg"
                >
                  {entry.name}
                </Link>
                <Link
                  href={`/workspaces/${entry.name}/sessions`}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
