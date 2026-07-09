import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EmbeddingProvider } from '../config/embedding.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EMBEDDING_DIR = join(__dirname, '../../data/embeddings')

export interface EmbeddingStoreEntry {
  documentId: string
  fragmentId: string
  contentHash: string
  embedding: number[]
}

export interface EmbeddingStoreFile {
  knowledgeBaseId: string
  provider: EmbeddingProvider
  model: string
  dimensions: number
  updatedAt: string
  entries: Record<string, EmbeddingStoreEntry>
}

export function hashEmbeddingContent(text: string) {
  return createHash('sha256').update(text.trim()).digest('hex')
}

function ensureEmbeddingDir() {
  mkdirSync(EMBEDDING_DIR, { recursive: true })
}

function storePath(knowledgeBaseId: string) {
  return join(EMBEDDING_DIR, `${knowledgeBaseId}.json`)
}

export function readEmbeddingStore(knowledgeBaseId: string): EmbeddingStoreFile | null {
  const path = storePath(knowledgeBaseId)
  if (!existsSync(path)) return null

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as EmbeddingStoreFile
  } catch {
    return null
  }
}

export function writeEmbeddingStore(store: EmbeddingStoreFile) {
  ensureEmbeddingDir()
  writeFileSync(storePath(store.knowledgeBaseId), JSON.stringify(store, null, 2), 'utf-8')
}

export function getStoredEmbedding(
  knowledgeBaseId: string,
  chunkId: string,
  contentHash: string,
): number[] | null {
  const store = readEmbeddingStore(knowledgeBaseId)
  const entry = store?.entries[chunkId]
  if (!entry || entry.contentHash !== contentHash) return null
  return entry.embedding
}

export function upsertEmbeddingEntries(
  knowledgeBaseId: string,
  payload: {
    provider: EmbeddingProvider
    model: string
    entries: Array<{
      chunkId: string
      documentId: string
      fragmentId: string
      contentHash: string
      embedding: number[]
    }>
  },
) {
  const existing = readEmbeddingStore(knowledgeBaseId)
  const entries = { ...(existing?.entries ?? {}) }

  for (const item of payload.entries) {
    entries[item.chunkId] = {
      documentId: item.documentId,
      fragmentId: item.fragmentId,
      contentHash: item.contentHash,
      embedding: item.embedding,
    }
  }

  const dimensions = payload.entries[0]?.embedding.length ?? existing?.dimensions ?? 0
  const store: EmbeddingStoreFile = {
    knowledgeBaseId,
    provider: payload.provider,
    model: payload.model,
    dimensions,
    updatedAt: new Date().toISOString(),
    entries,
  }

  writeEmbeddingStore(store)
  return store
}

export function countStoredEmbeddings(knowledgeBaseId: string) {
  return Object.keys(readEmbeddingStore(knowledgeBaseId)?.entries ?? {}).length
}
