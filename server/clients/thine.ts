// Thine client — structured memory across comparisons. Persists prior verdicts,
// extracted criteria, and source rankings so future runs can reference past
// judgments (e.g. "we previously favored X for criterion Y because Z").
//
// TODO: implement remember(comparisonId, payload) to persist a finished run
// TODO: implement recall({ optionA, optionB, domain }) for similar-run lookup
// TODO: implement schema for criteria reuse across comparisons

const apiKey = process.env.THINE_API_KEY

export const thine = {
  configured: Boolean(apiKey),
}
