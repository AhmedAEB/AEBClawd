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

  const selectSession = useCallback((s: SessionInfo) => {
    setSessionId(s.sessionId);
    setMessages([]);
    streamBufferRef.current = "";
    setPendingApprovals([]);
    setShowSessions(false);
    setStatusInfo({});
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
      // ── system events ──
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

      // ── stream_event (token-by-token deltas) ──
      if (data.type === "stream_event" && data.event) {
        const ev = data.event;
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          streamBufferRef.current += ev.delta.text;
          updateAssistantMessage(streamBufferRef.current);
        }
      }

      // ── assistant message (complete or partial snapshot) ──
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

      // ── user message (tool results) ──
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

      // ── rate_limit_event ──
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

      // ── result (final summary) ──
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

        addEvent("result", `Completed: ${parts.join(" | ")}`, {
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

  const eventStyles: Record<string, string> = {
    init: "border-blue-800/50 bg-blue-950/30 text-blue-300",
    retry: "border-amber-800/50 bg-amber-950/30 text-amber-300",
    rate_limit: "border-purple-800/50 bg-purple-950/30 text-purple-300",
    thinking: "border-violet-800/50 bg-violet-950/30 text-violet-300",
    tool_use: "border-cyan-800/50 bg-cyan-950/30 text-cyan-300",
    tool_result: "border-teal-800/50 bg-teal-950/30 text-teal-300",
    tool_output: "border-teal-800/50 bg-teal-950/30 text-teal-300",
    tool_error: "border-red-800/50 bg-red-950/30 text-red-300",
    result: "border-emerald-800/50 bg-emerald-950/30 text-emerald-300",
    error: "border-red-800/50 bg-red-950/30 text-red-300",
    stderr: "border-red-800/50 bg-red-950/30 text-red-300",
    raw: "border-zinc-700/50 bg-zinc-900/30 text-zinc-400",
    system: "border-zinc-700/50 bg-zinc-900/30 text-zinc-400",
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
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">AEBClawd</h1>
          <button
            onClick={toggleSessions}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
              showSessions
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            Sessions
          </button>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {statusInfo.model && (
            <span className="text-zinc-500">{statusInfo.model}</span>
          )}
          {statusInfo.permissionMode && (
            <span className="text-amber-500">{statusInfo.permissionMode}</span>
          )}
          {statusInfo.turns !== undefined && (
            <span className="text-zinc-500">
              {statusInfo.turns} turn{statusInfo.turns !== 1 ? "s" : ""}
            </span>
          )}
          {statusInfo.costUsd !== undefined && (
            <span className="text-emerald-500 font-mono">
              ${statusInfo.costUsd.toFixed(4)}
            </span>
          )}
          {sessionId && (
            <span className="text-zinc-600 font-mono">{sessionId.slice(0, 8)}</span>
          )}
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sessions Sidebar */}
        {showSessions && (
          <aside className="w-80 shrink-0 border-r border-zinc-800 bg-zinc-900/50 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <span className="text-sm font-medium text-zinc-300">Sessions</span>
              <button
                onClick={startNewSession}
                className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                + New
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessionsLoading ? (
                <div className="p-4 text-center text-xs text-zinc-500">Loading...</div>
              ) : sessionsList.length === 0 ? (
                <div className="p-4 text-center text-xs text-zinc-500">No sessions found</div>
              ) : (
                sessionsList.map((s) => {
                  const isActive = sessionId === s.sessionId;
                  const age = Date.now() - s.lastModified;
                  const timeAgo =
                    age < 60_000 ? "just now"
                    : age < 3_600_000 ? `${Math.floor(age / 60_000)}m ago`
                    : age < 86_400_000 ? `${Math.floor(age / 3_600_000)}h ago`
                    : `${Math.floor(age / 86_400_000)}d ago`;
                  const dirName = s.cwd?.split("/").pop() ?? "";
                  const summary = s.customTitle || s.summary || s.firstPrompt || "Untitled";
                  const truncSummary = summary.length > 80 ? summary.slice(0, 80) + "..." : summary;

                  return (
                    <button
                      key={s.sessionId}
                      onClick={() => selectSession(s)}
                      className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 transition-colors ${
                        isActive
                          ? "bg-blue-600/20 border-l-2 border-l-blue-500"
                          : "hover:bg-zinc-800/50"
                      }`}
                    >
                      <div className="text-xs text-zinc-200 leading-snug line-clamp-2">
                        {truncSummary}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500">
                        {dirName && (
                          <span className="bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
                            {dirName}
                          </span>
                        )}
                        {s.gitBranch && (
                          <span className="bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
                            {s.gitBranch}
                          </span>
                        )}
                        <span className="ml-auto">{timeAgo}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-3xl space-y-2">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center pt-32">
                <p className="text-zinc-600">Send a message to get started.</p>
              </div>
            )}
            {messages.map((msg, i) => {
              if (msg.role === "event") {
                const style =
                  eventStyles[msg.eventType ?? "system"] ?? eventStyles.system;
                const label =
                  eventLabels[msg.eventType ?? "system"] ?? "EVENT";
                return (
                  <div key={i} className="flex justify-start">
                    <div
                      className={`max-w-[95%] rounded-lg border px-3 py-1.5 font-mono text-xs leading-relaxed ${style}`}
                    >
                      <span className="inline-block min-w-[3rem] font-bold opacity-70 mr-2">
                        {label}
                      </span>
                      <span className="whitespace-pre-wrap break-all">{msg.content}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={i}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : msg.role === "system"
                        ? "bg-red-900/50 text-red-300 border border-red-800"
                        : "bg-zinc-800 text-zinc-200"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}
            {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-start">
                <div className="bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-400">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>
      </div>

      {/* Tool Approval Requests */}
      {pendingApprovals.length > 0 && (
        <div className="border-t border-amber-800/50 bg-amber-950/20 px-6 py-3">
          <div className="mx-auto max-w-3xl space-y-2">
            {pendingApprovals.map((approval) => {
              const inputStr = JSON.stringify(approval.input, null, 2);
              const truncInput = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
              return (
                <div
                  key={approval.toolUseId}
                  className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3"
                >
                  <div className="text-xs text-amber-300 font-medium mb-1">
                    {approval.title || `Claude wants to use: ${approval.toolName}`}
                  </div>
                  <pre className="text-xs text-amber-200/70 font-mono mb-2 whitespace-pre-wrap break-all">
                    {truncInput}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondToApproval(approval.toolUseId, true)}
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Allow
                    </button>
                    <button
                      onClick={() => respondToApproval(approval.toolUseId, false)}
                      className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
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
      <footer className="border-t border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? "Message Claude..." : "Connecting..."}
            disabled={!isConnected}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={abort}
              className="rounded-xl bg-red-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={sendPrompt}
              disabled={!input.trim() || !isConnected}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
