import { z } from 'zod'
import { HEAVY_MODEL, LONG_CONTEXT_MODEL, pipeshift } from '../clients/pipeshift.js'
import type { Criterion } from '../extract/criteria.js'
import type { FetchedSource } from '../ingest/fetcher.js'
import type { VerificationResult } from '../ingest/verifier.js'

export type CorpusEntry = FetchedSource & { status: 'ok' }

const CitationTier = z.union([z.literal(1), z.literal(2), z.literal(3)])

const Citation = z.object({
  sourceUrl: z.string().url(),
  quotedText: z.string().min(1).max(500),
  tier: CitationTier,
})

const ScoreEntryRaw = z.object({
  criterion: z.string().min(1),
  score: z.number().min(1).max(10).nullable(),
  citations: z.array(Citation).default([]),
  reason: z.string().nullable().optional(),
})

const ScoresResult = z.object({
  scores: z.array(ScoreEntryRaw).min(1),
})

export type Citation = z.infer<typeof Citation> & { fetchedAt?: string }

export type ScoreEntry = {
  criterion: string
  score: number | null
  citations: Citation[]
  reason?: string | null
  confidence: number
}

export type OptionScores = {
  option: string
  scores: ScoreEntry[]
  corpusSize: number
}

export type ScoreAllResult = {
  optionA: OptionScores
  optionB: OptionScores
}

interface ScoreOptionInput {
  option: string
  criteria: Criterion[]
  corpus: CorpusEntry[]
  model?: string
}

interface ScoreAllInput {
  optionA: string
  optionB: string
  criteria: Criterion[]
  corpus: Array<{ fetched: FetchedSource; verification: VerificationResult }>
  model?: string
}

const SYSTEM_PROMPT = `You are scoring one option against a fixed list of criteria, using ONLY the provided source corpus. For each criterion, output a score 1-10 and at least one citation. A citation is {sourceUrl, quotedText, tier} where quotedText is a verbatim substring (≤200 chars) from that source that supports your score. NEVER invent quotes. If the corpus contains no evidence for a criterion, output score: null and citations: [] with reason: 'insufficient_evidence'. Higher tier sources (1=vendor, 2=structured third-party, 3=community) are more authoritative for factual claims; reverse the weighting for sentiment. Output JSON: {scores: [{criterion: string, score: number | null, citations: [{sourceUrl, quotedText, tier}], reason?: string}]}.`

const JSON_ONLY = `Return only valid JSON. No prose, markdown, bullets, headings, or explanation.`

const MAX_SOURCE_CHARS = 3_000
const MAX_TOTAL_CHARS = 24_000

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return raw.trim()
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeCriterion(name: string): string {
  return name.toLowerCase().trim()
}

function buildCorpusText(corpus: CorpusEntry[]): string {
  let used = 0
  const blocks: string[] = []
  for (const source of corpus) {
    if (used >= MAX_TOTAL_CHARS) break
    const remaining = MAX_TOTAL_CHARS - used
    const excerpt = source.content.slice(0, Math.min(MAX_SOURCE_CHARS, remaining))
    used += excerpt.length
    blocks.push(
      `[source_id=${source.url} tier=${source.tier} fetched=${source.fetchedAt}]\n${excerpt}\n---`,
    )
  }
  return blocks.join('\n')
}

function filterCorpusForOption(
  verified: ScoreAllInput['corpus'],
  option: string,
): CorpusEntry[] {
  const target = normalizeCriterion(option)
  return verified
    .filter(({ fetched, verification }) => fetched.status === 'ok' && verification.status === 'accepted')
    .map(({ fetched }) => fetched as CorpusEntry)
    .filter((source) => normalizeCriterion(source.option) === target)
}

function quoteAppearsInCorpus(quotedText: string, content: string): boolean {
  const haystack = normalizeWhitespace(content)
  const needle = normalizeWhitespace(quotedText)
  if (!needle) return false
  return haystack.includes(needle)
}

interface VerifyCitationsResult {
  failures: Array<{
    criterion: string
    sourceUrl: string
    quotedText: string
    failureKind: 'unknown_source' | 'quote_not_in_source'
  }>
  affectedCriteria: Set<string>
}

function verifyCitations(
  scores: z.infer<typeof ScoresResult>['scores'],
  corpus: CorpusEntry[],
): VerifyCitationsResult {
  const byUrl = new Map(corpus.map((source) => [source.url, source]))
  const failures: VerifyCitationsResult['failures'] = []
  const affectedCriteria = new Set<string>()

  for (const entry of scores) {
    for (const citation of entry.citations) {
      const source = byUrl.get(citation.sourceUrl)
      if (!source) {
        failures.push({
          criterion: entry.criterion,
          sourceUrl: citation.sourceUrl,
          quotedText: citation.quotedText,
          failureKind: 'unknown_source',
        })
        affectedCriteria.add(normalizeCriterion(entry.criterion))
        continue
      }
      if (!quoteAppearsInCorpus(citation.quotedText, source.content)) {
        failures.push({
          criterion: entry.criterion,
          sourceUrl: citation.sourceUrl,
          quotedText: citation.quotedText,
          failureKind: 'quote_not_in_source',
        })
        affectedCriteria.add(normalizeCriterion(entry.criterion))
      }
    }
  }

  return { failures, affectedCriteria }
}

function logCitationFailures(
  option: string,
  attempt: 'first' | 'retry',
  failures: VerifyCitationsResult['failures'],
  corpus: CorpusEntry[],
): void {
  if (failures.length === 0) return
  const byUrl = new Map(corpus.map((source) => [source.url, source]))
  for (const failure of failures) {
    const source = byUrl.get(failure.sourceUrl)
    const sample = source ? source.content.slice(0, 240).replace(/\s+/g, ' ').trim() : null
    console.warn('[score] citation rejected', {
      option,
      attempt,
      criterion: failure.criterion,
      sourceUrl: failure.sourceUrl,
      kind: failure.failureKind,
      quotedText: failure.quotedText.slice(0, 240),
      sourceSample: sample,
    })
  }
}

function alignToCriteria(
  parsed: z.infer<typeof ScoresResult>,
  criteria: Criterion[],
): z.infer<typeof ScoresResult>['scores'] {
  const byName = new Map<string, z.infer<typeof ScoreEntryRaw>>()
  for (const entry of parsed.scores) {
    byName.set(normalizeCriterion(entry.criterion), entry)
  }
  const aligned = criteria.map((criterion) => {
    const entry = byName.get(normalizeCriterion(criterion.name))
    if (!entry) {
      throw new Error(`missing score for criterion "${criterion.name}"`)
    }
    return { ...entry, criterion: criterion.name }
  })
  return aligned
}

function enrichCitations(
  citations: z.infer<typeof Citation>[],
  corpus: CorpusEntry[],
): Citation[] {
  const byUrl = new Map(corpus.map((source) => [source.url, source]))
  return citations.map((citation) => {
    const source = byUrl.get(citation.sourceUrl)
    return {
      ...citation,
      fetchedAt: source?.fetchedAt,
    }
  })
}

class ScoreParseError extends Error {
  constructor(
    readonly raw: string,
    readonly cause: unknown,
  ) {
    super('score response was not valid JSON')
  }
}

async function callScoreModel(
  input: ScoreOptionInput,
  retryNote?: string,
): Promise<z.infer<typeof ScoresResult>> {
  const corpusText = buildCorpusText(input.corpus)
  const criteriaList = input.criteria
    .map((c, i) => `${i + 1}. ${c.name} — ${c.description} (weight ${c.weight})`)
    .join('\n')

  const userBody = [
    `Option: ${input.option}`,
    '',
    'Criteria (score every one of these by exact name):',
    criteriaList,
    '',
    'Corpus:',
    corpusText || '(no corpus available)',
  ].join('\n')

  const userContent = retryNote ? `${JSON_ONLY}\n\n${retryNote}\n\n${userBody}` : `${JSON_ONLY}\n\n${userBody}`

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userContent },
  ]

  // Pipeshift defaults max_tokens to 512, which is too small for reasoning
  // models that burn the budget on hidden chain-of-thought before emitting
  // visible JSON. Kimi-K2.6 and MiniMax-M2 both have very large output windows;
  // request a high cap so the actual JSON survives.
  const MAX_OUTPUT_TOKENS = 32768
  const modelToUse = input.model ?? HEAVY_MODEL
  let raw = await pipeshift.chat({
    model: modelToUse,
    messages,
    temperature: 1,
    maxTokens: MAX_OUTPUT_TOKENS,
  })

  if (!raw.trim() && LONG_CONTEXT_MODEL !== modelToUse) {
    console.warn(`[score] model "${modelToUse}" returned empty content — falling back to LONG_CONTEXT_MODEL "${LONG_CONTEXT_MODEL}"`)
    raw = await pipeshift.chat({
      model: LONG_CONTEXT_MODEL,
      messages,
      temperature: 1,
      maxTokens: MAX_OUTPUT_TOKENS,
    })
  }

  try {
    let parsed = JSON.parse(extractJson(raw))
    if (Array.isArray(parsed)) {
      parsed = { scores: parsed }
    }
    return ScoresResult.parse(parsed)
  } catch (err) {
    throw new ScoreParseError(raw, err)
  }
}

export function computeConfidence({
  score,
  citations,
}: {
  score: number | null
  citations: Array<{ tier: 1 | 2 | 3 }>
}): number {
  if (score === null) return 0
  let base: number
  if (citations.length === 0) base = 0
  else if (citations.length === 1) base = 0.4
  else if (citations.length === 2) base = 0.7
  else base = 0.9

  const tiers = new Set(citations.map((c) => c.tier))
  let tierMultiplier: number
  if (tiers.has(1)) tierMultiplier = 1.0
  else if (tiers.has(2)) tierMultiplier = 0.85
  else tierMultiplier = 0.6

  return Math.round(base * tierMultiplier * 100) / 100
}

export async function scoreOption(input: ScoreOptionInput): Promise<OptionScores> {
  if (input.criteria.length === 0) {
    return { option: input.option, scores: [], corpusSize: input.corpus.length }
  }
  if (input.corpus.length === 0) {
    const scores: ScoreEntry[] = input.criteria.map((c) => ({
      criterion: c.name,
      score: null,
      citations: [],
      reason: 'insufficient_evidence',
      confidence: 0,
    }))
    return { option: input.option, scores, corpusSize: 0 }
  }

  let firstAttempt: z.infer<typeof ScoresResult>
  try {
    const parsed = await callScoreModel(input)
    firstAttempt = { scores: alignToCriteria(parsed, input.criteria) }
  } catch (err) {
    console.error('[score] first attempt failed:', err instanceof Error ? err.message : err)
    throw err
  }

  let firstVerify = verifyCitations(firstAttempt.scores, input.corpus)
  logCitationFailures(input.option, 'first', firstVerify.failures, input.corpus)

  let finalScores = firstAttempt.scores
  let finalAffected = firstVerify.affectedCriteria

  if (firstVerify.failures.length > 0) {
    try {
      const retried = await callScoreModel(
        input,
        'Previous response had citations that did not appear verbatim in the source. Re-score and use only verbatim quotes.',
      )
      const aligned = alignToCriteria(retried, input.criteria)
      const retryVerify = verifyCitations(aligned, input.corpus)
      logCitationFailures(input.option, 'retry', retryVerify.failures, input.corpus)

      finalScores = aligned
      finalAffected = retryVerify.affectedCriteria
    } catch (err) {
      console.error('[score] retry failed, marking affected as citation_verification_failed:', err instanceof Error ? err.message : err)
    }
  }

  const enriched: ScoreEntry[] = finalScores.map((entry) => {
    const isFailed = finalAffected.has(normalizeCriterion(entry.criterion))
    if (isFailed) {
      return {
        criterion: entry.criterion,
        score: null,
        citations: [],
        reason: 'citation_verification_failed',
        confidence: 0,
      }
    }
    const citations = enrichCitations(entry.citations, input.corpus)
    return {
      criterion: entry.criterion,
      score: entry.score,
      citations,
      reason: entry.reason,
      confidence: computeConfidence({ score: entry.score, citations }),
    }
  })

  return { option: input.option, scores: enriched, corpusSize: input.corpus.length }
}

export async function scoreAll(input: ScoreAllInput): Promise<ScoreAllResult> {
  const limit = Number.parseInt(process.env.LIMIT_CRITERIA ?? '', 10)
  const criteria = Number.isFinite(limit) && limit > 0 ? input.criteria.slice(0, limit) : input.criteria
  if (limit > 0 && limit < input.criteria.length) {
    console.warn(`[score] LIMIT_CRITERIA=${limit} active — scoring only ${criteria.length} of ${input.criteria.length} criteria`)
  }

  const corpusA = filterCorpusForOption(input.corpus, input.optionA)
  const corpusB = filterCorpusForOption(input.corpus, input.optionB)

  const [optionA, optionB] = await Promise.all([
    scoreOption({ option: input.optionA, criteria, corpus: corpusA, model: input.model }),
    scoreOption({ option: input.optionB, criteria, corpus: corpusB, model: input.model }),
  ])

  return { optionA, optionB }
}
