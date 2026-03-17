"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface StreamEvent {
  type: "stream" | "error" | "done" | "stderr" | "raw";
  data?: any;
  code?: number;
  sessionId?: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
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
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        return [...prev.slice(0, -1), { ...last, content: text }];
      }
      return [
        ...prev,
        { role: "assistant" as const, content: text, timestamp: Date.now() },
      ];
    });
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log("Connected to server");
    };

    ws.onmessage = (event) => {
      const msg: StreamEvent = JSON.parse(event.data);

      switch (msg.type) {
        case "stream": {
          const data = msg.data;

          // Handle assistant messages (including partial)
          if (data.type === "assistant" && data.message?.content) {
            const textBlocks = data.message.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("");
            if (textBlocks) {
              updateAssistantMessage(textBlocks);
            }
          }

          // Handle result message — final text + end streaming
          if (data.type === "result") {
            if (data.result) {
              updateAssistantMessage(data.result);
            }
            if (data.session_id) setSessionId(data.session_id);
            setIsStreaming(false);
            streamBufferRef.current = "";
          }
          break;
        }
        case "error":
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Error: ${msg.data}`,
              timestamp: Date.now(),
            },
          ]);
          setIsStreaming(false);
          break;
        case "done":
          if (msg.sessionId) setSessionId(msg.sessionId);
          setIsStreaming(false);
          streamBufferRef.current = "";
          break;
        case "stderr":
          console.warn("stderr:", msg.data);
          break;
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsStreaming(false);
      console.log("Disconnected");
      // Auto-reconnect after 2s
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

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

    wsRef.current.send(
      JSON.stringify({
        type: "prompt",
        prompt,
        sessionId: sessionId ?? undefined,
      })
    );
  };

  const abort = () => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">AEBClawd</h1>
        <div className="flex items-center gap-3">
          {sessionId && (
            <span className="text-xs text-zinc-500 font-mono">
              {sessionId.slice(0, 8)}
            </span>
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
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center pt-32">
              <p className="text-zinc-600">Send a message to get started.</p>
            </div>
          )}
          {messages.map((msg, i) => (
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
          ))}
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
