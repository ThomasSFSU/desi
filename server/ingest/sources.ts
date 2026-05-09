import { z } from 'zod'
import { CHEAP_MODEL, pipeshift } from '../clients/pipeshift.js'

export const SourceTier = z.preprocess((value) => {
  if (typeof value === 'string') {
    const match = value.match(/[123]/)
    if (match) return Number(match[0])
  }
  return value
}, z.union([z.literal(1), z.literal(2), z.literal(3)]))

export const Source = z.object({
  url: z.string().url(),
  tier: SourceTier,
  option: z.string().min(1),
})

export const SourcesResult = z.object({
  sources: z.array(Source).min(1),
})

export type SourceTier = z.infer<typeof SourceTier>
export type Source = z.infer<typeof Source>
export type SourcesResult = z.infer<typeof SourcesResult>

interface ProposeSourcesInput {
  optionA: string
  optionB: string
  domain: string
}

const SYSTEM_PROMPT = `For each of two options being compared, propose canonical source URLs in three tiers. Tier 1 = vendor's own current pages (homepage, pricing, docs, changelog). Tier 2 = structured third-party review sites (G2, Capterra). Tier 3 = community discussion (Reddit subreddit, HN search results URL). Output JSON: {sources: [{url, tier, option}]}. Use real URL patterns you know. Aim for 5-8 sources per option. Do not invent URLs you're unsure of.`

const JSON_ONLY = `Return only valid JSON. No prose, markdown, bullets, headings, or explanation. The only valid shape is {"sources":[{"url":"https://example.com","tier":1,"option":"Option name"}]}.`

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return raw.trim()
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = `${source.option.toLowerCase()}::${source.tier}::${source.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function cleanUrl(url: string): string {
  return url.replace(/[),.;\]}]+$/g, '')
}

function optionSlug(option: string): string {
  return option.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function inferTier(line: string, url: string, currentTier: SourceTier | null): SourceTier {
  const tierMatch = line.match(/tier\s*([123])/i)
  if (tierMatch) return Number(tierMatch[1]) as SourceTier

  const host = new URL(url).hostname.toLowerCase()
  if (host.includes('g2.com') || host.includes('capterra.com')) return 2
  if (
    host.includes('reddit.com') ||
    host.includes('ycombinator.com') ||
    host.includes('news.ycombinator.com') ||
    host.includes('hn.algolia.com')
  ) {
    return 3
  }

  return currentTier ?? 1
}

function inferOption(
  line: string,
  url: string,
  input: ProposeSourcesInput,
  currentOption: string | null,
): string {
  const haystack = `${line} ${url}`.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (haystack.includes(optionSlug(input.optionA))) return input.optionA
  if (haystack.includes(optionSlug(input.optionB))) return input.optionB
  return currentOption ?? input.optionA
}

function parseUrlList(raw: string, input: ProposeSourcesInput): SourcesResult {
  const sources: Source[] = []
  let currentOption: string | null = null
  let currentTier: SourceTier | null = null

  for (const line of raw.split(/\r?\n/)) {
    const lower = line.toLowerCase()
    if (lower.includes(input.optionA.toLowerCase())) currentOption = input.optionA
    if (lower.includes(input.optionB.toLowerCase())) currentOption = input.optionB

    const tierMatch = line.match(/tier\s*([123])/i)
    if (tierMatch) currentTier = Number(tierMatch[1]) as SourceTier

    const urls = line.match(/https?:\/\/[^\s<>"']+/g) ?? []
    for (const matchedUrl of urls) {
      const url = cleanUrl(matchedUrl)
      sources.push({
        url,
        tier: inferTier(line, url, currentTier),
        option: inferOption(line, url, input, currentOption),
      })
    }
  }

  return SourcesResult.parse({ sources: dedupeSources(sources) })
}

function parseSources(raw: string, input: ProposeSourcesInput): SourcesResult {
  try {
    const parsed = SourcesResult.parse(JSON.parse(extractJson(raw)))
    return { sources: dedupeSources(parsed.sources) }
  } catch (err) {
    if (/https?:\/\//.test(raw)) return parseUrlList(raw, input)
    throw err
  }
}

async function proposeSourcesOnce(input: ProposeSourcesInput, repairRaw?: string): Promise<SourcesResult> {
  const raw = await pipeshift.chat({
    model: CHEAP_MODEL,
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: repairRaw
          ? `${JSON_ONLY}\n\nConvert this invalid source proposal into valid JSON only.\n\nOption A: ${input.optionA}\nOption B: ${input.optionB}\nDomain: ${input.domain}\n\nInvalid output:\n${repairRaw}`
          : `${JSON_ONLY}\n\nOption A: ${input.optionA}\nOption B: ${input.optionB}\nDomain: ${input.domain}`,
      },
    ],
  })
  try {
    return parseSources(raw, input)
  } catch (err) {
    if (!repairRaw) throw new SourceParseError(raw, err)
    throw err
  }
}

class SourceParseError extends Error {
  constructor(
    readonly raw: string,
    readonly cause: unknown,
  ) {
    super('source proposal was not valid JSON')
  }
}

export async function proposeSources(input: ProposeSourcesInput): Promise<SourcesResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await proposeSourcesOnce(
        input,
        attempt === 1 && lastErr instanceof SourceParseError ? lastErr.raw : undefined,
      )
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}
