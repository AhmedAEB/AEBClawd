import { getApiUrl } from "./storage";

async function getBaseUrl(): Promise<string> {
  const url = await getApiUrl();
  if (!url) throw new Error("API URL not configured");
  return url.replace(/\/+$/, "");
}

async function request<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API error ${response.status}: ${text}`);
  }
  return response.json();
}

function post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function get<T = any>(path: string): Promise<T> {
  return request<T>(path);
}

export const api = {
  // Health
  health: () => get<{ status: string }>("/health"),

  // Filesystem
  listDirectory: (path?: string) =>
    get(`/api/filesystem${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  mkdir: (path: string) => post("/api/filesystem/mkdir", { path }),
  rmdir: (path: string) => post("/api/filesystem/rmdir", { path }),

  // Sessions
  listSessions: (dir: string, limit = 50) =>
    get(`/api/sessions?dir=${encodeURIComponent(dir)}&limit=${limit}`),
  getMessages: (id: string, limit = 200) =>
    get(`/api/sessions/${id}/messages?limit=${limit}`),

  // Stream
  sendPrompt: (body: {
    clientId: string;
    prompt: string;
    sessionId?: string;
    workDir?: string;
    model?: string;
    images?: { data: string; mediaType: string }[];
  }) => post("/api/stream/prompt", body as unknown as Record<string, unknown>),
  toolApproval: (body: {
    clientId: string;
    toolUseId: string;
    approved: boolean;
    reason?: string;
  }) =>
    post(
      "/api/stream/tool-approval",
      body as unknown as Record<string, unknown>
    ),
  abort: (clientId: string) =>
    post("/api/stream/abort", { clientId }),

  // Models
  getModels: () =>
    get<{ value: string; displayName: string; description: string }[]>(
      "/api/models"
    ),

  // Git
  gitStatus: (dir: string) =>
    get(`/api/git/status?dir=${encodeURIComponent(dir)}`),
  gitLog: (dir: string, limit = 40) =>
    get(`/api/git/log?dir=${encodeURIComponent(dir)}&limit=${limit}`),
  gitDiff: (dir: string, file: string, staged: boolean) =>
    get(
      `/api/git/diff?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}&staged=${staged}`
    ),
  gitStage: (dir: string, files: string[]) =>
    post("/api/git/stage", { dir, files }),
  gitUnstage: (dir: string, files: string[]) =>
    post("/api/git/unstage", { dir, files }),
  gitDiscard: (dir: string, files: string[]) =>
    post("/api/git/discard", { dir, files }),
  gitCommit: (dir: string, message: string) =>
    post("/api/git/commit", { dir, message }),
  gitPush: (dir: string, force?: boolean) =>
    post("/api/git/push", { dir, force }),
  gitPull: (dir: string) => post("/api/git/pull", { dir }),
  gitBranches: (dir: string) =>
    get(`/api/git/branches?dir=${encodeURIComponent(dir)}`),
  gitCheckout: (dir: string, branch: string) =>
    post("/api/git/checkout", { dir, branch }),
  gitCreateBranch: (dir: string, name: string, from?: string) =>
    post("/api/git/create-branch", { dir, name, from }),
  gitSyncStatus: (dir: string) =>
    get(`/api/git/sync-status?dir=${encodeURIComponent(dir)}`),
};
