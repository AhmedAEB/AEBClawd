"use client";

import { useRef, useEffect, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getWsUrl(): string {
  if (API_URL) {
    const url = new URL(API_URL);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}`;
  }
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

interface TerminalProps {
  relativePath: string;
  onClose: () => void;
}

export default function TerminalPanel({ relativePath, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: "#ffffff",
        foreground: "#000000",
        cursor: "#000000",
        cursorAccent: "#ffffff",
        selectionBackground: "#00000033",
        black: "#000000",
        white: "#ffffff",
        brightBlack: "#666666",
        brightWhite: "#ffffff",
        red: "#000000",
        green: "#000000",
        yellow: "#000000",
        blue: "#000000",
        magenta: "#000000",
        cyan: "#000000",
        brightRed: "#333333",
        brightGreen: "#333333",
        brightYellow: "#333333",
        brightBlue: "#333333",
        brightMagenta: "#333333",
        brightCyan: "#333333",
      },
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Connect WebSocket
    const wsUrl = `${getWsUrl()}/ws/terminal`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "init",
          workDir: relativePath,
          cols: term.cols,
          rows: term.rows,
        })
      );
    };

    ws.onmessage = (event) => {
      const data = event.data;
      // Check if it's a JSON control message
      try {
        const msg = JSON.parse(data);
        if (msg.type === "exit") {
          term.writeln(`\r\n[Process exited with code ${msg.code}]`);
          return;
        }
        if (msg.type === "error") {
          term.writeln(`\r\n[Error: ${msg.message}]`);
          return;
        }
      } catch {
        // Raw terminal output
      }
      term.write(data);
    };

    ws.onerror = () => {
      term.writeln("\r\n[Connection error]");
    };

    ws.onclose = () => {
      term.writeln("\r\n[Disconnected]");
    };

    // Send input to server
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      cleanup();
    };
  }, [relativePath, cleanup]);

  return (
    <div className="flex flex-col border-t-2 border-edge" style={{ height: "300px" }}>
      <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide">
          Terminal
        </span>
        <button
          onClick={onClose}
          className="border border-fg px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-fg transition-colors hover:bg-panel-2"
        >
          Close
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden px-1 py-1" />
    </div>
  );
}
