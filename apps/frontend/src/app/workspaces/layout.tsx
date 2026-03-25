import Link from "next/link";

export default function WorkspacesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col bg-void text-fg">
      <header className="flex items-center justify-between border-b-2 border-edge px-3 py-3 sm:px-6">
        <Link
          href="/"
          className="font-display text-[15px] font-bold uppercase tracking-[0.1em] hover:text-fg-2 transition-colors"
        >
          AEBClawd
        </Link>
      </header>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
