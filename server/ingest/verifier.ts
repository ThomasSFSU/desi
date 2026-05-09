import type { FetchedSource } from './fetcher.js'

export type VerificationResult = {
  status: 'accepted' | 'rejected'
  reason?: string
  verifiedFacts: string[]
}

const PRICING_RE = /[$€£]\s?\d+(?:[.,]\d+)?(?:\s?\/\s?\w+)?/g

function monthsAgo(months: number): Date {
  const date = new Date()
  date.setMonth(date.getMonth() - months)
  return date
}

function extractPricingFacts(fetched: FetchedSource): string[] {
  if (fetched.status !== 'ok' || fetched.tier !== 1) return []
  return Array.from(new Set(fetched.content.match(PRICING_RE) ?? []))
}

export function verify(fetched: FetchedSource): VerificationResult {
  const verifiedFacts = extractPricingFacts(fetched)

  if (fetched.status === 'failed') {
    return {
      status: 'rejected',
      reason: fetched.reason,
      verifiedFacts,
    }
  }

  if (!fetched.content.trim()) {
    return {
      status: 'rejected',
      reason: 'no readable content',
      verifiedFacts,
    }
  }

  if (fetched.tier === 1) {
    return { status: 'accepted', verifiedFacts }
  }

  if (fetched.content.length < 500) {
    return {
      status: 'rejected',
      reason: 'content under 500 chars',
      verifiedFacts,
    }
  }

  if (!fetched.publishedAt) {
    return {
      status: 'rejected',
      reason: `tier ${fetched.tier} source missing publication date`,
      verifiedFacts,
    }
  }

  const publishedAt = new Date(fetched.publishedAt)
  if (Number.isNaN(publishedAt.getTime())) {
    return {
      status: 'rejected',
      reason: 'invalid publication date',
      verifiedFacts,
    }
  }

  if (fetched.tier === 3 && publishedAt < monthsAgo(18)) {
    return {
      status: 'rejected',
      reason: 'tier 3 source older than 18 months',
      verifiedFacts,
    }
  }

  if (fetched.tier === 2 && publishedAt < monthsAgo(24)) {
    return {
      status: 'rejected',
      reason: 'tier 2 source older than 24 months',
      verifiedFacts,
    }
  }

  return { status: 'accepted', verifiedFacts }
}
