import type { EmbeddingProvider } from '../config/embedding.js'
import { embedQuery } from '../services/embeddingApiClient.js'
import { cosineSimilarityVectors, fallbackEmbedding } from './embeddingService.js'
import type { RetrievalDocument } from './textRetrieval.js'
import { keywordOverlapScore, tokenize } from './textRetrieval.js'

function buildHaystack(doc: RetrievalDocument) {
  return `${doc.documentName} ${doc.content}`
}

export async function scoreDocumentsByVector(
  query: string,
  documents: RetrievalDocument[],
  method: 'semantic' | 'keyword' | 'hybrid',
): Promise<{
  results: Array<RetrievalDocument & { score: number }>
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
}> {
  if (!documents.length) {
    return {
      results: [],
      embeddingProvider: 'local',
      embeddingModel: 'local-hash-v1',
    }
  }

  const queryResult = await embedQuery(query)

  const results = documents.map((doc) => {
    const haystack = buildHaystack(doc)
    const docEmbedding = doc.embedding ?? fallbackEmbedding(haystack)
    const semantic = cosineSimilarityVectors(queryResult.embedding, docEmbedding)
    const keyword = keywordOverlapScore(query, haystack)

    let score = semantic
    if (method === 'keyword') score = keyword
    if (method === 'hybrid') score = semantic * 0.7 + keyword * 0.3

    const phraseBonus =
      query.trim().length >= 2 && haystack.toLowerCase().includes(query.trim().toLowerCase())
        ? 0.08
        : 0

    const tokenBonus =
      tokenize(query).some((token) => haystack.toLowerCase().includes(token)) ? 0.04 : 0

    return {
      ...doc,
      score: Number(Math.min(0.99, score + phraseBonus + tokenBonus).toFixed(4)),
    }
  })

  return {
    results,
    embeddingProvider: queryResult.provider,
    embeddingModel: queryResult.model,
  }
}
