import type { Criterion } from '../extract/criteria.js'
import type { ScoreAllResult, ScoreEntry } from './score.js'

export type CrossReferenceIssue = {
  level: 'info' | 'warning'
  option: string
  criterion: string
  message: string
}

export type CrossReferenceResult = {
  status: 'passed' | 'needs_review'
  checkedCells: number
  citedCells: number
  uncitedScores: number
  insufficientEvidence: number
  averageConfidence: number
  issues: CrossReferenceIssue[]
  summary: string
}

interface CrossReferenceInput {
  criteria: Criterion[]
  scoring: ScoreAllResult
}

function findScore(scores: ScoreEntry[], criterion: string): ScoreEntry | undefined {
  return scores.find((entry) => entry.criterion === criterion)
}

export function crossReferenceScores({ criteria, scoring }: CrossReferenceInput): CrossReferenceResult {
  const issues: CrossReferenceIssue[] = []
  let checkedCells = 0
  let citedCells = 0
  let uncitedScores = 0
  let insufficientEvidence = 0
  let confidenceTotal = 0
  let confidenceCount = 0

  const options = [
    { label: scoring.optionA.option, scores: scoring.optionA.scores },
    { label: scoring.optionB.option, scores: scoring.optionB.scores },
  ]

  for (const criterion of criteria) {
    for (const option of options) {
      checkedCells += 1
      const entry = findScore(option.scores, criterion.name)
      if (!entry) {
        insufficientEvidence += 1
        issues.push({
          level: 'warning',
          option: option.label,
          criterion: criterion.name,
          message: 'No score returned for this criterion.',
        })
        continue
      }

      if (entry.score === null) {
        insufficientEvidence += 1
        issues.push({
          level: 'info',
          option: option.label,
          criterion: criterion.name,
          message: entry.reason === 'citation_verification_failed'
            ? 'Citation sanity check failed; score withheld.'
            : 'Insufficient evidence for a supported score.',
        })
        continue
      }

      confidenceTotal += entry.confidence
      confidenceCount += 1

      if (entry.citations.length > 0) {
        citedCells += 1
      } else {
        uncitedScores += 1
        issues.push({
          level: 'warning',
          option: option.label,
          criterion: criterion.name,
          message: 'Score has no supporting citation.',
        })
      }

      if (entry.confidence < 0.4) {
        issues.push({
          level: 'info',
          option: option.label,
          criterion: criterion.name,
          message: 'Low citation confidence.',
        })
      }
    }
  }

  const averageConfidence = confidenceCount === 0
    ? 0
    : Math.round((confidenceTotal / confidenceCount) * 100) / 100
  const warningCount = issues.filter((issue) => issue.level === 'warning').length
  const status = warningCount > 0 ? 'needs_review' : 'passed'
  const summary = status === 'passed'
    ? `Checked ${checkedCells} score cells for criteria coverage, citations, and confidence. No blocking issues found.`
    : `Checked ${checkedCells} score cells and found ${warningCount} item${warningCount === 1 ? '' : 's'} that need review before relying on the verdict.`

  return {
    status,
    checkedCells,
    citedCells,
    uncitedScores,
    insufficientEvidence,
    averageConfidence,
    issues: issues.slice(0, 8),
    summary,
  }
}
