"use client";

import { useState, useRef, useEffect, useCallback } from "react";

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

type MessageRole = "user" | "assistant" | "system" | "event";

interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
  eventType?: string;
  meta?: Record<string, any>;
}

interface ToolApprovalRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  title?: string;
  decisionReason?: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ToolApprovalRequest[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<{
    model?: string;
    costUsd?: number;
    durationMs?: number;
    turns?: number;
    permissionMode?: string;
  }>({});
  const [showSessions, setShowSessions] = useState(false);
  const [sessionsList, setSessionsList] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const clientIdRef = useRef(crypto.randomUUID());
  const eventSourceRef = useRef<EventSource | null>(null);
  const streamBufferRef = useRef("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/sessions?limit=50`);
      const data: SessionInfo[] = await res.json();
      setSessionsList(data);
    } catch (err) {
      console.error("[sessions] Failed to fetch:", err);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const toggleSessions = useCallback(() => {
    setShowSessions((prev) => {
      if (!prev) fetchSessions();
      return !prev;
    });
  }, [fetchSessions]);

  const [historyLoading, setHistoryLoading] = useState(false);

  const selectSession = useCallback(async (s: SessionInfo) => {
    setSessionId(s.sessionId);
    setMessages([]);
    streamBufferRef.current = "";
    setPendingApprovals([]);
    setShowSessions(false);
    setStatusInfo({});
    setHistoryLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/sessions/${s.sessionId}/messages?limit=200`);
      const data: Array<{
        type: "user" | "assistant";
        message: {
          role?: string;
          content?: unknown;
        };
      }> = await res.json();

      const parsed: Message[] = [];
      for (const msg of data) {
        if (msg.type === "user") {
          const content = msg.message?.content;
          // User messages can be a string or array of content blocks
          if (typeof content === "string") {
            parsed.push({ role: "user", content, timestamp: 0 });
          } else if (Array.isArray(content)) {
            // Extract text from user prompt blocks
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
                  content: block.thinking.slice(0, 500) + (block.thinking.length > 500 ? "..." : ""),
                  timestamp: 0,
                  eventType: "thinking",
                });
              } else if (block.type === "text" && block.text) {
                parsed.push({ role: "assistant", content: block.text, timestamp: 0 });
              } else if (block.type === "tool_use") {
                const inputStr = typeof block.input === "string"
                  ? block.input
                  : JSON.stringify(block.input, null, 2);
                const truncInput = inputStr.slice(0, 300) + (inputStr.length > 300 ? "..." : "");
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
      setMessages([{
        role: "event",
        content: "Failed to load session history",
        timestamp: Date.now(),
        eventType: "error",
      }]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const startNewSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    streamBufferRef.current = "";
    setPendingApprovals([]);
    setShowSessions(false);
    setStatusInfo({});
  }, []);

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
            addEvent("thinking", t.thinking.slice(0, 500) + (t.thinking.length > 500 ? "..." : ""));
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
          const truncInput = inputStr.slice(0, 300) + (inputStr.length > 300 ? "..." : "");
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
            const truncated = content.slice(0, 500) + (content.length > 500 ? "..." : "");
            addEvent(
              isError ? "tool_error" : "tool_result",
              truncated,
              { tool_use_id: block.tool_use_id }
            );
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
      console.log("[sse] Connected");
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

  const sendPrompt = async () => {
    if (!input.trim() || !isConnected || isStreaming) return;

    const prompt = input.trim();
    setInput("");
    setIsStreaming(true);
    streamBufferRef.current = "";

    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt, timestamp: Date.now() },
    ]);

    await fetch(`${API_URL}/api/stream/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: clientIdRef.current,
        prompt,
        sessionId: sessionId ?? undefined,
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

  const eventAccents: Record<string, string> = {
    init: "border-l-info text-info/80",
    retry: "border-l-warn text-warn/80",
    rate_limit: "border-l-warn text-warn/80",
    thinking: "border-l-gold/60 text-gold/70",
    tool_use: "border-l-info/60 text-info/80",
    tool_result: "border-l-ok/60 text-ok/70",
    tool_output: "border-l-ok/60 text-ok/70",
    tool_error: "border-l-err text-err/80",
    result: "border-l-ok text-ok/80",
    error: "border-l-err text-err/80",
    stderr: "border-l-err text-err/80",
    raw: "border-l-fg-3/40 text-fg-3",
    system: "border-l-fg-3/40 text-fg-3",
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

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-void text-fg">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-0 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/[0.015] blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between border-b border-edge px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-[15px] font-bold tracking-[-0.02em]">
            AEBClawd
          </h1>
          <button
            onClick={toggleSessions}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase transition-all duration-200 ${
              showSessions
                ? "bg-gold/10 text-gold"
                : "text-fg-3 hover:text-fg-2"
            }`}
          >
            Sessions
          </button>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          {statusInfo.model && (
            <span className="text-fg-3">{statusInfo.model}</span>
          )}
          {statusInfo.permissionMode && (
            <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">
              {statusInfo.permissionMode}
            </span>
          )}
          {statusInfo.turns !== undefined && (
            <span className="text-fg-3">
              {statusInfo.turns} turn{statusInfo.turns !== 1 ? "s" : ""}
            </span>
          )}
          {statusInfo.costUsd !== undefined && (
            <span className="text-gold">
              ${statusInfo.costUsd.toFixed(4)}
            </span>
          )}
          {sessionId && (
            <span className="text-fg-3/40">{sessionId.slice(0, 8)}</span>
          )}
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? "bg-ok animate-pulse-dot" : "bg-err"
            }`}
          />
        </div>
      </header>

      {/* Content */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Sessions panel */}
        {showSessions && (
          <>
            <div
              className="absolute inset-0 z-10 bg-void/60 backdrop-blur-sm"
              onClick={() => setShowSessions(false)}
            />
            <aside className="absolute inset-y-0 left-0 z-20 flex w-80 animate-slide-in-left flex-col border-r border-edge bg-panel/95 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-3">
                  Sessions
                </span>
                <button
                  onClick={startNewSession}
                  className="rounded-md bg-gold/10 px-3 py-1 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/20"
                >
                  New
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold/20 border-t-gold" />
                  </div>
                ) : sessionsList.length === 0 ? (
                  <div className="px-5 py-16 text-center text-xs text-fg-3">
                    No sessions yet
                  </div>
                ) : (
                  sessionsList.map((s) => {
                    const isActive = sessionId === s.sessionId;
                    const age = Date.now() - s.lastModified;
                    const timeAgo =
                      age < 60_000
                        ? "now"
                        : age < 3_600_000
                          ? `${Math.floor(age / 60_000)}m`
                          : age < 86_400_000
                            ? `${Math.floor(age / 3_600_000)}h`
                            : `${Math.floor(age / 86_400_000)}d`;
                    const dirName = s.cwd?.split("/").pop() ?? "";
                    const summary =
                      s.customTitle || s.summary || s.firstPrompt || "Untitled";
                    const truncSummary =
                      summary.length > 70 ? summary.slice(0, 70) + "..." : summary;

                    return (
                      <button
                        key={s.sessionId}
                        onClick={() => selectSession(s)}
                        className={`group w-full text-left px-5 py-3 border-b border-edge/50 transition-all duration-150 ${
                          isActive
                            ? "bg-gold/5 border-l-2 border-l-gold"
                            : "hover:bg-panel-2"
                        }`}
                      >
                        <div className="text-[13px] leading-snug text-fg-2 group-hover:text-fg line-clamp-2">
                          {truncSummary}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-fg-3">
                          {dirName && (
                            <span className="rounded bg-panel-3/50 px-1.5 py-0.5 font-mono">
                              {dirName}
                            </span>
                          )}
                          {s.gitBranch && (
                            <span className="rounded bg-panel-3/50 px-1.5 py-0.5 font-mono">
                              {s.gitBranch}
                            </span>
                          )}
                          <span className="ml-auto tabular-nums">{timeAgo}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </>
        )}

        {/* Messages */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-3 px-6 py-6">
            {historyLoading && (
              <div className="flex items-center justify-center pt-[30vh]">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold/20 border-t-gold" />
                  <span className="text-sm text-fg-3">Loading session history...</span>
                </div>
              </div>
            )}

            {messages.length === 0 && !historyLoading && (
              <div className="flex flex-col items-center justify-center pt-[30vh]">
                <h2 className="animate-shimmer font-display text-2xl font-bold tracking-tight text-fg-3/50">
                  What would you like to build?
                </h2>
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
                      className={`border-l-2 ${accent} rounded-r-md bg-panel/40 py-1.5 pl-3 pr-3 font-mono text-[11px] leading-relaxed`}
                    >
                      <span className="mr-2 inline-block w-14 text-[10px] font-bold uppercase opacity-50">
                        {label}
                      </span>
                      <span className="whitespace-pre-wrap break-all opacity-70">
                        {msg.content}
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
                    className={`max-w-[80%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-gold font-medium text-void"
                        : msg.role === "system"
                          ? "border border-err/20 bg-err/10 text-err"
                          : "bg-panel text-fg-2"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}

            {isStreaming &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex animate-fade-in justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl bg-panel px-5 py-4">
                    <span
                      className="animate-bounce-dot h-1.5 w-1.5 rounded-full bg-gold"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="animate-bounce-dot h-1.5 w-1.5 rounded-full bg-gold"
                      style={{ animationDelay: "160ms" }}
                    />
                    <span
                      className="animate-bounce-dot h-1.5 w-1.5 rounded-full bg-gold"
                      style={{ animationDelay: "320ms" }}
                    />
                  </div>
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>
        </main>
      </div>

      {/* Tool approvals */}
      {pendingApprovals.length > 0 && (
        <div className="relative z-10 border-t border-warn/20 bg-panel/80 px-6 py-3 backdrop-blur-lg">
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
                  className="animate-fade-in rounded-xl border border-warn/20 bg-warn/5 p-4"
                >
                  <div className="mb-2 text-[13px] font-semibold text-warn">
                    {approval.title || `Approve: ${approval.toolName}`}
                  </div>
                  <pre className="mb-3 whitespace-pre-wrap break-all rounded-lg bg-void/40 p-2.5 font-mono text-[11px] text-fg-3">
                    {truncInput}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        respondToApproval(approval.toolUseId, true)
                      }
                      className="rounded-lg bg-ok/10 px-4 py-1.5 text-[12px] font-semibold text-ok transition-colors hover:bg-ok/20"
                    >
                      Allow
                    </button>
                    <button
                      onClick={() =>
                        respondToApproval(approval.toolUseId, false)
                      }
                      className="rounded-lg bg-err/10 px-4 py-1.5 text-[12px] font-semibold text-err transition-colors hover:bg-err/20"
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

      {/* Input */}
      <footer className="relative z-10 px-6 pb-6 pt-2">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2 rounded-2xl border border-edge bg-panel p-2 transition-all duration-200 focus-within:border-gold/30 focus-within:shadow-[0_0_30px_-10px_rgba(201,168,76,0.1)]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isConnected ? "Message Claude..." : "Connecting..."}
              disabled={!isConnected}
              rows={1}
              className="flex-1 resize-none bg-transparent px-3 py-2 text-[14px] text-fg outline-none placeholder:text-fg-3 disabled:opacity-40"
            />
            {isStreaming ? (
              <button
                onClick={abort}
                className="shrink-0 rounded-xl bg-err/10 px-4 py-2 text-[13px] font-semibold text-err transition-colors hover:bg-err/20"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={sendPrompt}
                disabled={!input.trim() || !isConnected}
                className="shrink-0 rounded-xl bg-gold px-4 py-2 text-[13px] font-semibold text-void transition-all hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-30"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
