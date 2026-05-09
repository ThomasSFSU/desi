type Status = 'pending' | 'running' | 'done' | 'error'

type IngestSummary = {
  accepted: number
  rejected: Array<{ url: string; reason: string }>
  verifiedFacts: number
  totalTokensApprox: number
}

interface StageCardProps {
  name: string
  status: Status
  ingest?: IngestSummary
}

const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  error: 'Error',
}

const STATUS_BADGE: Record<Status, string> = {
  pending: 'bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800',
  running: 'bg-zinc-900 text-zinc-100 ring-1 ring-zinc-700',
  done:    'bg-zinc-900 text-zinc-100 ring-1 ring-zinc-700',
  error:   'bg-red-500/10 text-red-300 ring-1 ring-red-500/30',
}

export default function StageCard({ name, status, ingest }: StageCardProps) {
  const isRunning = status === 'running'
  const isPending = status === 'pending'
  const isDone = status === 'done'

  return (
    <div className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-4 transition duration-200 hover:border-zinc-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={[
              'h-1.5 w-1.5 rounded-full',
              isPending && 'bg-zinc-700',
              isRunning && 'bg-zinc-100 animate-pulse-soft',
              isDone && 'bg-zinc-100',
              status === 'error' && 'bg-red-400',
            ].filter(Boolean).join(' ')}
          />
          <h3 className="text-sm font-medium text-zinc-100">{name}</h3>
        </div>

        <span
          className={[
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
            STATUS_BADGE[status],
          ].join(' ')}
        >
          {isRunning && (
            <svg className="h-2.5 w-2.5 animate-spin-slow" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {isDone && (
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="mt-3 text-sm">
        {ingest ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                {ingest.accepted} accepted
              </span>
              <span className="inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-300 ring-1 ring-red-500/30">
                {ingest.rejected.length} rejected
              </span>
              <span className="text-xs text-zinc-500">
                {ingest.totalTokensApprox.toLocaleString()} estimated tokens
              </span>
              <span className="text-xs text-zinc-600">
                {ingest.verifiedFacts.toLocaleString()} pricing facts
              </span>
            </div>

            {ingest.rejected.length > 0 && (
              <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-red-300">
                  Rejected sources
                </p>
                <ul className="mt-2 space-y-2">
                  {ingest.rejected.map((source) => (
                    <li key={source.url} className="text-xs leading-5">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-zinc-200 underline decoration-zinc-700 underline-offset-2 transition hover:text-white"
                      >
                        {source.url}
                      </a>
                      <span className="ml-2 text-zinc-500">{source.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : isPending ? (
          <div className="space-y-2">
            <div className="shimmer h-2.5 w-2/3 rounded bg-zinc-900" />
            <div className="shimmer h-2.5 w-1/2 rounded bg-zinc-900" />
          </div>
        ) : (
          <p className="text-zinc-500">Awaiting citations…</p>
        )}
      </div>
    </div>
  )
}
