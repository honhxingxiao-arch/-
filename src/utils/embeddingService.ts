import { embedTextLocal } from './localEmbedding.js'

export function cosineSimilarityVectors(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0

  if (a.length !== b.length) {
    const minLen = Math.min(a.length, b.length)
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < minLen; i += 1) {
      dot += a[i]! * b[i]!
    }
    for (const value of a) normA += value * value
    for (const value of b) normB += value * value
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function fallbackEmbedding(text: string) {
  return embedTextLocal(text)
}
