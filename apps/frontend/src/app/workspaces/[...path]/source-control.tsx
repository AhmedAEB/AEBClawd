"use client";

import { useState, useEffect, useCallback } from "react";

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
    Promise.all([fetchStatus(), fetchLog()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchLog]);

  const refresh = async () => {
    await Promise.all([fetchStatus(), fetchLog()]);
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
            <span className="border border-edge px-1.5 py-0.5 font-mono text-[10px]">
              {branch}
            </span>
          )}
        </div>
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
