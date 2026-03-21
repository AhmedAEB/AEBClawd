"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import SourceControlSidebar from "./source-control";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
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
  const clientIdRef = useRef(crypto.randomUUID());
  const eventSourceRef = useRef<EventSource | null>(null);
  const streamBufferRef = useRef("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const pathSegments = relativePath.split("/").filter(Boolean);
  const dirName = pathSegments[pathSegments.length - 1] ?? "root";

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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

  const sendPrompt = async (directPrompt?: string) => {
    const prompt = directPrompt?.trim() || input.trim();
    if (!prompt || !isConnected || isStreaming) return;

    if (!directPrompt) setInput("");
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
        workDir: relativePath,
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between border-b border-edge px-6 py-2">
        <nav className="flex items-center gap-1 text-[11px] font-mono text-fg-3">
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

        <div className="flex items-center gap-3 font-mono text-[11px]">
          {statusInfo.model && (
            <span className="text-fg-3">{statusInfo.model}</span>
          )}
          {statusInfo.permissionMode && (
            <span className="border border-edge px-1.5 py-0.5 text-fg-2">
              {statusInfo.permissionMode}
            </span>
          )}
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
                  className={`max-w-[80%] px-4 py-3 text-[14px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-fg font-medium text-void whitespace-pre-wrap"
                      : msg.role === "system"
                        ? "border-2 border-fg text-fg whitespace-pre-wrap"
                        : "border border-edge text-fg-2"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <Markdown content={msg.content} />
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

      {/* Input */}
      <footer className="px-6 pb-6 pt-2">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2 border-2 border-edge bg-void p-2 transition-all duration-200 focus-within:border-fg">
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
                className="shrink-0 border-2 border-fg px-4 py-2 text-[13px] font-semibold text-fg transition-colors hover:bg-panel-2"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => sendPrompt()}
                disabled={!input.trim() || !isConnected}
                className="shrink-0 bg-fg px-4 py-2 text-[13px] font-semibold text-void transition-all hover:bg-fg-2 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </footer>
      </div>

      {/* Source control sidebar — full overlay on mobile, inline panel on desktop */}
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
    </div>
  );
}
