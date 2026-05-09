import { z } from 'zod'
import { chat, CHEAP_MODEL } from '../clients/pipeshift.js'

export const GateResult = z.object({
  comparable: z.boolean(),
  reason: z.string().nullable(),
  suggestedRefinement: z.string().nullable(),
})

export type GateResult = z.infer<typeof GateResult>

interface GateInput {
  optionA: string
  optionB: string
  domain: string
}

const SYSTEM_PROMPT = `You are a strict gatekeeper for a comparison engine. Given two options and a domain, decide if a meaningful comparison is possible. Return JSON {comparable: boolean, reason: string, suggestedRefinement: string | null}. Reject if: the options are not real distinct entities; they belong to fundamentally different categories; the query is too vague; one option is a superset of the other. Be strict — false positives are worse than false negatives.`

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return raw.trim()
}

export async function checkComparability({ optionA, optionB, domain }: GateInput): Promise<GateResult> {
  const userMessage = `Option A: ${optionA}\nOption B: ${optionB}\nDomain: ${domain}`

  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await chat({
        model: CHEAP_MODEL,
        jsonMode: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      })
      return GateResult.parse(JSON.parse(extractJson(raw)))
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}
