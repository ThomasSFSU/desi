import { useState } from 'react'

type Status = 'pending' | 'running' | 'done' | 'error' | 'skipped'

type IngestSummary = {
  accepted: number
  rejected: Array<{ url: string; reason: string }>
  verifiedFacts: number
  totalTokensApprox: number
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

export type Citation = {
  sourceUrl: string
  quotedText: string
  tier: 1 | 2 | 3
  fetchedAt?: string
}

export type ScoreEntry = {
  criterion: string
  score: number | null
  citations: Citation[]
  reason?: string
  confidence: number
}

export type ScoringSummary = {
  optionA: { option: string; scores: ScoreEntry[]; corpusSize: number }
  optionB: { option: string; scores: ScoreEntry[]; corpusSize: number }
  perCriterion: Array<{
    criterion: string
    weight: number
    a: { score: number | null; confidence: number; citationCount: number; reason?: string } | null
    b: { score: number | null; confidence: number; citationCount: number; reason?: string } | null
  }>
}

export type CrossReferenceSummary = {
  status: 'passed' | 'needs_review'
  checkedCells: number
  citedCells: number
  uncitedScores: number
  insufficientEvidence: number
  averageConfidence: number
  issues: Array<{
    level: 'info' | 'warning'
    option: string
    criterion: string
    message: string
  }>
  summary: string
}

export type VerdictSummary = {
  winner: 'optionA' | 'optionB' | 'tie'
  recommendedOption: string
  confidence: number
  summary: string
  keyReasons: string[]
  tradeoffs: string[]
  caveats: string[]
  scorecard: {
    optionA: { option: string; weightedAverage: number | null; scoredWeight: number; totalWeight: number }
    optionB: { option: string; weightedAverage: number | null; scoredWeight: number; totalWeight: number }
  }
  model: string
}

interface StageCardProps {
  name: string
  status: Status
  ingest?: IngestSummary
  criteria?: CriteriaSummary
  scoring?: ScoringSummary
  crossReference?: CrossReferenceSummary
  verdict?: VerdictSummary
  errorReason?: string | null
  skipReason?: string | null
}

const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  error: 'Error',
  skipped: 'Skipped',
}

const STATUS_BADGE: Record<Status, string> = {
  pending: 'bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800',
  running: 'bg-zinc-900 text-zinc-100 ring-1 ring-zinc-700',
  done:    'bg-zinc-900 text-zinc-100 ring-1 ring-zinc-700',
  error:   'bg-red-500/10 text-red-300 ring-1 ring-red-500/30',
  skipped: 'bg-zinc-900/50 text-zinc-600 ring-1 ring-zinc-800',
}

export default function StageCard({ name, status, ingest, criteria, scoring, crossReference, verdict, errorReason, skipReason }: StageCardProps) {
  const isRunning = status === 'running'
  const isPending = status === 'pending'
  const isDone = status === 'done'
  const isError = status === 'error'
  const isSkipped = status === 'skipped'

  return (
    <div
      className={[
        'group relative overflow-hidden rounded-lg border bg-zinc-950 p-4 transition duration-200',
        isError ? 'border-red-500/40' : 'border-zinc-800 hover:border-zinc-700',
        isSkipped && 'opacity-60',
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={[
              'h-1.5 w-1.5 rounded-full',
              isPending && 'bg-zinc-700',
              isRunning && 'bg-zinc-100 animate-pulse-soft',
              isDone && 'bg-zinc-100',
              isError && 'bg-red-400',
              isSkipped && 'bg-zinc-700',
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
        {isError ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-red-300">
              Stage failed
            </p>
            <p className="mt-1 text-xs leading-5 text-red-200">
              {errorReason ?? 'Unknown error'}
            </p>
          </div>
        ) : isSkipped ? (
          <p className="text-xs italic text-zinc-500">
            {skipReason ?? 'Not run due to pipeline failure'}
          </p>
        ) : ingest ? (
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
        ) : criteria ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                {criteria.criteria.length} criteria
              </span>
              <span className="text-xs text-zinc-500">
                {criteria.sourceCount} sources
              </span>
              <span className="text-xs text-zinc-600">
                {criteria.totalTokensApprox.toLocaleString()} estimated tokens
              </span>
            </div>

            {criteria.criteria.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {criteria.criteria.map((criterion) => (
                  <div key={criterion.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-xs font-medium leading-5 text-zinc-100">
                        {criterion.name}
                      </h4>
                      <span className="shrink-0 rounded bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400 ring-1 ring-zinc-800">
                        W{criterion.weight}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                      {criterion.description}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                {criteria.notes[0] ?? 'No criteria extracted.'}
              </p>
            )}
          </div>
        ) : scoring ? (
          <ScoreTable scoring={scoring} />
        ) : crossReference ? (
          <CrossReferenceView crossReference={crossReference} />
        ) : verdict ? (
          <VerdictView verdict={verdict} />
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

type CellSelection = {
  optionLabel: string
  criterion: string
  entry: ScoreEntry
} | null

function CrossReferenceView({ crossReference }: { crossReference: CrossReferenceSummary }) {
  const coverage = crossReference.checkedCells === 0
    ? 0
    : Math.round((crossReference.citedCells / crossReference.checkedCells) * 100)
  const confidence = Math.round(crossReference.averageConfidence * 100)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={[
            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1',
            crossReference.status === 'passed'
              ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
              : 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
          ].join(' ')}
        >
          {crossReference.status === 'passed' ? 'Passed' : 'Review'}
        </span>
        <span className="text-xs text-zinc-500">
          {crossReference.checkedCells} cells checked
        </span>
        <span className="text-xs text-zinc-600">
          {coverage}% citation coverage
        </span>
        <span className="text-xs text-zinc-600">
          {confidence}% avg confidence
        </span>
      </div>

      <p className="text-xs leading-5 text-zinc-400">
        {crossReference.summary}
      </p>

      {crossReference.issues.length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Sanity-check notes
          </p>
          <ul className="mt-2 space-y-2">
            {crossReference.issues.map((issue, i) => (
              <li key={`${issue.option}-${issue.criterion}-${i}`} className="text-xs leading-5">
                <span
                  className={[
                    'mr-2 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ring-1',
                    issue.level === 'warning'
                      ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
                      : 'bg-zinc-950 text-zinc-400 ring-zinc-800',
                  ].join(' ')}
                >
                  {issue.level}
                </span>
                <span className="font-medium text-zinc-200">{issue.option}</span>
                <span className="text-zinc-500"> · {issue.criterion}: </span>
                <span className="text-zinc-400">{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(crossReference.uncitedScores > 0 || crossReference.insufficientEvidence > 0) && (
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-500 ring-1 ring-zinc-800">
            {crossReference.uncitedScores} uncited scores
          </span>
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-500 ring-1 ring-zinc-800">
            {crossReference.insufficientEvidence} evidence gaps
          </span>
        </div>
      )}
    </div>
  )
}

function scoreLabel(value: number | null): string {
  return value === null ? 'No supported score' : `${value.toFixed(1)}/10`
}

function VerdictView({ verdict }: { verdict: VerdictSummary }) {
  const confidence = Math.round(verdict.confidence * 100)
  const isTie = verdict.winner === 'tie'

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Recommendation
            </p>
            <p className="mt-1 text-base font-semibold text-zinc-100">
              {isTie ? 'No clear winner' : verdict.recommendedOption}
            </p>
          </div>
          <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-300 ring-1 ring-zinc-800">
            {confidence}% confidence
          </span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-blue-300">
            {verdict.scorecard.optionA.option}
          </p>
          <p className="mt-1 font-mono text-sm text-zinc-100">
            {scoreLabel(verdict.scorecard.optionA.weightedAverage)}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {verdict.scorecard.optionA.scoredWeight}/{verdict.scorecard.optionA.totalWeight} weighted evidence
          </p>
        </div>
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">
            {verdict.scorecard.optionB.option}
          </p>
          <p className="mt-1 font-mono text-sm text-zinc-100">
            {scoreLabel(verdict.scorecard.optionB.weightedAverage)}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {verdict.scorecard.optionB.scoredWeight}/{verdict.scorecard.optionB.totalWeight} weighted evidence
          </p>
        </div>
      </div>

      <p className="whitespace-pre-line text-sm leading-6 text-zinc-300">
        {verdict.summary}
      </p>

      <VerdictList title="Key reasons" items={verdict.keyReasons} />
      <VerdictList title="Tradeoffs" items={verdict.tradeoffs} />
      <VerdictList title="Caveats" items={verdict.caveats} muted />

      <p className="text-[10px] text-zinc-600">
        Summary model: {verdict.model}
      </p>
    </div>
  )
}

function VerdictList({ title, items, muted = false }: { title: string; items: string[]; muted?: boolean }) {
  if (items.length === 0) return null

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={`${title}-${i}`} className={['text-xs leading-5', muted ? 'text-zinc-500' : 'text-zinc-300'].join(' ')}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ScoreTable({ scoring }: { scoring: ScoringSummary }) {
  const [selected, setSelected] = useState<CellSelection>(null)

  const findEntry = (criterion: string, side: 'a' | 'b'): ScoreEntry | undefined => {
    const list = side === 'a' ? scoring.optionA.scores : scoring.optionB.scores
    return list.find((s) => s.criterion === criterion)
  }

  const openCell = (criterion: string, side: 'a' | 'b') => {
    const entry = findEntry(criterion, side)
    if (!entry || entry.citations.length === 0) return
    setSelected({
      optionLabel: side === 'a' ? scoring.optionA.option : scoring.optionB.option,
      criterion,
      entry,
    })
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Criterion</th>
              <th className="px-3 py-2 text-left font-medium text-blue-300">{scoring.optionA.option}</th>
              <th className="px-3 py-2 text-left font-medium text-emerald-300">{scoring.optionB.option}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {scoring.perCriterion.map((row) => (
              <tr key={row.criterion}>
                <td className="px-3 py-2.5 align-top">
                  <div className="font-medium text-zinc-100">{row.criterion}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">weight {row.weight}</div>
                </td>
                <ScoreCell
                  cell={row.a}
                  onOpen={() => openCell(row.criterion, 'a')}
                />
                <ScoreCell
                  cell={row.b}
                  onOpen={() => openCell(row.criterion, 'b')}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <CitationPanel selection={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function ScoreCell({
  cell,
  onOpen,
}: {
  cell: ScoringSummary['perCriterion'][number]['a']
  onOpen: () => void
}) {
  if (!cell) {
    return <td className="px-3 py-2.5 align-top text-zinc-600">—</td>
  }

  if (cell.score === null) {
    return (
      <td className="px-3 py-2.5 align-top">
        <div className="text-zinc-400">Insufficient evidence</div>
        {cell.reason && (
          <div className="mt-0.5 text-[10px] text-zinc-600">{cell.reason}</div>
        )}
      </td>
    )
  }

  const pct = Math.round(cell.confidence * 100)
  const canOpen = cell.citationCount > 0

  return (
    <td className="px-3 py-2.5 align-top">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium text-zinc-100">
          {cell.score}/10
        </span>
        <button
          type="button"
          onClick={onOpen}
          disabled={!canOpen}
          className={[
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition',
            canOpen
              ? 'bg-zinc-900 text-zinc-200 ring-zinc-700 hover:bg-zinc-800 hover:text-white cursor-pointer'
              : 'bg-zinc-950 text-zinc-600 ring-zinc-800 cursor-default',
          ].join(' ')}
          title={canOpen ? 'View citations' : 'No citations'}
        >
          {cell.citationCount} cite{cell.citationCount === 1 ? '' : 's'}
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1 w-20 overflow-hidden rounded-full bg-zinc-900">
          <div
            className="h-full bg-zinc-300 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-zinc-500">{pct}%</span>
      </div>
    </td>
  )
}

function tierLabel(tier: 1 | 2 | 3): string {
  if (tier === 1) return 'Vendor'
  if (tier === 2) return 'Review'
  return 'Community'
}

function tierBadgeClasses(tier: 1 | 2 | 3): string {
  if (tier === 1) return 'bg-blue-500/10 text-blue-300 ring-blue-500/30'
  if (tier === 2) return 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
  return 'bg-zinc-800 text-zinc-300 ring-zinc-700'
}

function CitationPanel({
  selection,
  onClose,
}: {
  selection: NonNullable<CellSelection>
  onClose: () => void
}) {
  const { optionLabel, criterion, entry } = selection
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Citations
          </div>
          <div className="mt-0.5 text-xs text-zinc-200">
            <span className="font-medium">{optionLabel}</span>
            <span className="text-zinc-500"> · {criterion}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
        >
          Close
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {entry.citations.map((citation, i) => (
          <li
            key={`${citation.sourceUrl}-${i}`}
            className="rounded-md border border-zinc-800 bg-zinc-950 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <a
                href={citation.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-xs text-zinc-200 underline decoration-zinc-700 underline-offset-2 hover:text-white"
              >
                {citation.sourceUrl}
              </a>
              <span
                className={[
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1',
                  tierBadgeClasses(citation.tier),
                ].join(' ')}
              >
                T{citation.tier} · {tierLabel(citation.tier)}
              </span>
            </div>
            <blockquote className="mt-2 border-l-2 border-zinc-700 pl-3 text-xs italic leading-5 text-zinc-300">
              "{citation.quotedText}"
            </blockquote>
            {citation.fetchedAt && (
              <div className="mt-2 text-[10px] text-zinc-600">
                Fetched {new Date(citation.fetchedAt).toLocaleString()}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
