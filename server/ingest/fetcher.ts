import { createHash } from 'node:crypto'
import type { Source } from './sources.js'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const TIMEOUT_MS = 20_000

export type FetchFailed = Source & {
  status: 'failed'
  reason: string
  fetchedAt: string
}

export type FetchOk = Source & {
  status: 'ok'
  fetchedAt: string
  title: string
  content: string
  publishedAt: string | null
  contentHash: string
}

export type FetchedSource = FetchFailed | FetchOk

async function parseHtml(html: string, url: string): Promise<{
  title: string
  content: string
  publishedAt: string | null
}> {
  const [{ Readability }, { JSDOM, VirtualConsole }] = await Promise.all([
    import('@mozilla/readability'),
    import('jsdom'),
  ])
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (err) => {
    if (err?.message?.includes('Could not parse CSS')) return
    console.error(err)
  })
  const dom = new JSDOM(html, { url, virtualConsole })
  const document = dom.window.document
  const publishedAt = extractPublishedAt(document)
  const article = new Readability(document.cloneNode(true) as Document).parse()
  const content = normalizeContent(article?.textContent ?? document.body?.textContent ?? '')
  const title = (article?.title || document.title || url).trim()

  return { title, content, publishedAt }
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function firstDatePublished(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstDatePublished(item)
      if (found) return found
    }
    return null
  }

  const record = value as Record<string, unknown>
  const direct = toIsoDate(record.datePublished)
  if (direct) return direct

  for (const child of Object.values(record)) {
    const found = firstDatePublished(child)
    if (found) return found
  }

  return null
}

function extractPublishedAt(document: Document): string | null {
  const metaDate = toIsoDate(
    document.querySelector('meta[property="article:published_time"]')?.getAttribute('content'),
  )
  if (metaDate) return metaDate

  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const text = script.textContent?.trim()
    if (!text) continue

    try {
      const found = firstDatePublished(JSON.parse(text))
      if (found) return found
    } catch {
      // Ignore invalid JSON-LD and keep looking for dates elsewhere.
    }
  }

  return toIsoDate(document.querySelector('time[datetime]')?.getAttribute('datetime'))
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function fetch(source: Source): Promise<FetchedSource> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await globalThis.fetch(source.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      return {
        ...source,
        status: 'failed',
        reason: `HTTP ${response.status}`,
        fetchedAt: new Date().toISOString(),
      }
    }

    const { title, content, publishedAt } = await parseHtml(await response.text(), source.url)

    return {
      ...source,
      status: 'ok',
      fetchedAt: new Date().toISOString(),
      title,
      content,
      publishedAt,
      contentHash: contentHash(content),
    }
  } catch (err) {
    const reason =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'timeout after 10s'
        : err instanceof Error
          ? err.message
          : 'fetch failed'

    return {
      ...source,
      status: 'failed',
      reason,
      fetchedAt: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}
