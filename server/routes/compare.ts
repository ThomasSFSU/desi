import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { chat } from '../clients/pipeshift.js'
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

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return raw.trim()
}

async function parseQuery(text: string): Promise<unknown> {
  const raw = await chat({
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  })
  return JSON.parse(extractJson(raw))
}

async function parseWithRetry(text: string): Promise<ParseResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return ParseResult.parse(await parseQuery(text))
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
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

  return res.json({ ...parsed, gate })
})

export default router
