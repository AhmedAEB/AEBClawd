"use client";

import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { VoiceProvider, VoiceButton, VoicePanel, useVoiceContext } from "@/components/voice-mode";
import { CallProvider, CallButton, CallPanel, useCallContext } from "@/components/call-mode";
import SourceControlSidebar from "./source-control";

const TerminalPanel = lazy(() => import("@/components/terminal"));
const FileBrowserSidebar = lazy(() => import("./file-browser-sidebar"));

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** Renders VoiceButton and CallButton with mutual exclusion — only one mode active at a time. */
function MutualExclusiveButtons({ isConnected, isStreaming }: { isConnected: boolean; isStreaming: boolean }) {
  const voice = useVoiceContext();
  const call = useCallContext();
  const voiceActive = voice?.isInCall ?? false;
  const callActive = call?.isInCall ?? false;

  return (
    <>
      <VoiceButton isConnected={isConnected} isStreaming={isStreaming} otherModeActive={callActive} />
      <CallButton isConnected={isConnected} isStreaming={isStreaming} otherModeActive={voiceActive} />
    </>
  );
}

const PERMISSION_MODES = [
  { value: "default", displayName: "Default", description: "Prompts for dangerous operations" },
  { value: "acceptEdits", displayName: "Accept Edits", description: "Auto-accept file edits" },
  { value: "bypassPermissions", displayName: "Bypass", description: "Bypass all permission checks" },
  { value: "plan", displayName: "Plan", description: "Planning mode, no tool execution" },
  { value: "dontAsk", displayName: "Don't Ask", description: "Deny if not pre-approved" },
] as const;

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

const FILE_PATH_TOKEN = /(?:\.?\/)?(?:[\w@.+-]+\/)+[\w@.+-]+\.\w{1,10}(?::\d+)?/g;

function LinkifiedText({ text, onFileClick }: { text: string; onFileClick: (p: string) => void }) {
  const parts: (string | { path: string; match: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(FILE_PATH_TOKEN)) {
    if (m.index! > last) parts.push(text.slice(last, m.index!));
    parts.push({ path: m[0].replace(/:\d+$/, ""), match: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length <= 1 && typeof parts[0] === "string") return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <button key={i} onClick={() => onFileClick(p.path)}
            className="underline decoration-dotted underline-offset-2 hover:decoration-solid cursor-pointer">
            {p.match}
          </button>
        )
      )}
    </>
  );
}

type MessageRole = "user" | "assistant" | "system" | "event";

interface ImageAttachment {
  data: string; // base64 (no prefix)
  mediaType: string;
  name: string;
  preview: string; // data URL for display
}

interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
  eventType?: string;
  meta?: Record<string, any>;
  images?: ImageAttachment[];
}

interface ToolApprovalRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  title?: string;
  decisionReason?: string;
}

const eventAccents: Record<string, string> = {
  init: "border-l-fg text-fg-2",
  retry: "border-l-fg text-fg-2",
  rate_limit: "border-l-fg text-fg-2",
  thinking: "border-l-fg-3 text-fg-3",
  tool_use: "border-l-fg text-fg-2",
  tool_result: "border-l-fg-3 text-fg-3",
  tool_output: "border-l-fg-3 text-fg-3",
  tool_error: "border-l-fg text-fg",
  result: "border-l-fg text-fg-2",
  error: "border-l-fg text-fg",
  stderr: "border-l-fg text-fg",
  raw: "border-l-fg-3 text-fg-3",
  system: "border-l-fg-3 text-fg-3",
};

const eventLabels: Record<string, string> = {
  init: "INIT",
  retry: "RETRY",
  rate_limit: "RATE",
  thinking: "THINK",
  tool_use: "TOOL",
  tool_result: "RESULT",
  tool_output: "OUTPUT",
  tool_error: "ERROR",
  result: "DONE",
  error: "ERROR",
  stderr: "STDERR",
  raw: "RAW",
  system: "SYS",
};

export default function ChatView({
  relativePath,
  sessionId: initialSessionId,
}: {
  relativePath: string;
  sessionId: string;
}) {
  const isNewSession = initialSessionId === "new";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ToolApprovalRequest[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(
    isNewSession ? null : initialSessionId
  );
  const [statusInfo, setStatusInfo] = useState<{
    model?: string;
    costUsd?: number;
    durationMs?: number;
    turns?: number;
    permissionMode?: string;
  }>({});
  const [historyLoading, setHistoryLoading] = useState(!isNewSession);
  const [scOpen, setScOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbFile, setFbFile] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<
    { value: string; displayName: string; description: string }[]
  >([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedPermissionMode, setSelectedPermissionMode] = useState("default");
  const [permMenuOpen, setPermMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const permMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientIdRef = useRef(typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const eventSourceRef = useRef<EventSource | null>(null);
  const streamBufferRef = useRef("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/models`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAvailableModels(data);
          if (!selectedModel) setSelectedModel(data[0].value);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
      if (permMenuRef.current && !permMenuRef.current.contains(e.target as Node)) {
        setPermMenuOpen(false);
      }
    };
    if (modelMenuOpen || permMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelMenuOpen, permMenuOpen]);

  const pathSegments = relativePath.split("/").filter(Boolean);
  const dirName = pathSegments[pathSegments.length - 1] ?? "root";

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

  const processFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!ACCEPTED_TYPES.includes(file.type)) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setAttachedImages((prev) => [
          ...prev,
          { data: base64, mediaType: file.type, name: file.name, preview: dataUrl },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) processFiles(imageFiles);
    },
    [processFiles]
  );

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes("Files")) setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) setIsDragging(false);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (e.dataTransfer?.files) processFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [processFiles]);

  // Update the URL to the real session path once we have an ID (without re-mounting)
  useEffect(() => {
    if (isNewSession && sessionId) {
      window.history.replaceState(
        null,
        "",
        `/workspaces/${encodePath(relativePath)}/sessions/${sessionId}`
      );
    }
  }, [isNewSession, sessionId, relativePath]);

  // Load session history
  useEffect(() => {
    if (isNewSession) return;

    const loadHistory = async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/sessions/${initialSessionId}/messages?limit=200`
        );
        const data: Array<{
          type: "user" | "assistant";
          message: { role?: string; content?: unknown };
        }> = await res.json();

        const parsed: Message[] = [];
        for (const msg of data) {
          if (msg.type === "user") {
            const content = msg.message?.content;
            if (typeof content === "string") {
              parsed.push({ role: "user", content, timestamp: 0 });
            } else if (Array.isArray(content)) {
              const textParts: string[] = [];
              for (const block of content) {
                if (block.type === "text") {
                  textParts.push(block.text);
                } else if (block.type === "tool_result") {
                  const resultContent =
                    typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content);
                  const truncated =
                    resultContent.length > 500
                      ? resultContent.slice(0, 500) + "..."
                      : resultContent;
                  parsed.push({
                    role: "event",
                    content: truncated,
                    timestamp: 0,
                    eventType: block.is_error ? "tool_error" : "tool_result",
                  });
                }
              }
              if (textParts.length > 0) {
                parsed.push({ role: "user", content: textParts.join(""), timestamp: 0 });
              }
            }
          } else if (msg.type === "assistant") {
            const blocks = msg.message?.content;
            if (Array.isArray(blocks)) {
              for (const block of blocks as any[]) {
                if (block.type === "thinking" && block.thinking) {
                  parsed.push({
                    role: "event",
                    content:
                      block.thinking.slice(0, 500) +
                      (block.thinking.length > 500 ? "..." : ""),
                    timestamp: 0,
                    eventType: "thinking",
                  });
                } else if (block.type === "text" && block.text) {
                  parsed.push({ role: "assistant", content: block.text, timestamp: 0 });
                } else if (block.type === "tool_use") {
                  const inputStr =
                    typeof block.input === "string"
                      ? block.input
                      : JSON.stringify(block.input, null, 2);
                  const truncInput =
                    inputStr.slice(0, 300) + (inputStr.length > 300 ? "..." : "");
                  parsed.push({
                    role: "event",
                    content: `${block.name}\n${truncInput}`,
                    timestamp: 0,
                    eventType: "tool_use",
                  });
                }
              }
            }
          }
        }

        setMessages(parsed);
      } catch (err) {
        console.error("[sessions] Failed to load history:", err);
        setMessages([
          {
            role: "event",
            content: "Failed to load session history",
            timestamp: Date.now(),
            eventType: "error",
          },
        ]);
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
  }, [initialSessionId, isNewSession]);

  const updateAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const lastAssistantIdx = prev.findLastIndex((m) => m.role === "assistant");
      const lastUserIdx = prev.findLastIndex((m) => m.role === "user");
      if (lastAssistantIdx > lastUserIdx) {
        const updated = [...prev];
        updated[lastAssistantIdx] = { ...updated[lastAssistantIdx], content: text };
        return updated;
      }
      return [
        ...prev,
        { role: "assistant" as const, content: text, timestamp: Date.now() },
      ];
    });
  }, []);

  const addEvent = useCallback(
    (eventType: string, content: string, meta?: Record<string, any>) => {
      setMessages((prev) => [
        ...prev,
        { role: "event" as const, content, timestamp: Date.now(), eventType, meta },
      ]);
    },
    []
  );

  const handleStreamData = useCallback(
    (data: any) => {
      if (data.type === "system") {
        if (data.subtype === "init") {
          const toolCount = data.tools?.length ?? 0;
          const mcpServers: any[] = data.mcp_servers ?? [];
          const connectedMcp = mcpServers.filter((s: any) => s.status === "connected");
          if (data.session_id) setSessionId(data.session_id);
          setStatusInfo((prev) => ({
            ...prev,
            model: data.model,
            permissionMode: data.permissionMode,
          }));
          addEvent(
            "init",
            `Session started — ${data.model} | ${toolCount} tools | ${connectedMcp.length}/${mcpServers.length} MCP servers | mode: ${data.permissionMode}`,
            { sessionId: data.session_id, cwd: data.cwd, tools: data.tools }
          );
        } else if (data.subtype === "api_retry") {
          addEvent(
            "retry",
            `API retry #${data.attempt}/${data.max_retries} — ${data.error} (${data.error_status}) — retrying in ${Math.round(data.retry_delay_ms)}ms`
          );
        } else {
          addEvent("system", `System: ${data.subtype ?? JSON.stringify(data)}`);
        }
      }

      if (data.type === "stream_event" && data.event) {
        const ev = data.event;
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          streamBufferRef.current += ev.delta.text;
          updateAssistantMessage(streamBufferRef.current);
        }
      }

      if (data.type === "assistant" && data.message?.content) {
        const blocks: any[] = data.message.content;

        const thinkingBlocks = blocks.filter((b: any) => b.type === "thinking");
        for (const t of thinkingBlocks) {
          if (t.thinking) {
            addEvent(
              "thinking",
              t.thinking.slice(0, 500) + (t.thinking.length > 500 ? "..." : "")
            );
          }
        }

        const textBlocks = blocks
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        if (textBlocks) {
          streamBufferRef.current = textBlocks;
          updateAssistantMessage(textBlocks);
        }

        const toolUses = blocks.filter((b: any) => b.type === "tool_use");
        for (const tool of toolUses) {
          const inputStr =
            typeof tool.input === "string"
              ? tool.input
              : JSON.stringify(tool.input, null, 2);
          const truncInput =
            inputStr.slice(0, 300) + (inputStr.length > 300 ? "..." : "");
          addEvent("tool_use", `${tool.name}\n${truncInput}`, {
            tool_use_id: tool.id,
            input: tool.input,
          });
        }
      }

      if (data.type === "user" && data.message?.content) {
        const blocks: any[] = Array.isArray(data.message.content)
          ? data.message.content
          : [data.message.content];

        for (const block of blocks) {
          if (block.type === "tool_result") {
            const isError = block.is_error ?? false;
            const content =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            const truncated =
              content.slice(0, 500) + (content.length > 500 ? "..." : "");
            addEvent(isError ? "tool_error" : "tool_result", truncated, {
              tool_use_id: block.tool_use_id,
            });
          } else if (block.type === "tool_reference") {
            addEvent("tool_result", `Loaded tool: ${block.tool_name}`);
          }
        }

        if (data.tool_use_result) {
          const r = data.tool_use_result;
          if (typeof r === "string") {
            addEvent("tool_error", r);
          } else if (r.stdout !== undefined) {
            const parts: string[] = [];
            if (r.stdout) parts.push(r.stdout.slice(0, 500));
            if (r.stderr) parts.push(`stderr: ${r.stderr.slice(0, 200)}`);
            if (r.interrupted) parts.push("[interrupted]");
            if (parts.length > 0) {
              addEvent("tool_output", parts.join("\n"));
            } else {
              addEvent("tool_output", "(no output)");
            }
          } else if (r.matches) {
            addEvent("tool_result", `Matched: ${r.matches.join(", ")}`);
          }
        }
      }

      if (data.type === "rate_limit_event") {
        const info = data.rate_limit_info;
        if (info) {
          const resetsAt = info.resetsAt
            ? new Date(info.resetsAt * 1000).toLocaleTimeString()
            : "unknown";
          addEvent(
            "rate_limit",
            `Rate limit: ${info.status} | resets ${resetsAt} | ${info.rateLimitType}${info.isUsingOverage ? " (overage)" : ""}`
          );
        }
      }

      if (data.type === "result") {
        if (data.session_id) setSessionId(data.session_id);
        setStatusInfo((prev) => ({
          ...prev,
          costUsd: data.total_cost_usd,
          durationMs: data.duration_ms,
          turns: data.num_turns,
        }));

        const parts = [
          `${(data.duration_ms / 1000).toFixed(1)}s`,
          `${data.num_turns} turn${data.num_turns !== 1 ? "s" : ""}`,
          `$${data.total_cost_usd?.toFixed(4) ?? "?"}`,
          data.stop_reason,
        ];

        if (data.permission_denials?.length > 0) {
          parts.push(`${data.permission_denials.length} permission denied`);
        }

        addEvent("result", `Completed: ${parts.join(" · ")}`, {
          usage: data.usage,
          modelUsage: data.modelUsage,
          permissionDenials: data.permission_denials,
        });
        setIsStreaming(false);
        streamBufferRef.current = "";
      }
    },
    [addEvent, updateAssistantMessage]
  );

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(
      `${API_URL}/api/stream?clientId=${clientIdRef.current}`
    );
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.addEventListener("stream", (e) => {
      const data = JSON.parse(e.data);
      handleStreamData(data);
    });

    es.addEventListener("tool_approval", (e) => {
      const data = JSON.parse(e.data);
      setPendingApprovals((prev) => [...prev, data]);
    });

    es.addEventListener("done", (e) => {
      const data = JSON.parse(e.data);
      if (data.sessionId) setSessionId(data.sessionId);
      setIsStreaming(false);
      setPendingApprovals([]);
      streamBufferRef.current = "";
    });

    es.addEventListener("server_error", (e) => {
      const data = JSON.parse(e.data);
      addEvent("error", data.message);
      setIsStreaming(false);
    });

    es.onerror = () => {
      setIsConnected(false);
      if (es.readyState === EventSource.CLOSED) {
        setIsStreaming(false);
      }
    };
  }, [handleStreamData, addEvent]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  const handleFileClick = useCallback((filePath: string) => {
    // Resolve relative path: prepend workspace relativePath if not already prefixed
    const resolved = filePath.startsWith(relativePath + "/")
      ? filePath
      : `${relativePath}/${filePath.replace(/^\.\//, "")}`;
    setFbFile(resolved);
    setFbOpen(true);
  }, [relativePath]);

  const sendPrompt = async (directPrompt?: string) => {
    const prompt = directPrompt?.trim() || input.trim();
    const images = directPrompt ? [] : attachedImages;
    if ((!prompt && images.length === 0) || !isConnected || isStreaming) return;

    const effectivePrompt = prompt || "What is in this image?";
    if (!directPrompt) {
      setInput("");
      setAttachedImages([]);
    }
    setIsStreaming(true);
    streamBufferRef.current = "";

    setMessages((prev) => [
      ...prev,
      { role: "user", content: effectivePrompt, timestamp: Date.now(), images: images.length > 0 ? images : undefined },
    ]);

    await fetch(`${API_URL}/api/stream/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: clientIdRef.current,
        prompt: effectivePrompt,
        sessionId: sessionId ?? undefined,
        workDir: relativePath,
        model: selectedModel,
        permissionMode: selectedPermissionMode,
        ...(images.length > 0 && {
          images: images.map((img) => ({ data: img.data, mediaType: img.mediaType })),
        }),
      }),
    });
  };

  const respondToApproval = async (toolUseId: string, approved: boolean) => {
    await fetch(`${API_URL}/api/stream/tool-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: clientIdRef.current,
        toolUseId,
        approved,
      }),
    });
    setPendingApprovals((prev) => prev.filter((a) => a.toolUseId !== toolUseId));
  };

  const abort = async () => {
    await fetch(`${API_URL}/api/stream/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientIdRef.current }),
    });
    setIsStreaming(false);
    setPendingApprovals([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  };

  const handleVoiceMessage = useCallback(
    (text: string, role: "user" | "assistant") => {
      setMessages((prev) => [...prev, { role, content: text, timestamp: Date.now() }]);
    },
    [],
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Fullscreen drop overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-4 border-dashed border-fg bg-void/80">
          <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mx-auto mb-3 h-10 w-10 text-fg">
              <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909-4.97-4.969a.75.75 0 0 0-1.06 0L2.5 11.06ZM12.75 7a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z" clipRule="evenodd" />
            </svg>
            <p className="font-display text-lg font-bold uppercase tracking-widest text-fg">Drop image</p>
          </div>
        </div>
      )}
      {/* Sub-header */}
      <div className="flex flex-wrap items-center justify-between gap-y-1 border-b border-edge px-3 py-2 sm:px-6">
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-[11px] font-mono text-fg-3">
          <Link href="/workspaces" className="hover:text-fg transition-colors" aria-label="Home">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" /></svg>
          </Link>
          {pathSegments.map((seg, i) => {
            const href = `/workspaces/${pathSegments.slice(0, i + 1).map(encodeURIComponent).join("/")}`;
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
            <Link
              href={`/workspaces/${encodePath(relativePath)}/sessions`}
              className="hover:text-fg transition-colors"
            >
              sessions
            </Link>
          </span>
          {sessionId && (
            <span className="flex items-center gap-1">
              <span>/</span>
              <span className="text-fg">{sessionId.slice(0, 8)}</span>
            </span>
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] sm:gap-3">
          <div className="relative" ref={modelMenuRef}>
            <button
              onClick={() => setModelMenuOpen((v) => !v)}
              className={`flex max-w-[140px] items-center gap-1.5 border-2 border-edge px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider transition-colors sm:max-w-none ${
                modelMenuOpen ? "bg-fg text-void" : "text-fg hover:bg-panel-2"
              }`}
              disabled={isStreaming || availableModels.length === 0}
            >
              <span className="truncate">{availableModels.find((m) => m.value === selectedModel)?.displayName ?? (selectedModel || "...")}</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
            {modelMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 border-2 border-edge bg-void">
                {availableModels.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => {
                      setSelectedModel(m.value);
                      setModelMenuOpen(false);
                    }}
                    className={`group block w-full whitespace-nowrap px-4 py-2 text-left transition-colors ${
                      selectedModel === m.value
                        ? "bg-fg text-void"
                        : "text-fg hover:bg-panel-2"
                    }`}
                  >
                    <span className="block text-[11px] font-bold uppercase tracking-wider">
                      {m.displayName}
                    </span>
                    <span className={`block text-[10px] font-normal normal-case tracking-normal ${
                      selectedModel === m.value ? "opacity-60" : "text-fg-3"
                    }`}>
                      {m.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative" ref={permMenuRef}>
            <button
              onClick={() => setPermMenuOpen((v) => !v)}
              className={`flex max-w-[120px] items-center gap-1.5 border-2 border-edge px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider transition-colors sm:max-w-none ${
                permMenuOpen ? "bg-fg text-void" : "text-fg hover:bg-panel-2"
              }`}
              disabled={isStreaming}
            >
              <span className="truncate">{PERMISSION_MODES.find((m) => m.value === selectedPermissionMode)?.displayName ?? "Default"}</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
            {permMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 border-2 border-edge bg-void">
                {PERMISSION_MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => {
                      setSelectedPermissionMode(m.value);
                      setPermMenuOpen(false);
                    }}
                    className={`group block w-full whitespace-nowrap px-4 py-2 text-left transition-colors ${
                      selectedPermissionMode === m.value
                        ? "bg-fg text-void"
                        : "text-fg hover:bg-panel-2"
                    }`}
                  >
                    <span className="block text-[11px] font-bold uppercase tracking-wider">
                      {m.displayName}
                    </span>
                    <span className={`block text-[10px] font-normal normal-case tracking-normal ${
                      selectedPermissionMode === m.value ? "opacity-60" : "text-fg-3"
                    }`}>
                      {m.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {statusInfo.turns !== undefined && (
            <span className="text-fg-3">
              {statusInfo.turns} turn{statusInfo.turns !== 1 ? "s" : ""}
            </span>
          )}
          {statusInfo.costUsd !== undefined && (
            <span className="font-semibold text-fg">
              ${statusInfo.costUsd.toFixed(4)}
            </span>
          )}
          <span
            className={`h-2 w-2 ${
              isConnected ? "bg-fg animate-pulse-dot" : "border border-fg"
            }`}
          />
          <button
            onClick={() => setTermOpen((v) => !v)}
            className={`ml-1 p-1 transition-colors ${termOpen ? "bg-fg text-void" : "text-fg-3 hover:text-fg"}`}
            aria-label="Toggle terminal"
            title="Terminal"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h7.5A2.25 2.25 0 0 1 14 4.25v7.5A2.25 2.25 0 0 1 11.75 14h-7.5A2.25 2.25 0 0 1 2 11.75v-7.5ZM4.75 6a.75.75 0 0 1 .53-.22.75.75 0 0 1 .53.22L7.5 7.69 5.81 9.38a.75.75 0 1 1-1.06-1.06l.94-.94-.94-.94A.75.75 0 0 1 4.75 6ZM8.25 9.5a.75.75 0 0 0 0 1.5h2a.75.75 0 0 0 0-1.5h-2Z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={() => setFbOpen((v) => !v)}
            className={`ml-1 p-1 transition-colors ${fbOpen ? "bg-fg text-void" : "text-fg-3 hover:text-fg"}`}
            aria-label="Toggle file browser"
            title="Files"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 12.5 4H9.621a1.5 1.5 0 0 1-1.06-.44L7.439 2.44A1.5 1.5 0 0 0 6.379 2H3.5Z" />
            </svg>
          </button>
          <button
            onClick={() => setScOpen((v) => !v)}
            className={`ml-1 p-1 transition-colors ${scOpen ? "bg-fg text-void" : "text-fg-3 hover:text-fg"}`}
            aria-label="Toggle source control"
            title="Source Control"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
      {/* Chat column */}
      <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-3 px-6 py-6">
          {historyLoading && (
            <div className="flex items-center justify-center pt-[30vh]">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
                <span className="text-sm text-fg-3">Loading...</span>
              </div>
            </div>
          )}

          {messages.length === 0 && !historyLoading && (
            <div className="flex flex-col items-center justify-center pt-[30vh]">
              <h2 className="animate-shimmer font-display text-2xl font-bold uppercase tracking-[0.1em] text-fg-3">
                What would you like to build?
              </h2>
              <p className="mt-2 text-xs text-fg-3 font-mono">{dirName}</p>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === "event") {
              const accent =
                eventAccents[msg.eventType ?? "system"] ?? eventAccents.system;
              const label =
                eventLabels[msg.eventType ?? "system"] ?? "EVENT";
              return (
                <div key={i} className="animate-fade-in">
                  <div
                    className={`border-l-2 ${accent} bg-panel-2 py-1.5 pl-3 pr-3 font-mono text-[11px] leading-relaxed`}
                  >
                    <span className="mr-2 inline-block w-14 text-[10px] font-bold uppercase opacity-50">
                      {label}
                    </span>
                    <span className="whitespace-pre-wrap break-all opacity-70">
                      <LinkifiedText text={msg.content} onFileClick={handleFileClick} />
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={i}
                className={`flex animate-fade-in ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] px-4 py-3 text-[14px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-fg font-medium text-void whitespace-pre-wrap"
                      : msg.role === "system"
                        ? "border-2 border-fg text-fg whitespace-pre-wrap"
                        : "border border-edge text-fg-2"
                  }`}
                >
                  {msg.role === "user" && msg.images && msg.images.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {msg.images.map((img, j) => (
                        <img
                          key={j}
                          src={img.preview}
                          alt={img.name}
                          className="max-h-40 max-w-[200px] border border-void/20 object-contain"
                        />
                      ))}
                    </div>
                  )}
                  {msg.role === "assistant" ? (
                    <Markdown content={msg.content} onFileClick={handleFileClick} />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            );
          })}

          {isStreaming &&
            messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex animate-fade-in justify-start">
                <div className="flex items-center gap-1.5 border border-edge px-5 py-4">
                  <span
                    className="animate-bounce-dot h-1.5 w-1.5 bg-fg"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="animate-bounce-dot h-1.5 w-1.5 bg-fg"
                    style={{ animationDelay: "160ms" }}
                  />
                  <span
                    className="animate-bounce-dot h-1.5 w-1.5 bg-fg"
                    style={{ animationDelay: "320ms" }}
                  />
                </div>
              </div>
            )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Tool approvals */}
      {pendingApprovals.length > 0 && (
        <div className="border-t-2 border-edge bg-void px-6 py-3">
          <div className="mx-auto max-w-2xl space-y-2">
            {pendingApprovals.map((approval) => {
              const inputStr = JSON.stringify(approval.input, null, 2);
              const truncInput =
                inputStr.length > 200
                  ? inputStr.slice(0, 200) + "..."
                  : inputStr;
              return (
                <div
                  key={approval.toolUseId}
                  className="animate-fade-in border-2 border-fg p-4"
                >
                  <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-fg">
                    {approval.title || `Approve: ${approval.toolName}`}
                  </div>
                  <pre className="mb-3 whitespace-pre-wrap break-all border border-edge bg-panel-2 p-2.5 font-mono text-[11px] text-fg-2">
                    {truncInput}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        respondToApproval(approval.toolUseId, true)
                      }
                      className="bg-fg px-4 py-1.5 text-[12px] font-semibold text-void transition-colors hover:bg-fg-2"
                    >
                      Allow
                    </button>
                    <button
                      onClick={() =>
                        respondToApproval(approval.toolUseId, false)
                      }
                      className="border-2 border-fg px-4 py-1.5 text-[12px] font-semibold text-fg transition-colors hover:bg-panel-2"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Voice + Call + Input */}
      <VoiceProvider
        clientId={clientIdRef.current}
        sessionId={sessionId ?? null}
        relativePath={relativePath}
        selectedModel={selectedModel}
        onVoiceMessage={handleVoiceMessage}
      >
      <CallProvider
        clientId={clientIdRef.current}
        sessionId={sessionId ?? null}
        relativePath={relativePath}
        selectedModel={selectedModel}
        onCallMessage={handleVoiceMessage}
      >
      <VoicePanel />
      <CallPanel />
      <footer className="px-6 pb-6 pt-2">
        <div className="mx-auto max-w-2xl">
          <div
            className="border-2 border-edge bg-void p-2 transition-all duration-200 focus-within:border-fg"
          >
            {attachedImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1">
                {attachedImages.map((img, i) => (
                  <div key={i} className="group relative">
                    <img
                      src={img.preview}
                      alt={img.name}
                      className="h-16 w-16 border border-edge object-cover"
                    />
                    <button
                      onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center bg-fg text-[10px] leading-none text-void opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Remove image"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) processFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!isConnected || isStreaming}
                className="shrink-0 p-2 text-fg-3 transition-colors hover:text-fg disabled:opacity-30"
                aria-label="Attach image"
                title="Attach image"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909-4.97-4.969a.75.75 0 0 0-1.06 0L2.5 11.06ZM12.75 7a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z" clipRule="evenodd" />
                </svg>
              </button>
              <MutualExclusiveButtons isConnected={isConnected} isStreaming={isStreaming} />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isConnected ? "Message Claude..." : "Connecting..."}
                disabled={!isConnected}
                rows={1}
                className="flex-1 resize-none bg-transparent px-3 py-2 text-[14px] text-fg outline-none placeholder:text-fg-3 disabled:opacity-40"
              />
              {isStreaming ? (
                <button
                  onClick={abort}
                  className="shrink-0 border-2 border-fg px-4 py-2 text-[13px] font-semibold text-fg transition-colors hover:bg-panel-2"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => sendPrompt()}
                  disabled={(!input.trim() && attachedImages.length === 0) || !isConnected}
                  className="shrink-0 bg-fg px-4 py-2 text-[13px] font-semibold text-void transition-all hover:bg-fg-2 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>
      </CallProvider>
      </VoiceProvider>
      </div>

      {/* Source control sidebar �� full overlay on mobile, inline panel on desktop */}
      {fbOpen && (
        <div className="fixed inset-0 z-40 bg-void md:static md:inset-auto md:z-auto md:w-[480px] md:shrink-0 md:border-l-2 md:border-edge">
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
            </div>
          }>
            <FileBrowserSidebar
              relativePath={relativePath}
              onClose={() => setFbOpen(false)}
              openFile={fbFile}
            />
          </Suspense>
        </div>
      )}

      {scOpen && (
        <div className="fixed inset-0 z-40 bg-void md:static md:inset-auto md:z-auto md:w-[360px] md:shrink-0 md:border-l-2 md:border-edge">
          <SourceControlSidebar
            relativePath={relativePath}
            onClose={() => setScOpen(false)}
            onGenerateMessage={() =>
              sendPrompt(
                "Create a git commit for the currently staged changes, do not stage anything other than what is staged. Write a good conventional commit message yourself and commit it directly. Do not ask me for the message, just do it."
              )
            }
            canGenerate={isConnected && !isStreaming}
          />
        </div>
      )}
      </div>

      {/* Terminal panel — outside the flex row so it spans full width at the bottom */}
      {termOpen && (
        <Suspense fallback={
          <div className="flex items-center justify-center border-t-2 border-edge py-8">
            <div className="h-4 w-4 animate-spin border-2 border-panel-3 border-t-fg" />
          </div>
        }>
          <TerminalPanel
            relativePath={relativePath}
            onClose={() => setTermOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
