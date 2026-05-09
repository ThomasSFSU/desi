export default function SourcesPanel() {
  return (
    <aside className="h-fit rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-linear-to-r from-cyan-400 to-violet-400" />
        <h2 className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          Sources
        </h2>
      </div>
      <div className="mt-3 space-y-2">
        <div className="shimmer h-3 w-3/4 rounded bg-zinc-800/70" />
        <div className="shimmer h-3 w-1/2 rounded bg-zinc-800/70" />
        <div className="shimmer h-3 w-2/3 rounded bg-zinc-800/70" />
        <p className="pt-2 text-xs italic text-zinc-500">
          No sources yet — citations will appear here as stages complete.
        </p>
      </div>
    </aside>
  )
}
