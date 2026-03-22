import type { ToolApprovalResult } from "@aebclawd/core";

export interface Ctx {
  workDir: string;
  sessionId: string | undefined;
  busy: boolean;
  abort: AbortController | null;
  awaiting: string | null;
  sessMap: Map<string, string>;
  pendingApprovals: Map<string, { resolve: (r: ToolApprovalResult) => void; input: Record<string, unknown> }>;
}

const ctxMap = new Map<string, Ctx>();

export function ctx(id: string): Ctx {
  let c = ctxMap.get(id);
  if (!c) {
    c = {
      workDir: "",
      sessionId: undefined,
      busy: false,
      abort: null,
      awaiting: null,
      sessMap: new Map(),
      pendingApprovals: new Map(),
    };
    ctxMap.set(id, c);
  }
  return c;
}
