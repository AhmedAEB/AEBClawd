"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

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

interface StreamEvent {
  type: "stream" | "error" | "done" | "stderr" | "raw" | "tool_approval_request";
  data?: any;
  code?: number;
  sessionId?: string;
  // tool_approval_request fields
  toolName?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
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
  const wsRef = useRef<WebSocket | null>(null);
  const streamBufferRef = useRef("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log("[ws] Connected to", WS_URL);
    };

    ws.onmessage = (event) => {
      const raw = event.data;
      console.log("[ws:recv]", typeof raw === "string" ? raw.slice(0, 300) : raw);

      let msg: StreamEvent;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        console.error("[ws:recv] JSON parse error:", e);
        return;
      }

      switch (msg.type) {
        case "stream": {
          const data = msg.data;

          // ── system events ──
          if (data.type === "system") {
            if (data.subtype === "init") {
              const toolCount = data.tools?.length ?? 0;
              const mcpServers: any[] = data.mcp_servers ?? [];
              const connectedMcp = mcpServers.filter((s) => s.status === "connected");
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

          // ── stream_event (token-by-token deltas from --include-partial-messages) ──
          if (data.type === "stream_event" && data.event) {
            const ev = data.event;
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              streamBufferRef.current += ev.delta.text;
              updateAssistantMessage(streamBufferRef.current);
            }
            // Don't display message_start, content_block_start/stop, message_stop etc.
          }

          // ── assistant message (complete or partial snapshot) ──
          if (data.type === "assistant" && data.message?.content) {
            const blocks: any[] = data.message.content;

            // Thinking blocks
            const thinkingBlocks = blocks.filter((b) => b.type === "thinking");
            for (const t of thinkingBlocks) {
              if (t.thinking) {
                addEvent("thinking", t.thinking.slice(0, 500) + (t.thinking.length > 500 ? "..." : ""));
              }
            }

            // Text blocks → update the assistant message
            const textBlocks = blocks
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("");
            if (textBlocks) {
              streamBufferRef.current = textBlocks;
              updateAssistantMessage(textBlocks);
            }

            // Tool use blocks
            const toolUses = blocks.filter((b) => b.type === "tool_use");
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

            // Also handle inline tool_use_result from the wrapper
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

            // Permission denials
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

          break;
        }
        case "tool_approval_request":
          setPendingApprovals((prev) => [
            ...prev,
            {
              toolName: msg.toolName!,
              input: msg.input!,
              toolUseId: msg.toolUseId!,
              title: msg.title,
              decisionReason: msg.decisionReason,
            },
          ]);
          break;
        case "error":
          console.error("[ws:recv] Error:", msg.data);
          addEvent("error", msg.data);
          setIsStreaming(false);
          break;
        case "done":
          console.log("[ws:recv] Done. code:", msg.code, "sessionId:", msg.sessionId);
          if (msg.sessionId) setSessionId(msg.sessionId);
          setIsStreaming(false);
          setPendingApprovals([]);
          streamBufferRef.current = "";
          break;
        case "raw":
          addEvent("raw", msg.data);
          break;
        case "stderr":
          addEvent("stderr", msg.data);
          break;
        default:
          console.warn("[ws:recv] Unknown:", msg.type, msg);
      }
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      setIsStreaming(false);
      console.log("[ws] Disconnected. code:", event.code, "reason:", event.reason);
      setTimeout(connect, 2000);
    };

    ws.onerror = (event) => {
      console.error("[ws] Error:", event);
      ws.close();
    };
  }, [updateAssistantMessage, addEvent]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendPrompt = () => {
    if (!input.trim() || !wsRef.current || isStreaming) return;

    const prompt = input.trim();
    setInput("");
    setIsStreaming(true);
    streamBufferRef.current = "";

    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt, timestamp: Date.now() },
    ]);

    const payload = {
      type: "prompt",
      prompt,
      sessionId: sessionId ?? undefined,
    };
    console.log("[ws:send]", JSON.stringify(payload).slice(0, 200));
    wsRef.current.send(JSON.stringify(payload));
  };

  const respondToApproval = (toolUseId: string, approved: boolean) => {
    wsRef.current?.send(
      JSON.stringify({ type: "tool_approval_response", toolUseId, approved })
    );
    setPendingApprovals((prev) => prev.filter((a) => a.toolUseId !== toolUseId));
  };

  const abort = () => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
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
        <h1 className="text-lg font-semibold tracking-tight">AEBClawd</h1>
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
