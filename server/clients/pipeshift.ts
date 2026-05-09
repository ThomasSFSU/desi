// Pipeshift client — long-context model inference + the NLP parse step that
// turns a raw user prompt into { optionA, optionB, domain }. Downstream stages
// (Extract Criteria, Score, Verdict) will also call into this for inference.
//
// TODO: implement parse(text): Promise<{ optionA, optionB, domain }>
// TODO: implement infer({ system, prompt, contextDocs, ... }) for long-context calls
// TODO: wire request signing / retry / timeout policy

const apiKey = process.env.PIPESHIFT_API_KEY

export const pipeshift = {
  configured: Boolean(apiKey),
}
