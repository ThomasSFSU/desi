export default function SourcesPanel() {
  return (
    <aside className="h-fit rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        Sources
      </h2>
      <div className="mt-3 space-y-2">
        <div className="shimmer h-2.5 w-3/4 rounded bg-zinc-900" />
        <div className="shimmer h-2.5 w-1/2 rounded bg-zinc-900" />
        <div className="shimmer h-2.5 w-2/3 rounded bg-zinc-900" />
        <p className="pt-2 text-xs text-zinc-600">
          Citations will appear here as stages complete.
        </p>
      </div>
    </aside>
  )
}
