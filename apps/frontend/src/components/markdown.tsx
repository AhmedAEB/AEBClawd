"use client";

import { useState, useEffect, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

const FILE_EXTS = "tsx|jsx|mjs|cjs|mts|json|scss|yaml|yml|toml|java|cpp|php|bash|sql|graphql|svg|vue|svelte|astro|conf|lock|dockerfile|makefile|ts|js|md|css|html|xml|py|rb|rs|go|cs|sh|txt|cfg|ini|env|c|h";
const FILE_PATH_RE = new RegExp(`^(?:\\.?\\/?)?(?:[\\w@.+-]+\\/)*[\\w@.+-]+\\.(?:${FILE_EXTS})\\b(?::\\d+)?$`, "i");

function isFilePath(text: string): boolean {
  if (!text || text.length > 200) return false;
  if (!text.includes(".")) return false;
  if (/^https?:\/\//.test(text)) return false;
  return FILE_PATH_RE.test(text);
}

// Shared cache for file existence checks
const existsCache = new Map<string, boolean>();

function FileCodeLink({ path, children, onFileClick, workspacePath }: {
  path: string; children: ReactNode; onFileClick: (p: string) => void; workspacePath: string;
}) {
  const [exists, setExists] = useState<boolean | null>(() => existsCache.get(path) ?? null);

  useEffect(() => {
    if (existsCache.has(path)) { setExists(existsCache.get(path)!); return; }
    const absIdx = path.indexOf("/workspaces/");
    const resolved = absIdx !== -1
      ? path.slice(absIdx + "/workspaces/".length)
      : `${workspacePath}/${path.replace(/^\.\//, "")}`;
    fetch(`${API_URL}/api/filesystem/exists?path=${encodeURIComponent(resolved)}`)
      .then((r) => r.json())
      .then((d) => { existsCache.set(path, d.exists); setExists(d.exists); })
      .catch(() => { existsCache.set(path, false); setExists(false); });
  }, [path, workspacePath]);

  if (!exists) {
    return <code className="bg-panel-2 px-1 py-0.5 font-mono text-[12px]">{children}</code>;
  }

  return (
    <code
      role="button"
      tabIndex={0}
      onClick={() => onFileClick(path)}
      onKeyDown={(e) => { if (e.key === "Enter") onFileClick(path); }}
      className="bg-panel-2 px-1 py-0.5 font-mono text-[12px] underline decoration-fg-3 decoration-dotted underline-offset-2 cursor-pointer hover:bg-panel-3 hover:decoration-fg transition-colors"
    >
      {children}
    </code>
  );
}

function makeComponents(onFileClick?: (path: string) => void, workspacePath?: string): Components {
  return {
    h1: ({ children }) => (
      <h1 className="mb-3 mt-4 text-xl font-bold first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-3 text-lg font-bold first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h3>
    ),
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="mb-2 ml-5 list-disc last:mb-0">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 ml-5 list-decimal last:mb-0">{children}</ol>
    ),
    li: ({ children }) => <li className="mb-0.5">{children}</li>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:opacity-70"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-2 border-l-2 border-fg-3 pl-3 text-fg-3 last:mb-0">
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return <code className="text-[12px]">{children}</code>;
      }
      const text = String(children).replace(/\n$/, "");
      const pathOnly = text.replace(/:\d+$/, "");
      if (onFileClick && workspacePath && isFilePath(pathOnly)) {
        return (
          <FileCodeLink path={pathOnly} onFileClick={onFileClick} workspacePath={workspacePath}>
            {children}
          </FileCodeLink>
        );
      }
      return (
        <code className="bg-panel-2 px-1 py-0.5 font-mono text-[12px]">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="mb-2 overflow-x-auto border border-edge bg-panel-2 p-3 font-mono text-[12px] leading-relaxed last:mb-0">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="mb-2 overflow-x-auto last:mb-0">
        <table className="w-full border-collapse border border-edge text-[13px]">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-panel-2">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="border border-edge px-3 py-1.5 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-edge px-3 py-1.5">{children}</td>
    ),
    hr: () => <hr className="my-3 border-t border-edge" />,
    strong: ({ children }) => (
      <strong className="font-semibold">{children}</strong>
    ),
  };
}

const defaultComponents = makeComponents();

export function Markdown({
  content,
  onFileClick,
  workspacePath,
}: {
  content: string;
  onFileClick?: (path: string) => void;
  workspacePath?: string;
}) {
  const components = onFileClick ? makeComponents(onFileClick, workspacePath) : defaultComponents;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
