type SourceRow = {
  url: string
  tier: 1 | 2 | 3
  option: string
  fetchedAt: string
  status: 'accepted' | 'rejected'
  fetchStatus: 'ok' | 'failed'
  title: string | null
  publishedAt: string | null
  reason: string | null
}

interface SourcesPanelProps {
  sources?: SourceRow[]
}

const TIER_LABEL: Record<SourceRow['tier'], string> = {
  1: 'Tier 1',
  2: 'Tier 2',
  3: 'Tier 3',
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SourcesPanel({ sources = [] }: SourcesPanelProps) {
  return (
    <aside className="h-fit rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Sources
        </h2>
        {sources.length > 0 && (
          <span className="text-[10px] text-zinc-600">{sources.length} URLs</span>
        )}
      </div>

      {sources.length === 0 ? (
        <div className="mt-3 space-y-2">
          <div className="shimmer h-2.5 w-3/4 rounded bg-zinc-900" />
          <div className="shimmer h-2.5 w-1/2 rounded bg-zinc-900" />
          <div className="shimmer h-2.5 w-2/3 rounded bg-zinc-900" />
          <p className="pt-2 text-xs text-zinc-600">
            Citations will appear here as stages complete.
          </p>
        </div>
      ) : (
        <div className="mt-3 max-h-[640px] space-y-3 overflow-y-auto pr-1">
          {sources.map((source) => (
            <div key={`${source.option}-${source.tier}-${source.url}`} className="border-t border-zinc-900 pt-3 first:border-t-0 first:pt-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 ring-1 ring-zinc-800">
                  {TIER_LABEL[source.tier]}
                </span>
                <span
                  className={[
                    'rounded px-1.5 py-0.5 text-[10px] font-medium ring-1',
                    source.status === 'accepted'
                      ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                      : 'bg-red-500/10 text-red-300 ring-red-500/30',
                  ].join(' ')}
                >
                  {source.status}
                </span>
              </div>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-xs leading-5 text-zinc-200 underline decoration-zinc-700 underline-offset-2 transition hover:text-white"
              >
                {source.url}
              </a>
              {source.title && (
                <p className="mt-1 text-[11px] leading-4 text-zinc-400">
                  {source.title}
                </p>
              )}
              <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                {source.option} - fetched {formatTimestamp(source.fetchedAt)}
              </p>
              {source.reason && (
                <p className="mt-1 text-[11px] leading-4 text-red-300/80">
                  {source.reason}
                </p>
              )}
              {source.fetchStatus === 'ok' && source.publishedAt && (
                <p className="mt-1 text-[11px] leading-4 text-zinc-600">
                  Published {formatTimestamp(source.publishedAt)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
