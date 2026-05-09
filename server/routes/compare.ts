import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { chat } from '../clients/pipeshift.js'
import { extractCriteria } from '../extract/criteria.js'
import { fetch as fetchSource, type FetchedSource } from '../ingest/fetcher.js'
import { proposeSources } from '../ingest/sources.js'
import { store } from '../ingest/store.js'
import { verify } from '../ingest/verifier.js'
import { checkComparability } from '../stages/gate.js'

const router = Router()

const ParseResult = z.object({
  optionA: z.string().min(1),
  optionB: z.string().min(1),
  domain: z.string().min(1),
})

type ParseResult = z.infer<typeof ParseResult>

const SYSTEM_PROMPT = `You extract a structured comparison from a user's natural-language query.

Return ONLY a JSON object with exactly these keys:
- "optionA": string — the first thing being compared
- "optionB": string — the second thing being compared
- "domain": string — a short, lowercase noun phrase naming the category (e.g. "cars", "programming languages", "running shoes")

Do not include any other keys, prose, or markdown. If the query does not clearly compare two things, infer the most reasonable two options and a domain anyway.`

const JSON_ONLY = `Return only valid JSON. No prose, markdown, bullets, headings, or explanation.`

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return raw.trim()
}

function looseField(raw: string, key: keyof ParseResult): string | null {
  const match = raw.match(new RegExp(`["']${key}["']\\s*:\\s*["']([^"']+)["']`, 'i'))
  return match?.[1]?.trim() || null
}

function parseLooseJson(raw: string): unknown {
  const json = extractJson(raw)
  const optionA = looseField(json, 'optionA')
  const optionB = looseField(json, 'optionB')
  const domain = looseField(json, 'domain')
  if (optionA && optionB && domain) return { optionA, optionB, domain }
  throw new ParseJsonError(raw)
}

class ParseJsonError extends Error {
  constructor(readonly raw: string) {
    super('compare parse returned invalid JSON')
  }
}

async function parseQuery(text: string, repairRaw?: string): Promise<unknown> {
  const raw = await chat({
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: repairRaw
          ? `${JSON_ONLY}\n\nConvert this invalid comparison extraction into valid JSON only with exactly these keys: optionA, optionB, domain.\n\nUser query: ${text}\n\nInvalid output:\n${repairRaw}`
          : `${JSON_ONLY}\n\n${text}`,
      },
    ],
  })
  try {
    return JSON.parse(extractJson(raw))
  } catch {
    return parseLooseJson(raw)
  }
}

async function parseWithRetry(text: string): Promise<ParseResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return ParseResult.parse(
        await parseQuery(text, attempt === 1 && lastErr instanceof ParseJsonError ? lastErr.raw : undefined),
      )
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : 'fetch failed'
}

router.post('/', async (req: Request, res: Response) => {
  const { text } = req.body ?? {}
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' })
  }

  let parsed: ParseResult
  try {
    parsed = await parseWithRetry(text)
  } catch (err) {
    console.error('compare parse failed after retry:', err)
    return res.status(502).json({ error: 'failed to parse query' })
  }

  let gate
  try {
    gate = await checkComparability(parsed)
  } catch (err) {
    console.error('comparability check failed after retry:', err)
    return res.status(502).json({ error: 'comparability check failed' })
  }

  if (!gate.comparable) {
    return res.json({
      ...parsed,
      stage: 'gate',
      status: 'rejected',
      reason: gate.reason,
      suggestedRefinement: gate.suggestedRefinement,
    })
  }

  let proposed
  try {
    proposed = await proposeSources(parsed)
  } catch (err) {
    console.error('source proposal failed after retry:', err)
    return res.status(502).json({ error: 'source proposal failed' })
  }

  const settled = await Promise.allSettled(proposed.sources.map((source) => fetchSource(source)))
  const fetched: FetchedSource[] = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value

    return {
      ...proposed.sources[index],
      status: 'failed',
      reason: errorReason(result.reason),
      fetchedAt: new Date().toISOString(),
    }
  })
  const verified = fetched.map((item) => ({
    fetched: item,
    verification: verify(item),
  }))

  const rejected = verified
    .filter(({ verification }) => verification.status === 'rejected')
    .map(({ fetched: item, verification }) => ({
      url: item.url,
      reason: verification.reason ?? 'rejected',
    }))
  const accepted = verified.length - rejected.length
  const verifiedFacts = verified.flatMap(({ verification }) => verification.verifiedFacts)
  const acceptedChars = verified.reduce((sum, { fetched: item, verification }) => {
    if (verification.status !== 'accepted' || item.status !== 'ok') return sum
    return sum + item.content.length
  }, 0)
  const summary = {
    accepted,
    rejected,
    verifiedFacts: verifiedFacts.length,
    totalTokensApprox: Math.ceil(acceptedChars / 4),
  }
  const sources = verified.map(({ fetched: item, verification }) => ({
    url: item.url,
    tier: item.tier,
    option: item.option,
    fetchedAt: item.fetchedAt,
    status: verification.status,
    fetchStatus: item.status,
    title: item.status === 'ok' ? item.title : null,
    publishedAt: item.status === 'ok' ? item.publishedAt : null,
    reason: verification.status === 'rejected' ? verification.reason ?? null : null,
  }))

  let criteria
  try {
    criteria = await extractCriteria({ ...parsed, verified })
  } catch (err) {
    console.error('criteria extraction failed after retry:', err)
    return res.status(502).json({ error: 'criteria extraction failed' })
  }

  const comparisonId = randomUUID()

  try {
    await store({
      comparisonId,
      createdAt: new Date().toISOString(),
      comparison: { ...parsed, gate },
      proposedSources: proposed.sources,
      fetched,
      verified,
      ingestSummary: summary,
      criteria,
    })
  } catch (err) {
    console.error('corpus store failed:', err)
    return res.status(500).json({ error: 'corpus store failed' })
  }

  return res.json({
    ...parsed,
    gate,
    comparisonId,
    ingest: {
      ...summary,
      sources,
    },
    criteria,
  })
})

export default router
