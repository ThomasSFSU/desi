import { useState, type FormEvent } from 'react'
import StageCard, { type ScoringSummary } from './components/StageCard'
import SourcesPanel from './components/SourcesPanel'

type GateInfo = {
  comparable: boolean
  reason: string | null
  suggestedRefinement: string | null
}

type IngestSource = {
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

type IngestSummary = {
  accepted: number
  rejected: Array<{ url: string; reason: string }>
  verifiedFacts: number
  totalTokensApprox: number
  sources: IngestSource[]
}

type Criterion = {
  id: string
  name: string
  description: string
  weight: number
  signals: string[]
  sources: string[]
}

type CriteriaSummary = {
  criteria: Criterion[]
  notes: string[]
  sourceCount: number
  totalTokensApprox: number
}

type PipelineStatus = {
  failedStage: string | null
  reason: string | null
}

type ParseResult = {
  optionA: string
  optionB: string
  domain: string
  comparisonId?: string
  gate?: GateInfo
  ingest?: IngestSummary
  criteria?: CriteriaSummary
  scoring?: ScoringSummary
  pipelineStatus?: PipelineStatus
  scoringSkipped?: boolean
  status?: 'rejected'
  stage?: 'gate'
  reason?: string | null
  suggestedRefinement?: string | null
}

const STAGES = [
  'Ingest',
  'Extract Criteria',
  'Score',
  'Cross-Reference',
  'Verdict',
] as const

const DEFAULT_COMPARISONS = [
  'Odoo vs Zoho One',
  'Salesforce vs Oracle',
  'Claude vs Gemini',
] as const

type StreamEvent =
  | { type: 'parsed'; data: { optionA: string; optionB: string; domain: string } }
  | { type: 'gate'; data: GateInfo }
  | { type: 'rejected'; data: { stage: string; reason: string | null; suggestedRefinement: string | null } }
  | { type: 'ingest'; data: IngestSummary }
  | { type: 'criteria'; data: CriteriaSummary }
  | { type: 'scoring'; data: ScoringSummary }
  | { type: 'pipelineFailure'; data: { failedStage: string | null; reason: string | null } }
  | { type: 'fatal'; stage: string; reason: string }
  | { type: 'done'; data: { comparisonId: string; thinkingMode: boolean; scoringSkipped: boolean } }

export default function App() {
  const [input, setInput] = useState('')
  const [thinkingMode, setThinkingMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function applyEvent(event: StreamEvent) {
    setParsed((prev) => {
      const base: ParseResult = prev ?? { optionA: '', optionB: '', domain: '' }
      switch (event.type) {
        case 'parsed':
          return { ...base, ...event.data }
        case 'gate':
          return { ...base, gate: event.data }
        case 'rejected':
          return {
            ...base,
            status: 'rejected',
            stage: 'gate',
            reason: event.data.reason,
            suggestedRefinement: event.data.suggestedRefinement,
          }
        case 'ingest':
          return { ...base, ingest: event.data }
        case 'criteria':
          return { ...base, criteria: event.data }
        case 'scoring':
          return { ...base, scoring: event.data }
        case 'pipelineFailure':
          return { ...base, pipelineStatus: event.data }
        case 'fatal':
          return { ...base, pipelineStatus: { failedStage: event.stage, reason: event.reason } }
        case 'done':
          return { ...base, comparisonId: event.data.comparisonId, scoringSkipped: event.data.scoringSkipped }
        default:
          return base
      }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setSubmitting(true)
    setError(null)
    setParsed(null)
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, thinking: thinkingMode }),
      })
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            applyEvent(JSON.parse(trimmed) as StreamEvent)
          } catch (err) {
            console.warn('failed to parse stream event:', trimmed, err)
          }
        }
      }
      if (buffer.trim()) {
        try {
          applyEvent(JSON.parse(buffer) as StreamEvent)
        } catch (err) {
          console.warn('failed to parse trailing event:', buffer, err)
        }
      }
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
    <div className="relative min-h-screen overflow-hidden bg-black text-zinc-100">
      <div aria-hidden className="grid-overlay pointer-events-none absolute inset-0 -z-10" />

      <div className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-12 flex items-center justify-between animate-fade-up">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-sm font-semibold text-zinc-100">
              D
            </div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
                Desi
              </h1>
              <span className="text-[11px] text-zinc-500">
                Decision Engine
              </span>
            </div>
          </div>
          {parsed && (
            <button
              onClick={reset}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
            >
              New comparison
            </button>
          )}
        </header>

        {!parsed ? (
          <form onSubmit={handleSubmit} className="animate-fade-up space-y-5" style={{ animationDelay: '60ms' }}>
            <div className="space-y-1.5">
              <label htmlFor="prompt" className="block text-xl font-medium text-zinc-100">
                What would you like to compare?
              </label>
              <p className="text-sm text-zinc-500">
                Two options, one domain. Desi pulls citations and scores them side by side.
              </p>
            </div>
            <input
              id="prompt"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Honda Civic vs Toyota Corolla for a long commute"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-zinc-600"
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Try
              </span>
              {DEFAULT_COMPARISONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setInput(suggestion)}
                  className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 transition hover:border-zinc-700">
              <input
                type="checkbox"
                checked={thinkingMode}
                onChange={(e) => setThinkingMode(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-zinc-700 bg-zinc-900 accent-zinc-100"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-200">Thinking mode</span>
                  <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
                    Slow
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
                  Run the heavy reasoning model to score each criterion with citations. Adds 30-60s.
                </p>
              </div>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !input.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {submitting && (
                  <svg className="h-3.5 w-3.5 animate-spin-slow" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {submitting ? 'Submitting' : 'Compare'}
              </button>
              <span className="text-xs text-zinc-600">
                <kbd className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">↵</kbd>{' '}
                to submit
              </span>
            </div>
            {error && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
          </form>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
            <div className="space-y-3">
              <div className="animate-fade-up rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm text-zinc-400">
                  Comparing{' '}
                  <strong className="font-semibold text-blue-400">{parsed.optionA}</strong>
                  {' '}vs{' '}
                  <strong className="font-semibold text-emerald-400">{parsed.optionB}</strong>
                  {' '}in{' '}
                  <em className="not-italic text-zinc-200">{parsed.domain}</em>
                </p>
              </div>

              <ComparabilityCard parsed={parsed} />

              {STAGES.map((name, i) => {
                const ingest = name === 'Ingest' ? parsed.ingest : undefined
                const criteria = name === 'Extract Criteria' ? parsed.criteria : undefined
                const scoring = name === 'Score' ? parsed.scoring : undefined
                const failedStage = parsed.pipelineStatus?.failedStage ?? null
                const failedIndex = failedStage ? STAGES.indexOf(failedStage as typeof STAGES[number]) : -1
                const hasData = Boolean(ingest || criteria || scoring)
                const scoringIntentionallySkipped =
                  name === 'Score' && parsed.scoringSkipped && !scoring && !failedStage

                let status: 'done' | 'error' | 'skipped' | 'pending'
                if (hasData) status = 'done'
                else if (failedStage === name) status = 'error'
                else if (failedIndex >= 0 && i > failedIndex) status = 'skipped'
                else if (scoringIntentionallySkipped) status = 'skipped'
                else status = 'pending'

                const errorReason = status === 'error' ? parsed.pipelineStatus?.reason ?? null : null
                const skipReason = scoringIntentionallySkipped
                  ? 'Enable Thinking Mode to score with citations'
                  : null

                return (
                  <div
                    key={name}
                    className={[
                      'animate-fade-up',
                      parsed.status === 'rejected' && 'opacity-40',
                    ].filter(Boolean).join(' ')}
                    style={{ animationDelay: `${160 + i * 60}ms` }}
                  >
                    <StageCard
                      name={name}
                      status={status}
                      ingest={ingest}
                      criteria={criteria}
                      scoring={scoring}
                      errorReason={errorReason}
                      skipReason={skipReason}
                    />
                  </div>
                )
              })}
            </div>
            <div
              className={[
                'animate-fade-up',
                parsed.status === 'rejected' && 'opacity-40',
              ].filter(Boolean).join(' ')}
              style={{ animationDelay: '220ms' }}
            >
              <SourcesPanel sources={parsed.ingest?.sources} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ComparabilityCard({ parsed }: { parsed: ParseResult }) {
  const rejected = parsed.status === 'rejected'
  const reason = rejected ? parsed.reason : parsed.gate?.reason
  const refinement = rejected ? parsed.suggestedRefinement : null

  return (
    <div
      className={[
        'animate-fade-up rounded-lg border bg-zinc-950 p-4',
        rejected ? 'border-red-500/40' : 'border-zinc-800',
      ].join(' ')}
      style={{ animationDelay: '60ms' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={[
              'h-1.5 w-1.5 rounded-full',
              rejected ? 'bg-red-400' : 'bg-zinc-100',
            ].join(' ')}
          />
          <h3 className="text-sm font-medium text-zinc-100">Comparability Check</h3>
        </div>
        <span
          className={[
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1',
            rejected
              ? 'bg-red-500/10 text-red-300 ring-red-500/30'
              : 'bg-zinc-900 text-zinc-100 ring-zinc-700',
          ].join(' ')}
        >
          {rejected ? (
            'Rejected'
          ) : (
            <>
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Passed
            </>
          )}
        </span>
      </div>

      {reason && (
        <p className={['mt-3 text-sm', rejected ? 'text-zinc-200' : 'text-zinc-500'].join(' ')}>
          {reason}
        </p>
      )}

      {rejected && refinement && (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Suggested refinement
          </p>
          <p className="mt-1 text-sm text-zinc-200">{refinement}</p>
        </div>
      )}
    </div>
  )
}
