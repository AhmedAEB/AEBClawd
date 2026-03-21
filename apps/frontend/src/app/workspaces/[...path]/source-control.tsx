"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface FileChange {
  file: string;
  status: string;
}

interface Commit {
  graph?: string;
  graphOnly?: boolean;
  hash?: string;
  shortHash?: string;
  author?: string;
  email?: string;
  timestamp?: number;
  subject?: string;
  refs?: string[];
  parents?: string[];
}

interface BranchInfo {
  name: string;
  hash: string;
  upstream?: string | null;
  track?: string | null;
}

interface RemoteBranch {
  name: string;
  hash: string;
}

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  "?": "Untracked",
};

function statusLabel(s: string): string {
  return STATUS_LABELS[s] || s;
}

function timeAgo(ts: number): string {
  const age = Date.now() - ts;
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

export default function SourceControlSidebar({
  relativePath,
  onClose,
  onGenerateMessage,
  canGenerate,
}: {
  relativePath: string;
  onClose: () => void;
  onGenerateMessage?: () => void;
  canGenerate?: boolean;
}) {
  const [branch, setBranch] = useState("");
  const [staged, setStaged] = useState<FileChange[]>([]);
  const [unstaged, setUnstaged] = useState<FileChange[]>([]);
  const [untracked, setUntracked] = useState<{ file: string }[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [diff, setDiff] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"changes" | "log">("changes");
  const [showDiff, setShowDiff] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    hasUpstream: boolean;
    ahead: number;
    behind: number;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/git/status?dir=${encodeURIComponent(relativePath)}`
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setBranch(data.branch);
      setStaged(data.staged ?? []);
      setUnstaged(data.unstaged ?? []);
      setUntracked(data.untracked ?? []);
      setError(null);
    } catch {
      setError("Failed to connect to server");
    }
  }, [relativePath]);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/git/sync-status?dir=${encodeURIComponent(relativePath)}`
      );
      const data = await res.json();
      if (!data.error) {
        setSyncStatus({
          hasUpstream: data.hasUpstream,
          ahead: data.ahead,
          behind: data.behind,
        });
      }
    } catch {
      // silent
    }
  }, [relativePath]);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/git/log?dir=${encodeURIComponent(relativePath)}&limit=40`
      );
      const data = await res.json();
      if (!data.error) setCommits(data.commits ?? []);
    } catch {
      // silent
    }
  }, [relativePath]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStatus(), fetchLog(), fetchSyncStatus()]).finally(() =>
      setLoading(false)
    );
  }, [fetchStatus, fetchLog, fetchSyncStatus]);

  const refresh = async () => {
    await Promise.all([fetchStatus(), fetchLog(), fetchSyncStatus()]);
  };

  const viewDiff = async (file: string, isStaged: boolean) => {
    if (diffFile === file && diffStaged === isStaged && showDiff) {
      setShowDiff(false);
      setDiff(null);
      setDiffFile(null);
      return;
    }
    try {
      const res = await fetch(
        `${API_URL}/api/git/diff?dir=${encodeURIComponent(relativePath)}&file=${encodeURIComponent(file)}&staged=${isStaged}`
      );
      const data = await res.json();
      setDiff(data.diff || "(no diff available)");
      setDiffFile(file);
      setDiffStaged(isStaged);
      setShowDiff(true);
    } catch {
      setDiff("Failed to load diff");
      setDiffFile(file);
      setShowDiff(true);
    }
  };

  const stageFiles = async (files: string[]) => {
    await fetch(`${API_URL}/api/git/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: relativePath, files }),
    });
    await refresh();
  };

  const unstageFiles = async (files: string[]) => {
    await fetch(`${API_URL}/api/git/unstage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: relativePath, files }),
    });
    await refresh();
  };

  const discardFiles = async (files: string[]) => {
    await fetch(`${API_URL}/api/git/discard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: relativePath, files }),
    });
    await refresh();
  };

  const doCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      const res = await fetch(`${API_URL}/api/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: relativePath, message: commitMsg.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setCommitMsg("");
        setError(null);
      }
      await refresh();
    } catch {
      setError("Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  const doPush = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(`${API_URL}/api/git/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: relativePath }),
      });
      const data = await res.json();
      if (data.error) {
        setSyncError(data.error);
      }
      await refresh();
    } catch {
      setSyncError("Push failed — check your connection");
    } finally {
      setSyncing(false);
    }
  };

  const doPull = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(`${API_URL}/api/git/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: relativePath }),
      });
      const data = await res.json();
      if (data.error) {
        setSyncError(
          data.conflict
            ? `MERGE CONFLICT: ${data.error}`
            : data.error
        );
      }
      await refresh();
    } catch {
      setSyncError("Pull failed — check your connection");
    } finally {
      setSyncing(false);
    }
  };

  const doSync = async () => {
    // Pull first, then push (like VSCode "Sync Changes")
    setSyncing(true);
    setSyncError(null);
    try {
      // Pull
      const pullRes = await fetch(`${API_URL}/api/git/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: relativePath }),
      });
      const pullData = await pullRes.json();
      if (pullData.error) {
        setSyncError(
          pullData.conflict
            ? `MERGE CONFLICT: ${pullData.error}`
            : pullData.error
        );
        await refresh();
        return;
      }

      // Push
      const pushRes = await fetch(`${API_URL}/api/git/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: relativePath }),
      });
      const pushData = await pushRes.json();
      if (pushData.error) {
        setSyncError(pushData.error);
      }
      await refresh();
    } catch {
      setSyncError("Sync failed — check your connection");
    } finally {
      setSyncing(false);
    }
  };

  const doCheckout = async (branchName: string) => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/git/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: relativePath, branch: branchName }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      }
      setBranchPickerOpen(false);
      await refresh();
    } catch {
      setError("Failed to switch branch");
    }
  };

  const doCreateBranch = async (name: string, from?: string) => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/git/create-branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: relativePath, name, from: from || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      }
      setBranchPickerOpen(false);
      await refresh();
    } catch {
      setError("Failed to create branch");
    }
  };

  const totalChanges = unstaged.length + untracked.length + staged.length;

  // Diff sub-view (replaces main content when viewing a diff)
  if (showDiff && diff) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b-2 border-edge px-4 py-2">
          <button
            onClick={() => {
              setShowDiff(false);
              setDiff(null);
              setDiffFile(null);
            }}
            className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 hover:text-fg transition-colors"
          >
            &larr; Back
          </button>
          <span className="text-[11px] font-mono text-fg-3 truncate ml-2">
            {diffFile}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          <DiffView content={diff} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-edge px-4 py-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.1em]">
            Source Control
          </h2>
          {branch && (
            <button
              onClick={() => setBranchPickerOpen((v) => !v)}
              className="border border-edge px-1.5 py-0.5 font-mono text-[10px] hover:bg-panel-2 transition-colors flex items-center gap-1"
              title="Switch branch"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-2.5 w-2.5">
                <path fillRule="evenodd" d="M9.965 2.685a.75.75 0 1 0-1.93-.37L6.514 9h-2.34l-1.3-2.08a.75.75 0 0 0-1.272.004l-1.3 2.092A.75.75 0 0 0 .94 10.2h3.406l-1.16 6.03a.75.75 0 0 0 1.463.28L6.22 10.2h2.34l1.3 2.08a.75.75 0 0 0 1.272-.004l1.3-2.092a.75.75 0 0 0-.638-1.184H8.388l1.577-6.315Z" clipRule="evenodd" />
              </svg>
              {branch}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Pull */}
          <button
            onClick={doPull}
            disabled={syncing || !syncStatus?.hasUpstream}
            className="text-fg-3 hover:text-fg transition-colors px-1 disabled:opacity-30"
            title={`Pull${syncStatus?.behind ? ` (${syncStatus.behind} behind)` : ""}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z" clipRule="evenodd" />
            </svg>
          </button>
          {/* Push */}
          <button
            onClick={doPush}
            disabled={syncing}
            className="text-fg-3 hover:text-fg transition-colors px-1 disabled:opacity-30"
            title={`Push${syncStatus?.ahead ? ` (${syncStatus.ahead} ahead)` : ""}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z" clipRule="evenodd" />
            </svg>
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="text-fg-3 hover:text-fg transition-colors px-1"
            aria-label="Close source control"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      </div>

      {branchPickerOpen && (
        <BranchPicker
          relativePath={relativePath}
          currentBranch={branch}
          onCheckout={doCheckout}
          onCreate={doCreateBranch}
          onClose={() => setBranchPickerOpen(false)}
        />
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex border-b border-edge">
            <button
              onClick={() => setTab("changes")}
              className={`flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                tab === "changes"
                  ? "bg-fg text-void"
                  : "text-fg-3 hover:text-fg hover:bg-panel-2"
              }`}
            >
              Changes{totalChanges > 0 ? ` (${totalChanges})` : ""}
            </button>
            <button
              onClick={() => setTab("log")}
              className={`flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                tab === "log"
                  ? "bg-fg text-void"
                  : "text-fg-3 hover:text-fg hover:bg-panel-2"
              }`}
            >
              Log
            </button>
          </div>

          {/* Sync bar */}
          {syncStatus && (
            <div className="border-b border-edge px-3 py-1.5 flex items-center gap-2">
              <button
                onClick={doSync}
                disabled={syncing}
                className="flex-1 flex items-center justify-center gap-1.5 border-2 border-fg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg transition-colors hover:bg-panel-2 disabled:opacity-30"
              >
                {syncing ? (
                  <div className="h-3 w-3 animate-spin border border-fg border-t-transparent" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                    <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.379 2.624l-1.42 1.42a7.5 7.5 0 0 0 12.799-3.544.75.75 0 0 0-1-.75l-1 .25ZM4.688 8.576a5.5 5.5 0 0 1 9.379-2.624l1.42-1.42a7.5 7.5 0 0 0-12.799 3.544.75.75 0 0 0 1 .75l1-.25Z" clipRule="evenodd" />
                  </svg>
                )}
                {syncing
                  ? "Syncing..."
                  : syncStatus.hasUpstream
                    ? `Sync${syncStatus.ahead || syncStatus.behind ? ` ${syncStatus.ahead}↑ ${syncStatus.behind}↓` : ""}`
                    : "Publish Branch"}
              </button>
            </div>
          )}

          {/* Sync error */}
          {syncError && (
            <div className="border-b border-edge px-3 py-2">
              <div className="border-2 border-fg px-2 py-1.5 text-[10px] font-mono text-fg break-all whitespace-pre-wrap">
                {syncError}
              </div>
              <button
                onClick={() => setSyncError(null)}
                className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-fg-3 hover:text-fg transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {tab === "changes" ? (
              <ChangesPanel
                staged={staged}
                unstaged={unstaged}
                untracked={untracked}
                commitMsg={commitMsg}
                setCommitMsg={setCommitMsg}
                committing={committing}
                onCommit={doCommit}
                onStage={stageFiles}
                onUnstage={unstageFiles}
                onDiscard={discardFiles}
                onViewDiff={viewDiff}
                diffFile={diffFile}
                diffStaged={diffStaged}
                error={error}
                onGenerateMessage={onGenerateMessage}
                canGenerate={canGenerate}
              />
            ) : (
              <LogPanel commits={commits} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Changes Panel ────────────────────────────────────────── */

function ChangesPanel({
  staged,
  unstaged,
  untracked,
  commitMsg,
  setCommitMsg,
  committing,
  onCommit,
  onStage,
  onUnstage,
  onDiscard,
  onViewDiff,
  diffFile,
  diffStaged,
  error,
  onGenerateMessage,
  canGenerate,
}: {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: { file: string }[];
  commitMsg: string;
  setCommitMsg: (v: string) => void;
  committing: boolean;
  onCommit: () => void;
  onStage: (f: string[]) => void;
  onUnstage: (f: string[]) => void;
  onDiscard: (f: string[]) => void;
  onViewDiff: (f: string, staged: boolean) => void;
  diffFile: string | null;
  diffStaged: boolean;
  error: string | null;
  onGenerateMessage?: () => void;
  canGenerate?: boolean;
}) {
  return (
    <div className="flex flex-col">
      {/* Commit box */}
      <div className="border-b border-edge p-3">
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onCommit();
          }}
          placeholder="Commit message"
          rows={3}
          className="w-full resize-none border-2 border-edge bg-transparent px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-3 font-mono focus:border-fg"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={onCommit}
            disabled={committing || !commitMsg.trim() || staged.length === 0}
            className="bg-fg px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-void transition-colors hover:bg-fg-2 disabled:opacity-30"
          >
            {committing ? "Committing..." : "Commit"}
          </button>
          {onGenerateMessage && (
            <button
              onClick={onGenerateMessage}
              disabled={!canGenerate || (staged.length === 0 && unstaged.length === 0 && untracked.length === 0)}
              className="border-2 border-fg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg transition-colors hover:bg-panel-2 disabled:opacity-30"
              title="Ask Claude to generate a commit message"
            >
              Generate
            </button>
          )}
          {staged.length === 0 && (unstaged.length > 0 || untracked.length > 0) && (
            <button
              onClick={() => {
                const all = [
                  ...unstaged.map((f) => f.file),
                  ...untracked.map((f) => f.file),
                ];
                onStage(all);
              }}
              className="border-2 border-fg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg transition-colors hover:bg-panel-2"
            >
              Stage All
            </button>
          )}
        </div>
        {error && (
          <div className="mt-2 border border-edge px-2 py-1.5 text-[10px] font-mono text-fg break-all">
            {error}
          </div>
        )}
      </div>

      {/* Staged changes */}
      {staged.length > 0 && (
        <div>
          <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-3">
              Staged ({staged.length})
            </span>
            <button
              onClick={() => onUnstage(staged.map((f) => f.file))}
              className="text-[10px] font-semibold uppercase tracking-wide text-fg-3 hover:text-fg transition-colors"
            >
              Unstage All
            </button>
          </div>
          {staged.map((f) => (
            <FileRow
              key={`s-${f.file}`}
              file={f.file}
              status={statusLabel(f.status)}
              active={diffFile === f.file && diffStaged}
              onClick={() => onViewDiff(f.file, true)}
              actions={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstage([f.file]);
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-semibold text-fg-3 opacity-0 group-hover:opacity-100 hover:text-fg transition-all"
                  title="Unstage"
                >
                  −
                </button>
              }
            />
          ))}
        </div>
      )}

      {/* Unstaged changes */}
      {unstaged.length > 0 && (
        <div>
          <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-3">
              Changes ({unstaged.length})
            </span>
            <button
              onClick={() => onStage(unstaged.map((f) => f.file))}
              className="text-[10px] font-semibold uppercase tracking-wide text-fg-3 hover:text-fg transition-colors"
            >
              Stage All
            </button>
          </div>
          {unstaged.map((f) => (
            <FileRow
              key={`u-${f.file}`}
              file={f.file}
              status={statusLabel(f.status)}
              active={diffFile === f.file && !diffStaged}
              onClick={() => onViewDiff(f.file, false)}
              actions={
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStage([f.file]);
                    }}
                    className="px-1.5 py-0.5 text-[10px] font-semibold text-fg-3 hover:text-fg"
                    title="Stage"
                  >
                    +
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDiscard([f.file]);
                    }}
                    className="px-1.5 py-0.5 text-[10px] font-semibold text-fg-3 hover:text-fg"
                    title="Discard"
                  >
                    ×
                  </button>
                </div>
              }
            />
          ))}
        </div>
      )}

      {/* Untracked files */}
      {untracked.length > 0 && (
        <div>
          <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-3">
              Untracked ({untracked.length})
            </span>
            <button
              onClick={() => onStage(untracked.map((f) => f.file))}
              className="text-[10px] font-semibold uppercase tracking-wide text-fg-3 hover:text-fg transition-colors"
            >
              Stage All
            </button>
          </div>
          {untracked.map((f) => (
            <FileRow
              key={`t-${f.file}`}
              file={f.file}
              status="Untracked"
              active={false}
              onClick={() => {}}
              actions={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage([f.file]);
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-semibold text-fg-3 opacity-0 group-hover:opacity-100 hover:text-fg transition-all"
                  title="Stage"
                >
                  +
                </button>
              }
            />
          ))}
        </div>
      )}

      {staged.length === 0 &&
        unstaged.length === 0 &&
        untracked.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-fg-3">
            Working tree clean
          </div>
        )}
    </div>
  );
}

/* ── File Row ─────────────────────────────────────────────── */

function FileRow({
  file,
  status,
  active,
  onClick,
  actions,
}: {
  file: string;
  status: string;
  active: boolean;
  onClick: () => void;
  actions: React.ReactNode;
}) {
  const filename = file.split("/").pop() || file;
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";

  return (
    <div
      onClick={onClick}
      className={`group flex cursor-pointer items-center border-b border-edge px-3 py-1 transition-colors hover:bg-panel-2 ${
        active ? "bg-panel-2" : ""
      }`}
    >
      <div className="flex-1 min-w-0 overflow-hidden">
        <span className="text-[11px] font-mono text-fg truncate block">
          {filename}
        </span>
        {dir && (
          <span className="text-[10px] font-mono text-fg-3 truncate block">
            {dir}
          </span>
        )}
      </div>
      <span className="ml-1 text-[9px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">
        {status}
      </span>
      {actions}
    </div>
  );
}

/* ── Branch Picker ────────────────────────────────────────── */

function BranchPicker({
  relativePath,
  currentBranch,
  onCheckout,
  onCreate,
  onClose,
}: {
  relativePath: string;
  currentBranch: string;
  onCheckout: (branch: string) => void;
  onCreate: (name: string, from?: string) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<BranchInfo[]>([]);
  const [remote, setRemote] = useState<RemoteBranch[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "create">("list");
  const [newName, setNewName] = useState("");
  const [baseBranch, setBaseBranch] = useState(currentBranch);
  const [showBaseSelect, setShowBaseSelect] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/git/branches?dir=${encodeURIComponent(relativePath)}`
        );
        const data = await res.json();
        if (!data.error) {
          setLocal(data.local ?? []);
          setRemote(data.remote ?? []);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [relativePath]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const q = filter.toLowerCase();
  const filteredLocal = local.filter((b) => b.name.toLowerCase().includes(q));
  const filteredRemote = remote.filter(
    (b) =>
      b.name.toLowerCase().includes(q) &&
      !local.some((l) => b.name === `origin/${l.name}`)
  );

  // All branches available as base (local + remote)
  const allBranches = [
    ...local.map((b) => b.name),
    ...remote.map((b) => b.name),
  ];

  if (mode === "create") {
    return (
      <div className="border-b-2 border-edge">
        <div className="px-3 py-2 flex items-center gap-2">
          <button
            onClick={() => setMode("list")}
            className="text-[10px] font-semibold uppercase tracking-wide text-fg-3 hover:text-fg transition-colors"
          >
            &larr;
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-3">
            New Branch
          </span>
        </div>
        <div className="px-3 pb-3 flex flex-col gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                onCreate(newName.trim(), baseBranch !== currentBranch ? baseBranch : undefined);
              }
              if (e.key === "Escape") onClose();
            }}
            placeholder="Branch name"
            className="w-full border-2 border-edge bg-transparent px-2 py-1 text-[11px] font-mono text-fg outline-none placeholder:text-fg-3 focus:border-fg"
          />
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">
              From:
            </span>
            <button
              onClick={() => setShowBaseSelect((v) => !v)}
              className="flex-1 border border-edge px-1.5 py-0.5 text-[10px] font-mono text-fg text-left hover:bg-panel-2 transition-colors truncate"
            >
              {baseBranch}
            </button>
          </div>
          {showBaseSelect && (
            <div className="max-h-32 overflow-y-auto border border-edge">
              {allBranches.map((b) => (
                <button
                  key={b}
                  onClick={() => {
                    setBaseBranch(b);
                    setShowBaseSelect(false);
                  }}
                  className={`block w-full text-left px-2 py-0.5 text-[10px] font-mono hover:bg-panel-2 transition-colors ${
                    b === baseBranch ? "bg-panel-2 text-fg" : "text-fg-3"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              if (newName.trim()) {
                onCreate(newName.trim(), baseBranch !== currentBranch ? baseBranch : undefined);
              }
            }}
            disabled={!newName.trim()}
            className="bg-fg px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-void transition-colors hover:bg-fg-2 disabled:opacity-30"
          >
            Create & Switch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b-2 border-edge">
      <div className="px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Filter branches..."
          className="w-full border-2 border-edge bg-transparent px-2 py-1 text-[11px] font-mono text-fg outline-none placeholder:text-fg-3 focus:border-fg"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-3 w-3 animate-spin border border-fg border-t-transparent" />
        </div>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          {/* Create new branch option */}
          <button
            onClick={() => {
              setMode("create");
              setNewName(filter);
              setFilter("");
            }}
            className="flex w-full items-center gap-1.5 border-b border-edge px-3 py-1.5 text-left hover:bg-panel-2 transition-colors"
          >
            <span className="text-[11px] font-mono text-fg-3">+</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">
              Create new branch{filter ? `: ${filter}` : ""}
            </span>
          </button>

          {/* Local branches */}
          {filteredLocal.length > 0 && (
            <>
              <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-fg-3">
                Local
              </div>
              {filteredLocal.map((b) => (
                <button
                  key={b.name}
                  onClick={() => {
                    if (b.name !== currentBranch) onCheckout(b.name);
                  }}
                  disabled={b.name === currentBranch}
                  className={`flex w-full items-center gap-1.5 border-b border-edge px-3 py-1 text-left transition-colors ${
                    b.name === currentBranch
                      ? "bg-panel-2"
                      : "hover:bg-panel-2"
                  }`}
                >
                  {b.name === currentBranch && (
                    <span className="text-[10px] text-fg shrink-0">*</span>
                  )}
                  <span className="text-[11px] font-mono text-fg truncate flex-1">
                    {b.name}
                  </span>
                  <span className="text-[9px] font-mono text-fg-3 shrink-0">
                    {b.hash}
                  </span>
                  {b.track && (
                    <span className="text-[8px] font-mono text-fg-3 shrink-0">
                      {b.track}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}

          {/* Remote branches (not already checked out locally) */}
          {filteredRemote.length > 0 && (
            <>
              <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-fg-3">
                Remote
              </div>
              {filteredRemote.map((b) => (
                <button
                  key={b.name}
                  onClick={() => {
                    // Checkout remote branch — creates local tracking branch
                    const localName = b.name.replace(/^origin\//, "");
                    onCheckout(localName);
                  }}
                  className="flex w-full items-center gap-1.5 border-b border-edge px-3 py-1 text-left hover:bg-panel-2 transition-colors"
                >
                  <span className="text-[11px] font-mono text-fg-3 truncate flex-1">
                    {b.name}
                  </span>
                  <span className="text-[9px] font-mono text-fg-3 shrink-0">
                    {b.hash}
                  </span>
                </button>
              ))}
            </>
          )}

          {filteredLocal.length === 0 && filteredRemote.length === 0 && (
            <div className="px-3 py-3 text-center text-[10px] text-fg-3">
              No branches match &ldquo;{filter}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Log Panel ────────────────────────────────────────────── */

function LogPanel({ commits }: { commits: Commit[] }) {
  if (commits.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[12px] text-fg-3">
        No commits found
      </div>
    );
  }

  return (
    <div>
      {commits
        .filter((c) => !c.graphOnly)
        .map((c) => (
          <div
            key={c.hash}
            className="group border-b border-edge px-3 py-1.5 transition-colors hover:bg-panel-2"
          >
            <div className="flex items-start gap-1.5">
              {c.graph && (
                <span className="font-mono text-[11px] text-fg-3 leading-tight whitespace-pre shrink-0">
                  {c.graph}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-1">
                  <span className="text-[11px] text-fg leading-snug line-clamp-1 flex-1">
                    {c.subject}
                  </span>
                  <span className="text-[9px] font-mono text-fg-3 shrink-0 tabular-nums">
                    {c.shortHash}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] text-fg-3 truncate">
                    {c.author}
                  </span>
                  {c.timestamp && (
                    <span className="text-[9px] text-fg-3 tabular-nums shrink-0">
                      {timeAgo(c.timestamp)}
                    </span>
                  )}
                  {c.refs && c.refs.length > 0 && (
                    <div className="flex gap-0.5 flex-wrap">
                      {c.refs.map((ref) => (
                        <span
                          key={ref}
                          className="border border-edge px-1 text-[8px] font-mono text-fg-3"
                        >
                          {ref}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}

/* ── Diff Viewer ──────────────────────────────────────────── */

function DiffView({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <pre className="text-[11px] font-mono leading-relaxed">
      {lines.map((line, i) => {
        let bg = "";
        let textColor = "text-fg-2";

        if (line.startsWith("+++") || line.startsWith("---")) {
          textColor = "text-fg font-semibold";
        } else if (line.startsWith("@@")) {
          bg = "bg-panel-3";
          textColor = "text-fg-3";
        } else if (line.startsWith("+")) {
          bg = "bg-panel-2";
          textColor = "text-fg";
        } else if (line.startsWith("-")) {
          bg = "bg-panel-3";
          textColor = "text-fg-3";
        } else if (line.startsWith("diff ")) {
          textColor = "text-fg font-semibold";
        }

        return (
          <div key={i} className={`px-3 ${bg} ${textColor}`}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </pre>
  );
}
