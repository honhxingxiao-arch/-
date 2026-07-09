import { keywordOverlapScore } from './textRetrieval.js'
import type { RetrievalDocument } from './textRetrieval.js'

const RERANK_POOL_MULTIPLIER = 3
const RERANK_POOL_MIN = 12
const RERANK_POOL_MAX = 40

export function rerankPoolSize(topK: number, candidateTotal: number): number {
  return Math.min(RERANK_POOL_MAX, Math.max(RERANK_POOL_MIN, topK * RERANK_POOL_MULTIPLIER, candidateTotal))
}

export function rerankDocuments(
  query: string,
  documents: Array<RetrievalDocument & { score: number }>,
  topK: number,
): Array<RetrievalDocument & { score: number }> {
  if (!documents.length) return []

  const poolSize = rerankPoolSize(topK, documents.length)
  const pool = documents.slice(0, poolSize)

  const reranked = pool
    .map((doc) => {
      const haystack = `${doc.documentName} ${doc.content}`
      const lexical = keywordOverlapScore(query, haystack)
      const titleMatch = doc.documentName.toLowerCase().includes(query.trim().toLowerCase()) ? 0.06 : 0
      const lengthPenalty = haystack.length < 24 ? -0.04 : 0
      const combined = doc.score * 0.58 + lexical * 0.32 + titleMatch + lengthPenalty

      return {
        ...doc,
        score: Number(Math.min(0.99, Math.max(0, combined)).toFixed(4)),
      }
    })
    .sort((a, b) => b.score - a.score)

  return reranked.slice(0, topK)
}
