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
  console.log("[SSE lib] Creating EventSource for:", url);

  const es = new EventSource(url);

  es.addEventListener("open", () => {
    console.log("[SSE lib] open event fired");
    handlers.onOpen?.();
  });

  es.addEventListener("message", (event: any) => {
    console.log("[SSE lib] message event:", event?.data?.slice?.(0, 100));
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
    console.log("[SSE lib] error event:", JSON.stringify(event));
    if (event?.type === "error") {
      handlers.onError?.(event.message || "Connection error");
    }
  });

  es.addEventListener("close", () => {
    console.log("[SSE lib] close event fired");
    handlers.onClose?.();
  });

  return () => {
    console.log("[SSE lib] closing connection");
    es.close();
  };
}
