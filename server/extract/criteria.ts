import { z } from 'zod'
import { CHEAP_MODEL, pipeshift } from '../clients/pipeshift.js'
import type { FetchedSource } from '../ingest/fetcher.js'
import type { VerificationResult } from '../ingest/verifier.js'

const StringArray = z.preprocess((value) => {
  const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  return items.filter((item) => typeof item !== 'string' || item.trim().length > 0)
}, z.array(z.coerce.string().min(1)))

function sourceValues(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return (
    record.sources ??
    record.sourceUrls ??
    record.sourceURLS ??
    record.sourceUrl ??
    record.citations ??
    record.references ??
    record.evidence ??
    []
  )
}

function criterionValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const name = record.name ?? record.criterion ?? record.title ?? record.id

  return {
    ...record,
    id: record.id ?? name,
    name,
    description:
      record.description ??
      record.rationale ??
      record.reason ??
      record.summary ??
      `Decision criterion: ${String(name ?? 'unknown')}`,
    weight: record.weight ?? record.importance ?? record.priority ?? 3,
    signals: record.signals ?? record.signal ?? record.factors ?? record.evidenceSignals ?? [],
    sources: sourceValues(record),
  }
}

const Criterion = z.preprocess(criterionValue, z.object({
  id: z.coerce.string().min(1),
  name: z.coerce.string().min(2),
  description: z.coerce.string().min(10),
  weight: z.coerce.number().min(1).max(5),
  signals: StringArray.transform((values) => values.slice(0, 6)),
  sources: z.preprocess(sourceValues, StringArray),
}))

const CriteriaResult = z.object({
  criteria: z.array(Criterion).max(8),
  notes: StringArray.default([]),
})

export type Criterion = z.infer<typeof Criterion>
export type CriteriaResult = z.infer<typeof CriteriaResult>

interface ExtractCriteriaInput {
  optionA: string
  optionB: string
  domain: string
  verified: Array<{
    fetched: FetchedSource
    verification: VerificationResult
  }>
}

export type CriteriaSummary = CriteriaResult & {
  sourceCount: number
  totalTokensApprox: number
}

const SYSTEM_PROMPT = `You extract decision criteria for a comparison engine. Given two options, a domain, and source snippets, return option-neutral criteria that should be used later for scoring. Do not score either option. Use only the provided snippets. Return JSON: {criteria: [{id, name, description, weight, signals, sources}], notes}. Criteria should be practical, non-overlapping, and grounded in the source URLs. Weight is 1-5. Aim for 4-8 criteria.`

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

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

function acceptedSources(input: ExtractCriteriaInput): Array<FetchedSource & { status: 'ok' }> {
  return input.verified
    .filter(({ fetched, verification }) => fetched.status === 'ok' && verification.status === 'accepted')
    .map(({ fetched }) => fetched as FetchedSource & { status: 'ok' })
}

function buildSourceText(sources: Array<FetchedSource & { status: 'ok' }>): string {
  let used = 0
  const blocks: string[] = []

  for (const source of sources) {
    if (used >= MAX_TOTAL_CHARS) break
    const remaining = MAX_TOTAL_CHARS - used
    const excerpt = source.content.slice(0, Math.min(MAX_SOURCE_CHARS, remaining))
    used += excerpt.length
    blocks.push(
      [
        `URL: ${source.url}`,
        `Option: ${source.option}`,
        `Tier: ${source.tier}`,
        `Title: ${source.title}`,
        `Published: ${source.publishedAt ?? 'unknown'}`,
        `Content: ${excerpt}`,
      ].join('\n'),
    )
  }

  return blocks.join('\n\n---\n\n')
}

function normalize(result: CriteriaResult, allowedUrls: Set<string>): CriteriaResult {
  const seen = new Set<string>()
  const fallbackSources = Array.from(allowedUrls)
  const criteria = result.criteria
    .map((criterion) => {
      const sources = Array.from(new Set(criterion.sources.filter((url) => allowedUrls.has(url))))
      return {
        ...criterion,
        id: slug(criterion.id || criterion.name),
        sources: sources.length > 0 ? sources : fallbackSources,
      }
    })
    .filter((criterion) => {
      const key = criterion.id || slug(criterion.name)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return { criteria, notes: result.notes }
}

class CriteriaParseError extends Error {
  constructor(
    readonly raw: string,
    readonly cause: unknown,
  ) {
    super('criteria extraction was not valid JSON')
  }
}

async function callModel(
  input: ExtractCriteriaInput,
  sources: Array<FetchedSource & { status: 'ok' }>,
  repairRaw?: string,
): Promise<CriteriaResult> {
  const sourceText = buildSourceText(sources)
  const raw = await pipeshift.chat({
    model: CHEAP_MODEL,
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: repairRaw
          ? `${JSON_ONLY}\n\nConvert this invalid criteria extraction into valid JSON only.\n\nInvalid output:\n${repairRaw}`
          : `${JSON_ONLY}\n\nOption A: ${input.optionA}\nOption B: ${input.optionB}\nDomain: ${input.domain}\n\nSources:\n${sourceText}`,
      },
    ],
  })

  try {
    return CriteriaResult.parse(JSON.parse(extractJson(raw)))
  } catch (err) {
    throw new CriteriaParseError(raw, err)
  }
}

export async function extractCriteria(input: ExtractCriteriaInput): Promise<CriteriaSummary> {
  const sources = acceptedSources(input)
  const totalChars = sources.reduce((sum, source) => sum + source.content.length, 0)

  if (sources.length === 0) {
    return {
      criteria: [],
      notes: ['No accepted readable sources available for criteria extraction.'],
      sourceCount: 0,
      totalTokensApprox: 0,
    }
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callModel(
        input,
        sources,
        attempt === 1 && lastErr instanceof CriteriaParseError ? lastErr.raw : undefined,
      )
      const allowedUrls = new Set(sources.map((source) => source.url))
      return {
        ...normalize(result, allowedUrls),
        sourceCount: sources.length,
        totalTokensApprox: Math.ceil(Math.min(totalChars, MAX_TOTAL_CHARS) / 4),
      }
    } catch (err) {
      lastErr = err
    }
  }

  throw lastErr
}
