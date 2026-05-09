import { useState, type FormEvent } from 'react'
import StageCard, { type AccentKey } from './components/StageCard'
import SourcesPanel from './components/SourcesPanel'

type ParseResult = {
  optionA: string
  optionB: string
  domain: string
}

const STAGES: { name: string; accent: AccentKey }[] = [
  { name: 'Ingest',           accent: 'cyan' },
  { name: 'Extract Criteria', accent: 'violet' },
  { name: 'Score',            accent: 'amber' },
  { name: 'Cross-Reference',  accent: 'fuchsia' },
  { name: 'Verdict',          accent: 'emerald' },
]

export default function App() {
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      })
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      const data: ParseResult = await res.json()
      setParsed(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setParsed(null)
    setInput('')
    setError(null)
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 animate-bg-drift opacity-60"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 10%, rgba(34,211,238,0.18) 0%, transparent 60%),' +
            'radial-gradient(50% 40% at 85% 30%, rgba(167,139,250,0.18) 0%, transparent 60%),' +
            'radial-gradient(50% 50% at 50% 100%, rgba(232,121,249,0.12) 0%, transparent 60%)',
        }}
      />

      <div className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-7 w-7 rounded-lg bg-linear-to-br from-cyan-400 via-violet-400 to-fuchsia-400 shadow-[0_0_24px_-4px_rgba(167,139,250,0.7)]" />
            <h1 className="bg-linear-to-r from-zinc-100 to-zinc-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
              Compare
            </h1>
          </div>
          {parsed && (
            <button
              onClick={reset}
              className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur-sm transition hover:border-zinc-700 hover:text-zinc-100"
            >
              New comparison
            </button>
          )}
        </header>

        {!parsed ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <label htmlFor="prompt" className="block text-lg text-zinc-200">
              What would you like to compare?
            </label>
            <div className="group relative">
              <div className="pointer-events-none absolute -inset-px rounded-xl bg-linear-to-r from-cyan-400/0 via-violet-400/40 to-fuchsia-400/0 opacity-0 blur-md transition group-focus-within:opacity-100" />
              <input
                id="prompt"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. Honda Civic vs Toyota Corolla for a long commute"
                className="relative w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-base text-zinc-100 placeholder-zinc-500 outline-none backdrop-blur-sm transition focus:border-violet-400/60"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !input.trim()}
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-linear-to-r from-cyan-400 via-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-medium text-zinc-950 shadow-[0_0_24px_-6px_rgba(167,139,250,0.7)] transition hover:shadow-[0_0_32px_-4px_rgba(167,139,250,0.9)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {submitting && (
                <svg className="h-4 w-4 animate-spin-slow" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
          </form>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 backdrop-blur-sm">
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  Comparing
                </p>
                <p className="mt-1.5 text-base">
                  <span className="font-medium text-cyan-300">{parsed.optionA}</span>
                  <span className="mx-2 text-zinc-600">vs</span>
                  <span className="font-medium text-fuchsia-300">{parsed.optionB}</span>
                </p>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  Domain · <span className="text-violet-300">{parsed.domain}</span>
                </p>
              </div>

              {STAGES.map(({ name, accent }) => (
                <StageCard key={name} name={name} status="pending" accent={accent} />
              ))}
            </div>
            <SourcesPanel />
          </div>
        )}
      </div>
    </div>
  )
}
