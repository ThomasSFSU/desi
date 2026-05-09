// HydraDB client — stores and retrieves the ingested corpus as a queryable
// context layer. The Ingest stage writes documents in; Extract Criteria,
// Score, and Cross-Reference query against it during a comparison.
//
// TODO: implement upsert(documents) called from the Ingest stage
// TODO: implement query({ filter, topK }) for retrieval-by-criteria
// TODO: implement namespace strategy (per-comparison vs shared corpus)

const apiKey = process.env.HYDRADB_API_KEY

export const hydra = {
  configured: Boolean(apiKey),
}
