type Status = 'pending' | 'running' | 'done' | 'error'

interface StageCardProps {
  name: string
  status: Status
  accent?: AccentKey
}

export type AccentKey = 'cyan' | 'violet' | 'amber' | 'fuchsia' | 'emerald'

const ACCENT: Record<AccentKey, { dot: string; ring: string; glow: string; text: string }> = {
  cyan:    { dot: 'bg-cyan-400',    ring: 'ring-cyan-400/30',    glow: 'shadow-[0_0_24px_-6px_rgba(34,211,238,0.6)]',  text: 'text-cyan-300' },
  violet:  { dot: 'bg-violet-400',  ring: 'ring-violet-400/30',  glow: 'shadow-[0_0_24px_-6px_rgba(167,139,250,0.6)]', text: 'text-violet-300' },
  amber:   { dot: 'bg-amber-400',   ring: 'ring-amber-400/30',   glow: 'shadow-[0_0_24px_-6px_rgba(251,191,36,0.6)]',  text: 'text-amber-300' },
  fuchsia: { dot: 'bg-fuchsia-400', ring: 'ring-fuchsia-400/30', glow: 'shadow-[0_0_24px_-6px_rgba(232,121,249,0.6)]', text: 'text-fuchsia-300' },
  emerald: { dot: 'bg-emerald-400', ring: 'ring-emerald-400/30', glow: 'shadow-[0_0_24px_-6px_rgba(52,211,153,0.6)]',  text: 'text-emerald-300' },
}

const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  error: 'Error',
}

const STATUS_BADGE: Record<Status, string> = {
  pending: 'bg-zinc-800/80 text-zinc-400 ring-1 ring-zinc-700/60',
  running: 'bg-zinc-900 text-zinc-100 ring-1',
  done:    'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-400/30',
  error:   'bg-red-500/10 text-red-300 ring-1 ring-red-400/30',
}

export default function StageCard({ name, status, accent = 'cyan' }: StageCardProps) {
  const a = ACCENT[accent]
  const isRunning = status === 'running'
  const isPending = status === 'pending'

  return (
    <div
      className={[
        'relative overflow-hidden rounded-xl border bg-zinc-900/60 p-4 backdrop-blur-sm transition',
        isRunning
          ? `border-transparent ring-1 ${a.ring} ${a.glow}`
          : 'border-zinc-800/80',
      ].join(' ')}
    >
      <div
        aria-hidden
        className={[
          'absolute inset-y-0 left-0 w-0.5 transition',
          isRunning || status === 'done' ? a.dot : 'bg-zinc-800',
          isRunning ? 'animate-pulse-soft' : '',
        ].join(' ')}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={[
              'h-2 w-2 rounded-full',
              a.dot,
              isRunning ? 'animate-pulse-soft' : isPending ? 'opacity-30' : '',
            ].join(' ')}
          />
          <h3 className="text-base font-medium text-zinc-100">{name}</h3>
        </div>

        <span
          className={[
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
            STATUS_BADGE[status],
            isRunning ? a.ring : '',
            isRunning ? a.text : '',
          ].join(' ')}
        >
          {isRunning && (
            <svg className="h-3 w-3 animate-spin-slow" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="mt-3 text-sm">
        {isPending ? (
          <div className="space-y-2">
            <div className="shimmer h-3 w-2/3 rounded bg-zinc-800/70" />
            <div className="shimmer h-3 w-1/2 rounded bg-zinc-800/70" />
          </div>
        ) : (
          <p className={`italic ${a.text} opacity-80`}>Awaiting citations…</p>
        )}
      </div>
    </div>
  )
}
