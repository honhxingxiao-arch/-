import { tokenize } from './textRetrieval.js'

const EMBEDDING_DIM = 128
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function addToVector(vector: Float64Array, token: string, weight = 1) {
  const hash = hashString(token)
  const index = hash % EMBEDDING_DIM
  const sign = (hash & 1) === 0 ? 1 : -1
  vector[index]! += sign * weight
}

function collectNgrams(text: string): string[] {
  const normalized = text.toLowerCase().trim()
  const tokens = tokenize(normalized)
  const ngrams: string[] = [...tokens]

  for (const segment of normalized.split(/[\s,，。；;、]+/).filter(Boolean)) {
    if (!CJK_RE.test(segment) || segment.length < 2) continue
    for (let i = 0; i < segment.length - 1; i += 1) {
      ngrams.push(`bi:${segment.slice(i, i + 2)}`)
    }
    for (let i = 0; i < segment.length - 2; i += 1) {
      ngrams.push(`tri:${segment.slice(i, i + 3)}`)
    }
  }

  return ngrams
}

function normalizeVector(vector: Float64Array): number[] {
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm)
  if (norm === 0) return Array.from(vector)

  return Array.from(vector, (value) => Number((value / norm).toFixed(6)))
}

export function embedTextLocal(text: string): number[] {
  const vector = new Float64Array(EMBEDDING_DIM)
  const ngrams = collectNgrams(text)

  for (const token of ngrams) {
    addToVector(vector, token, token.startsWith('tri:') ? 1.4 : token.startsWith('bi:') ? 1.2 : 1)
  }

  return normalizeVector(vector)
}

export const LOCAL_EMBEDDING_DIM = EMBEDDING_DIM
