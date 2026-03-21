"use client";

import { use } from "react";
import FileBrowser from "./file-browser";
import SessionsList from "./sessions-list";
import ChatView from "./chat-view";

function parsePath(segments: string[]): {
  mode: "browse" | "sessions" | "chat";
  dirSegments: string[];
  sessionId?: string;
} {
  const sessionsIdx = segments.indexOf("sessions");

  if (sessionsIdx === -1) {
    return { mode: "browse", dirSegments: segments };
  }

  if (sessionsIdx === segments.length - 1) {
    return { mode: "sessions", dirSegments: segments.slice(0, sessionsIdx) };
  }

  if (sessionsIdx === segments.length - 2) {
    return {
      mode: "chat",
      dirSegments: segments.slice(0, sessionsIdx),
      sessionId: segments[sessionsIdx + 1],
    };
  }

  return { mode: "browse", dirSegments: segments };
}

export default function CatchAllPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path: segments } = use(params);
  const { mode, dirSegments, sessionId } = parsePath(segments);
  const relativePath = dirSegments.join("/");

  if (mode === "chat" && sessionId) {
    return <ChatView relativePath={relativePath} sessionId={sessionId} />;
  }

  if (mode === "sessions") {
    return <SessionsList relativePath={relativePath} />;
  }

  return <FileBrowser relativePath={relativePath} />;
}
