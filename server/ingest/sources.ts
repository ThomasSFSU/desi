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

const SYSTEM_PROMPT = `Propose ONLY URLs you are confident exist. Strongly prefer the option's own vendor website — those pages are the most reliable to fetch.

The "option" field MUST be one of the two option names from the user message, copied verbatim. It is NEVER a URL path segment like "Reviews", "Products", or "Pricing", and never a tier label.

For each of the two options, propose 3-4 Tier 1 vendor URLs:
- The vendor root: https://{vendor-domain}/
- Universally-present paths IF you are confident they exist on this vendor: /pricing, /docs or /documentation, /features, /help.

Tier 2 review URL (optional, at most ONE per option): only if you are confident in the slug, use EXACTLY https://www.g2.com/products/{slug}/reviews. Do NOT invent any other g2.com or capterra.com path. If you are unsure of the slug, omit Tier 2.

Do NOT propose: subdomains of stackexchange.com other than stackoverflow.com; specific article URLs; press release paths; deep links you cannot verify; reddit URLs (their HTML is unreadable to scrapers).

Never repeat the same URL. 3-5 sources per option is enough.

Output exactly ONE top-level JSON object with a single "sources" array containing URLs for BOTH options interleaved or in sequence — never two separate "sources" keys. Shape: {"sources":[{"url":"https://...","tier":1,"option":"<exact option name>"}, ...]}.

Worked example for "Notion vs Obsidian":
{"sources":[
  {"url":"https://www.notion.so/","tier":1,"option":"Notion"},
  {"url":"https://www.notion.so/pricing","tier":1,"option":"Notion"},
  {"url":"https://www.notion.so/help","tier":1,"option":"Notion"},
  {"url":"https://obsidian.md/","tier":1,"option":"Obsidian"},
  {"url":"https://obsidian.md/pricing","tier":1,"option":"Obsidian"},
  {"url":"https://help.obsidian.md/","tier":1,"option":"Obsidian"}
]}`

const JSON_ONLY = `Return only valid JSON. No prose, markdown, bullets, headings, or explanation. Each "option" value must be one of the two option names from the user message, copied verbatim — never a URL path segment.`

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return raw.trim()
}

function mergeDuplicateSourcesKeys(json: string): string {
  const matches = [...json.matchAll(/"sources"\s*:\s*\[([\s\S]*?)\]/g)]
  if (matches.length < 2) return json
  const merged = matches
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(',')
  return `{"sources":[${merged}]}`
}

function extractSourceObjects(raw: string): unknown[] {
  const objects: unknown[] = []
  const pattern = /\{\s*"url"\s*:\s*"[^"]+"\s*,[^{}]*\}|\{[^{}]*"url"\s*:\s*"[^"]+"[^{}]*\}/g
  for (const match of raw.matchAll(pattern)) {
    try {
      objects.push(JSON.parse(match[0]))
    } catch {
      // skip malformed object fragments
    }
  }
  return objects
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
): string | null {
  const haystack = `${line} ${url}`.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (haystack.includes(optionSlug(input.optionA))) return input.optionA
  if (haystack.includes(optionSlug(input.optionB))) return input.optionB
  return currentOption
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
      const option = inferOption(line, url, input, currentOption)
      if (!option) continue
      sources.push({
        url,
        tier: inferTier(line, url, currentTier),
        option,
      })
    }
  }

  return SourcesResult.parse({ sources: dedupeSources(sources) })
}

function isPlausibleUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname

  if (host === 'www.g2.com' || host === 'g2.com') {
    return /^\/products\/[a-z0-9-]+(?:\/reviews)?\/?$/i.test(path)
  }
  if (host === 'www.capterra.com' || host === 'capterra.com') {
    return /^\/p\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\/?$/i.test(path)
  }
  if (host === 'www.reddit.com' || host === 'reddit.com' || host.endsWith('.reddit.com')) {
    return false
  }
  if (host.endsWith('stackexchange.com') && host !== 'stackexchange.com') {
    return false
  }
  return true
}

function reattributeByUrl(source: Source, input: ProposeSourcesInput): Source | null {
  const normalized = normalizeOption(source.option)
  if (normalized === normalizeOption(input.optionA)) return { ...source, option: input.optionA }
  if (normalized === normalizeOption(input.optionB)) return { ...source, option: input.optionB }

  const haystack = source.url.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const slugA = optionSlug(input.optionA)
  const slugB = optionSlug(input.optionB)
  if (slugA && haystack.includes(slugA)) return { ...source, option: input.optionA }
  if (slugB && haystack.includes(slugB)) return { ...source, option: input.optionB }
  return null
}

function parseSources(raw: string, input: ProposeSourcesInput): SourcesResult {
  let parsed: SourcesResult | null = null
  try {
    parsed = SourcesResult.parse(JSON.parse(mergeDuplicateSourcesKeys(extractJson(raw))))
  } catch {
    const objects = extractSourceObjects(raw)
    if (objects.length > 0) {
      try {
        parsed = SourcesResult.parse({ sources: objects })
      } catch {
        // fall through to parseUrlList
      }
    }
  }

  if (!parsed) {
    if (/https?:\/\//.test(raw)) return parseUrlList(raw, input)
    throw new Error('source proposal could not be parsed')
  }

  const reattributed = parsed.sources
    .filter((source) => isPlausibleUrl(source.url))
    .map((source) => reattributeByUrl(source, input))
    .filter((source): source is Source => source !== null)
  return { sources: dedupeSources(reattributed) }
}

const MIN_SOURCES_PER_OPTION = 1

function normalizeOption(option: string): string {
  return option.toLowerCase().trim()
}

function countSourcesByOption(result: SourcesResult): Map<string, number> {
  const counts = new Map<string, number>()
  for (const source of result.sources) {
    const key = normalizeOption(source.option)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function underfilledOptions(
  counts: Map<string, number>,
  input: ProposeSourcesInput,
): string[] {
  return [input.optionA, input.optionB].filter(
    (option) => (counts.get(normalizeOption(option)) ?? 0) < MIN_SOURCES_PER_OPTION,
  )
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
          ? `${JSON_ONLY}\n\nYour previous response was rejected. Common issues to check:\n- The "option" field must be exactly "${input.optionA}" or "${input.optionB}" — not a URL path word like "Reviews" or "Pricing".\n- Both options need at least ${MIN_SOURCES_PER_OPTION} sources.\n- Do NOT repeat the same URL.\n\nOption A: ${input.optionA}\nOption B: ${input.optionB}\nDomain: ${input.domain}`
          : `${JSON_ONLY}\n\nOption A: ${input.optionA}\nOption B: ${input.optionB}\nDomain: ${input.domain}`,
      },
    ],
  })
  try {
    const parsed = parseSources(raw, input)
    const counts = countSourcesByOption(parsed)
    const underfilled = underfilledOptions(counts, input)
    if (underfilled.length > 0) {
      console.warn(
        '[proposeSources] underfilled options',
        {
          required: MIN_SOURCES_PER_OPTION,
          underfilled,
          counts: Object.fromEntries(counts),
        },
      )
      throw new SourceParseError(
        raw,
        new Error(
          `insufficient sources (need >= ${MIN_SOURCES_PER_OPTION}) for ${underfilled.join(', ')}`,
        ),
      )
    }
    return parsed
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
