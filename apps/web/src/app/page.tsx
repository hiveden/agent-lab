import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold mb-2">agent-lab</h1>
      <p className="text-sm text-[#8b949e] mb-6">
        Personal AI agent platform · Phase 1 MVP
      </p>
      <div className="grid gap-4 max-w-2xl" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <Link
          href="/agents/radar"
          className="block rounded-lg border border-[#21262d] bg-[#161b22] p-5 hover:border-[#30363d] transition"
        >
          <div className="text-2xl mb-2">📡</div>
          <div className="font-semibold mb-1">Radar</div>
          <div className="text-xs text-[#8b949e]">推送看板 →</div>
        </Link>
      </div>
      <div className="mt-8 text-xs text-[#484f58]">
        Phase 1 is a minimal scaffold. Phase 2 will redesign the UI.
      </div>
    </main>
  );
}
