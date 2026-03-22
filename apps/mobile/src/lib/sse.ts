import EventSource from "react-native-sse";

export interface SSEHandlers {
  onStream?: (data: any) => void;
  onToolApproval?: (data: any) => void;
  onDone?: (data: any) => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * Connect to the server's SSE stream using react-native-sse.
 * Returns a cleanup function to close the connection.
 */
export function connectSSE(
  baseUrl: string,
  clientId: string,
  handlers: SSEHandlers
): () => void {
  const url = `${baseUrl}/api/stream?clientId=${clientId}`;

  const es = new EventSource(url);

  es.addEventListener("open", () => {
    handlers.onOpen?.();
  });

  es.addEventListener("stream", (event: any) => {
    if (!event?.data) return;
    try {
      const data = JSON.parse(event.data);
      handlers.onStream?.(data);
    } catch {}
  });

  es.addEventListener("tool_approval", (event: any) => {
    if (!event?.data) return;
    try {
      const data = JSON.parse(event.data);
      handlers.onToolApproval?.(data);
    } catch {}
  });

  es.addEventListener("done", (event: any) => {
    if (!event?.data) return;
    try {
      const data = JSON.parse(event.data);
      handlers.onDone?.(data);
    } catch {}
  });

  es.addEventListener("server_error", (event: any) => {
    if (!event?.data) return;
    try {
      const data = JSON.parse(event.data);
      handlers.onError?.(data.message || "Server error");
    } catch {}
  });

  es.addEventListener("error", (event: any) => {
    if (event?.type === "error") {
      handlers.onError?.(event.message || "Connection error");
    }
  });

  es.addEventListener("close", () => {
    handlers.onClose?.();
  });

  return () => {
    es.close();
  };
}
