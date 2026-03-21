"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
}

export default function SessionsList({ relativePath }: { relativePath: string }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const pathSegments = relativePath.split("/").filter(Boolean);
  const dirName = pathSegments[pathSegments.length - 1] ?? "root";

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/sessions?dir=${encodeURIComponent(relativePath)}&limit=50`
      );
      const data: SessionInfo[] = await res.json();
      setSessions(data);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  }, [relativePath]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const startNewSession = () => {
    router.push(`/workspaces/${relativePath}/sessions/new`);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1 text-[11px] font-mono text-fg-3">
          <Link href="/workspaces" className="hover:text-fg transition-colors">
            /
          </Link>
          {pathSegments.map((seg, i) => {
            const href = `/workspaces/${pathSegments.slice(0, i + 1).join("/")}`;
            return (
              <span key={i} className="flex items-center gap-1">
                <span>/</span>
                <Link href={href} className="hover:text-fg transition-colors">
                  {seg}
                </Link>
              </span>
            );
          })}
          <span className="flex items-center gap-1">
            <span>/</span>
            <span className="text-fg">sessions</span>
          </span>
        </nav>

        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-lg font-bold uppercase tracking-[0.1em]">
            {dirName} — Sessions
          </h2>
          <button
            onClick={startNewSession}
            className="bg-fg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-void transition-colors hover:bg-fg-2"
          >
            New Session
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-16 text-center text-sm text-fg-3">
            No sessions yet. Start a new session to begin.
          </div>
        ) : (
          <div className="space-y-0">
            {sessions.map((s) => {
              const age = Date.now() - s.lastModified;
              const timeAgo =
                age < 60_000
                  ? "now"
                  : age < 3_600_000
                    ? `${Math.floor(age / 60_000)}m`
                    : age < 86_400_000
                      ? `${Math.floor(age / 3_600_000)}h`
                      : `${Math.floor(age / 86_400_000)}d`;
              const summary =
                s.customTitle || s.summary || s.firstPrompt || "Untitled";
              const truncSummary =
                summary.length > 100 ? summary.slice(0, 100) + "..." : summary;

              return (
                <Link
                  key={s.sessionId}
                  href={`/workspaces/${relativePath}/sessions/${s.sessionId}`}
                  className="group block w-full border-b border-edge px-4 py-3 text-left transition-colors hover:bg-panel-2"
                >
                  <div className="text-[13px] leading-snug text-fg-2 group-hover:text-fg line-clamp-2">
                    {truncSummary}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] text-fg-3">
                    {s.gitBranch && (
                      <span className="border border-edge px-1.5 py-0.5 font-mono">
                        {s.gitBranch}
                      </span>
                    )}
                    <span className="font-mono">{s.sessionId.slice(0, 8)}</span>
                    <span className="ml-auto tabular-nums">{timeAgo}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
