"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/** Matches strings that look like file paths (with extension or leading ./) */
const FILE_PATH_RE = /^(?:\.?\/?)?(?:[\w@.+-]+\/)*[\w@.+-]+\.\w{1,10}(?::\d+)?$/;

function isFilePath(text: string): boolean {
  if (!text || text.length > 200) return false;
  // Must contain a dot for extension
  if (!text.includes(".")) return false;
  // Reject URLs
  if (/^https?:\/\//.test(text)) return false;
  return FILE_PATH_RE.test(text);
}

function makeComponents(onFileClick?: (path: string) => void): Components {
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
        return (
          <code className="text-[12px]">
            {children}
          </code>
        );
      }
      const text = String(children).replace(/\n$/, "");
      // Strip trailing :lineNumber for path detection
      const pathOnly = text.replace(/:\d+$/, "");
      if (onFileClick && isFilePath(pathOnly)) {
        return (
          <code
            role="button"
            tabIndex={0}
            onClick={() => onFileClick(pathOnly)}
            onKeyDown={(e) => { if (e.key === "Enter") onFileClick(pathOnly); }}
            className="bg-panel-2 px-1 py-0.5 font-mono text-[12px] underline decoration-fg-3 decoration-dotted underline-offset-2 cursor-pointer hover:bg-panel-3 hover:decoration-fg transition-colors"
          >
            {children}
          </code>
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

// Cache for the default (no callback) case
const defaultComponents = makeComponents();

export function Markdown({
  content,
  onFileClick,
}: {
  content: string;
  onFileClick?: (path: string) => void;
}) {
  const components = onFileClick ? makeComponents(onFileClick) : defaultComponents;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
