import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-void text-fg">
      <h1 className="font-display text-4xl font-bold uppercase tracking-[0.15em]">
        AEBClawd
      </h1>
      <p className="mt-3 text-sm text-fg-3">
        Claude Code from anywhere
      </p>
      <Link
        href="/workspaces"
        className="mt-8 bg-fg px-6 py-3 text-[13px] font-semibold uppercase tracking-wide text-void transition-colors hover:bg-fg-2"
      >
        Open Workspaces
      </Link>
    </div>
  );
}
