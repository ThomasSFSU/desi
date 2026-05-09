import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { chat, CHEAP_MODEL } from '../clients/pipeshift.js'
import { extractCriteria } from '../extract/criteria.js'
import { fetch as fetchSource, type FetchedSource } from '../ingest/fetcher.js'
import { proposeSources } from '../ingest/sources.js'
import { store } from '../ingest/store.js'
import { verify } from '../ingest/verifier.js'
import { checkComparability } from '../stages/gate.js'
import { scoreAll, type ScoreEntry } from '../stages/score.js'

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
  const { text, thinking } = req.body ?? {}
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' })
  }
  const thinkingMode = thinking === true

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event: Record<string, unknown>) => {
    res.write(JSON.stringify(event) + '\n')
  }

  let parsed: ParseResult
  try {
    parsed = await parseWithRetry(text)
    send({ type: 'parsed', data: parsed })
  } catch (err) {
    console.error('compare parse failed after retry:', err)
    send({ type: 'fatal', stage: 'parse', reason: errorReason(err) })
    return res.end()
  }

  let gate
  try {
    gate = await checkComparability(parsed)
    send({ type: 'gate', data: gate })
  } catch (err) {
    console.error('comparability check failed after retry:', err)
    send({ type: 'fatal', stage: 'gate', reason: errorReason(err) })
    return res.end()
  }

  if (!gate.comparable) {
    send({
      type: 'rejected',
      data: {
        stage: 'gate',
        reason: gate.reason,
        suggestedRefinement: gate.suggestedRefinement,
      },
    })
    return res.end()
  }

  const pipelineStatus: { failedStage: string | null; reason: string | null } = {
    failedStage: null,
    reason: null,
  }

  let proposed
  try {
    proposed = await proposeSources(parsed)
  } catch (err) {
    console.error('source proposal failed after retry:', err)
    pipelineStatus.failedStage = 'Ingest'
    pipelineStatus.reason = errorReason(err)
  }

  let summary: { accepted: number; rejected: Array<{ url: string; reason: string }>; verifiedFacts: number; totalTokensApprox: number } | undefined
  let sources: Array<unknown> | undefined
  let verified: Array<{ fetched: FetchedSource; verification: ReturnType<typeof verify> }> = []
  let fetched: FetchedSource[] = []

  if (proposed) {
    const settled = await Promise.allSettled(proposed.sources.map((source) => fetchSource(source)))
    fetched = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value
      return {
        ...proposed.sources[index],
        status: 'failed',
        reason: errorReason(result.reason),
        fetchedAt: new Date().toISOString(),
      }
    })
    verified = fetched.map((item) => ({
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
    summary = {
      accepted,
      rejected,
      verifiedFacts: verifiedFacts.length,
      totalTokensApprox: Math.ceil(acceptedChars / 4),
    }
    sources = verified.map(({ fetched: item, verification }) => ({
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

    send({ type: 'ingest', data: { ...summary, sources } })
  } else {
    send({ type: 'pipelineFailure', data: { failedStage: pipelineStatus.failedStage, reason: pipelineStatus.reason } })
  }

  let criteria
  if (!pipelineStatus.failedStage) {
    try {
      criteria = await extractCriteria({ ...parsed, verified })
      send({ type: 'criteria', data: criteria })
    } catch (err) {
      console.error('criteria extraction failed after retry:', err)
      pipelineStatus.failedStage = 'Extract Criteria'
      pipelineStatus.reason = errorReason(err)
      send({ type: 'pipelineFailure', data: { failedStage: pipelineStatus.failedStage, reason: pipelineStatus.reason } })
    }
  }

  let scoring
  let scoringResponse
  if (!pipelineStatus.failedStage && criteria) {
    try {
      scoring = await scoreAll({
        optionA: parsed.optionA,
        optionB: parsed.optionB,
        criteria: criteria.criteria,
        corpus: verified,
        model: thinkingMode ? undefined : CHEAP_MODEL,
      })
      const perCriterion = criteria.criteria.map((criterion) => {
        const a = scoring!.optionA.scores.find((s: ScoreEntry) => s.criterion === criterion.name)
        const b = scoring!.optionB.scores.find((s: ScoreEntry) => s.criterion === criterion.name)
        return {
          criterion: criterion.name,
          weight: criterion.weight,
          a: a
            ? {
                score: a.score,
                confidence: a.confidence,
                citationCount: a.citations.length,
                reason: a.reason,
              }
            : null,
          b: b
            ? {
                score: b.score,
                confidence: b.confidence,
                citationCount: b.citations.length,
                reason: b.reason,
              }
            : null,
        }
      })
      scoringResponse = {
        optionA: scoring.optionA,
        optionB: scoring.optionB,
        perCriterion,
      }
      send({ type: 'scoring', data: scoringResponse })
    } catch (err) {
      console.error('scoring failed:', err)
      pipelineStatus.failedStage = 'Score'
      pipelineStatus.reason = errorReason(err)
      send({ type: 'pipelineFailure', data: { failedStage: pipelineStatus.failedStage, reason: pipelineStatus.reason } })
    }
  }

  const comparisonId = randomUUID()

  try {
    await store({
      comparisonId,
      createdAt: new Date().toISOString(),
      comparison: { ...parsed, gate },
      proposedSources: proposed?.sources ?? [],
      fetched,
      verified,
      ingestSummary: summary,
      criteria,
      scoring,
      pipelineStatus,
      thinkingMode,
    })
  } catch (err) {
    console.error('corpus store failed:', err)
  }

  send({ type: 'done', data: { comparisonId, thinkingMode, usedLighterModel: !thinkingMode } })
  return res.end()
})

export default router
