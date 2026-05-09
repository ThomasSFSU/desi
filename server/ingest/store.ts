import { readFile, writeFile } from 'node:fs/promises'

export interface Corpus {
  comparisonId: string
  [key: string]: unknown
}

function corpusPath(comparisonId: string): string {
  return `/tmp/desi-corpus-${comparisonId}.json`
}

export async function store(corpus: Corpus): Promise<void> {
  // TODO: swap for HydraDB.
  await writeFile(corpusPath(corpus.comparisonId), JSON.stringify(corpus, null, 2), 'utf8')
}

export async function load(comparisonId: string): Promise<Corpus> {
  const raw = await readFile(corpusPath(comparisonId), 'utf8')
  return JSON.parse(raw) as Corpus
}
