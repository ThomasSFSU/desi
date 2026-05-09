import { z } from 'zod'
import { chat, CHEAP_MODEL } from '../clients/pipeshift.js'
import type { Criterion } from '../extract/criteria.js'
import type { CrossReferenceResult } from './crossReference.js'
import type { ScoreAllResult, ScoreEntry } from './score.js'

const StringList = z.preprocess((value) => {
  const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  return items.filter((item) => typeof item !== 'string' || item.trim().length > 0)
}, z.array(z.coerce.string().min(1)).default([]))

const VerdictModelResult = z.object({
  winner: z.enum(['optionA', 'optionB', 'tie']),
  confidence: z.coerce.number().min(0).max(1),
  summary: z.coerce.string().min(1),
  keyReasons: StringList,
  tradeoffs: StringList,
  caveats: StringList,
})

export type VerdictModelResult = z.infer<typeof VerdictModelResult>

export type WeightedScore = {
  option: string
  weightedAverage: number | null
  scoredWeight: number
  totalWeight: number
}

export type VerdictResult = VerdictModelResult & {
  recommendedOption: string
  scorecard: {
    optionA: WeightedScore
    optionB: WeightedScore
  }
  model: string
}

interface VerdictInput {
  optionA: string
  optionB: string
  domain: string
  criteria: Criterion[]
  scoring: ScoreAllResult
  crossReference: CrossReferenceResult
}

const SYSTEM_PROMPT = `You write the final verdict for a citation-grounded comparison engine. Use only the provided scorecard, criterion notes, and cross-reference summary. Do not invent facts, sources, prices, or capabilities. Return JSON with:
{
  "winner": "optionA" | "optionB" | "tie",
  "confidence": number from 0 to 1,
  "summary": string,
  "keyReasons": string[],
  "tradeoffs": string[],
  "caveats": string[]
}

The summary should be detailed: 2-4 short paragraphs explaining the recommendation, the evidence strength, and when a user might choose the other option.`

const JSON_ONLY = `Return only valid JSON. No prose, markdown, bullets, headings, or explanation.`

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return raw.trim()
}

function criterionWeight(criteria: Criterion[], criterion: string): number {
  return criteria.find((item) => item.name === criterion)?.weight ?? 1
}

function computeWeightedScore(option: string, scores: ScoreEntry[], criteria: Criterion[]): WeightedScore {
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0)
  let scoredWeight = 0
  let weightedTotal = 0

  for (const score of scores) {
    if (score.score === null) continue
    const weight = criterionWeight(criteria, score.criterion)
    scoredWeight += weight
    weightedTotal += score.score * weight
  }

  return {
    option,
    weightedAverage: scoredWeight === 0 ? null : Math.round((weightedTotal / scoredWeight) * 10) / 10,
    scoredWeight,
    totalWeight,
  }
}

function scoreRows(input: VerdictInput) {
  return input.criteria.map((criterion) => {
    const a = input.scoring.optionA.scores.find((score) => score.criterion === criterion.name)
    const b = input.scoring.optionB.scores.find((score) => score.criterion === criterion.name)
    return {
      criterion: criterion.name,
      weight: criterion.weight,
      description: criterion.description,
      optionA: a
        ? {
            score: a.score,
            confidence: a.confidence,
            citations: a.citations.length,
            reason: a.reason ?? null,
          }
        : null,
      optionB: b
        ? {
            score: b.score,
            confidence: b.confidence,
            citations: b.citations.length,
            reason: b.reason ?? null,
          }
        : null,
    }
  })
}

function fallbackWinner(optionA: WeightedScore, optionB: WeightedScore): VerdictModelResult['winner'] {
  if (optionA.weightedAverage === null && optionB.weightedAverage === null) return 'tie'
  if (optionA.weightedAverage === null) return 'optionB'
  if (optionB.weightedAverage === null) return 'optionA'
  const delta = optionA.weightedAverage - optionB.weightedAverage
  if (Math.abs(delta) < 0.3) return 'tie'
  return delta > 0 ? 'optionA' : 'optionB'
}

function recommendedOption(winner: VerdictModelResult['winner'], optionA: string, optionB: string): string {
  if (winner === 'optionA') return optionA
  if (winner === 'optionB') return optionB
  return 'Tie'
}

class VerdictParseError extends Error {
  constructor(
    readonly raw: string,
    readonly cause: unknown,
  ) {
    super('verdict response was not valid JSON')
  }
}

async function callVerdictModel(input: VerdictInput, scorecard: VerdictResult['scorecard'], repairRaw?: string): Promise<VerdictModelResult> {
  const payload = {
    comparison: {
      optionA: input.optionA,
      optionB: input.optionB,
      domain: input.domain,
    },
    scorecard,
    criteria: scoreRows(input),
    crossReference: input.crossReference,
  }

  const raw = await chat({
    model: CHEAP_MODEL,
    jsonMode: true,
    maxTokens: 4096,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: repairRaw
          ? `${JSON_ONLY}\n\nRepair this invalid verdict JSON using the comparison payload.\n\nComparison payload:\n${JSON.stringify(payload)}\n\nInvalid output:\n${repairRaw}`
          : `${JSON_ONLY}\n\nComparison payload:\n${JSON.stringify(payload)}`,
      },
    ],
  })

  try {
    return VerdictModelResult.parse(JSON.parse(extractJson(raw)))
  } catch (err) {
    throw new VerdictParseError(raw, err)
  }
}

export async function buildVerdict(input: VerdictInput): Promise<VerdictResult> {
  const scorecard = {
    optionA: computeWeightedScore(input.optionA, input.scoring.optionA.scores, input.criteria),
    optionB: computeWeightedScore(input.optionB, input.scoring.optionB.scores, input.criteria),
  }

  let lastRaw: string | undefined
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const modelResult = await callVerdictModel(input, scorecard, attempt === 1 ? lastRaw : undefined)
      return {
        ...modelResult,
        recommendedOption: recommendedOption(modelResult.winner, input.optionA, input.optionB),
        scorecard,
        model: CHEAP_MODEL,
      }
    } catch (err) {
      lastErr = err
      if (err instanceof VerdictParseError) lastRaw = err.raw
    }
  }

  console.error('[verdict] model verdict failed:', lastErr)
  const winner = fallbackWinner(scorecard.optionA, scorecard.optionB)
  return {
    winner,
    recommendedOption: recommendedOption(winner, input.optionA, input.optionB),
    confidence: input.crossReference.status === 'passed' ? 0.55 : 0.4,
    summary: `The smaller verdict model did not return usable JSON, so this fallback is based on the weighted scorecard only. ${scorecard.optionA.option} averaged ${scorecard.optionA.weightedAverage ?? 'no supported score'} across ${scorecard.optionA.scoredWeight}/${scorecard.optionA.totalWeight} weighted criteria, while ${scorecard.optionB.option} averaged ${scorecard.optionB.weightedAverage ?? 'no supported score'} across ${scorecard.optionB.scoredWeight}/${scorecard.optionB.totalWeight}. Treat this as a low-confidence recommendation and inspect the scored criteria and citations before relying on it.`,
    keyReasons: [],
    tradeoffs: [],
    caveats: ['Verdict model fallback was used because the small model returned invalid output.'],
    scorecard,
    model: CHEAP_MODEL,
  }
}
