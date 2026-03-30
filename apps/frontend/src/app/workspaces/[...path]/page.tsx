"use client";

import { use } from "react";
import FileBrowser from "./file-browser";
import SessionsList from "./sessions-list";
import ChatView from "./chat-view";
import EditorView from "./editor";

function parsePath(segments: string[]): {
  mode: "browse" | "sessions" | "chat" | "editor";
  dirSegments: string[];
  sessionId?: string;
  filePath?: string;
} {
  const editorIdx = segments.indexOf("editor");
  if (editorIdx !== -1 && editorIdx < segments.length - 1) {
    return {
      mode: "editor",
      dirSegments: segments.slice(0, editorIdx),
      filePath: segments.slice(0, editorIdx).join("/") + "/" + segments.slice(editorIdx + 1).join("/"),
    };
  }

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
  const { path: rawSegments } = use(params);
  const segments = rawSegments.map(decodeURIComponent);
  const { mode, dirSegments, sessionId, filePath } = parsePath(segments);
  const relativePath = dirSegments.join("/");

  if (mode === "editor" && filePath) {
    return <EditorView relativePath={relativePath} filePath={filePath} />;
  }

  if (mode === "chat" && sessionId) {
    return <ChatView relativePath={relativePath} sessionId={sessionId} />;
  }

  if (mode === "sessions") {
    return <SessionsList relativePath={relativePath} />;
  }

  return <FileBrowser relativePath={relativePath} />;
}
