import type { EmbeddingProvider } from '../config/embedding.js'
import { getKnowledgeBaseById } from './knowledgeBaseService.js'
import { embedTexts } from './embeddingApiClient.js'
import {
  countStoredEmbeddings,
  getStoredEmbedding,
  hashEmbeddingContent,
  readEmbeddingStore,
  upsertEmbeddingEntries,
} from './embeddingStore.js'
import type { RetrievalDocument } from '../utils/textRetrieval.js'

export interface EmbeddingIndexResult {
  documents: Array<RetrievalDocument & { embedding?: number[] }>
  provider: EmbeddingProvider
  model: string
  indexedCount: number
  totalCount: number
}

function buildIndexText(doc: RetrievalDocument) {
  return `${doc.documentName}\n${doc.content}`.trim()
}

function collectRetrievalDocuments(knowledgeBaseId: string): RetrievalDocument[] {
  const kb = getKnowledgeBaseById(knowledgeBaseId)
  if (!kb?.documents?.length) return []

  const chunks: RetrievalDocument[] = []
  for (const doc of kb.documents) {
    if (doc.status !== 'completed') continue

    if (doc.fragments?.length) {
      for (const fragment of doc.fragments) {
        chunks.push({
          id: `${doc.id}-${fragment.id}`,
          documentId: doc.id,
          fragmentId: fragment.id,
          documentName: doc.name,
          content: fragment.content,
          index: fragment.index,
          charCount: fragment.charCount,
        })
      }
      continue
    }

    if (doc.excerpt) {
      chunks.push({
        id: `${doc.id}-excerpt`,
        documentId: doc.id,
        fragmentId: 'excerpt',
        documentName: doc.name,
        content: doc.excerpt,
        index: 1,
        charCount: doc.excerpt.length,
      })
    }
  }

  return chunks
}

export async function indexKnowledgeBaseEmbeddings(
  knowledgeBaseId: string,
  options?: { force?: boolean },
): Promise<EmbeddingIndexResult> {
  const documents = collectRetrievalDocuments(knowledgeBaseId)
  if (!documents.length) {
    return {
      documents: [],
      provider: 'local',
      model: 'local-hash-v1',
      indexedCount: 0,
      totalCount: 0,
    }
  }

  const missing: Array<{
    doc: RetrievalDocument
    contentHash: string
    text: string
  }> = []

  const enriched: Array<RetrievalDocument & { embedding?: number[] }> = []

  for (const doc of documents) {
    const text = buildIndexText(doc)
    const contentHash = hashEmbeddingContent(text)
    const cached = options?.force ? null : getStoredEmbedding(knowledgeBaseId, doc.id, contentHash)

    if (cached) {
      enriched.push({ ...doc, embedding: cached })
      continue
    }

    missing.push({ doc, contentHash, text })
    enriched.push({ ...doc })
  }

  if (missing.length) {
    const embedResult = await embedTexts(missing.map((item) => item.text))
    upsertEmbeddingEntries(knowledgeBaseId, {
      provider: embedResult.provider,
      model: embedResult.model,
      entries: missing.map((item, index) => ({
        chunkId: item.doc.id,
        documentId: item.doc.documentId,
        fragmentId: item.doc.fragmentId,
        contentHash: item.contentHash,
        embedding: embedResult.embeddings[index] ?? [],
      })),
    })

    for (let i = 0; i < missing.length; i += 1) {
      const target = enriched.find((item) => item.id === missing[i]!.doc.id)
      if (target) target.embedding = embedResult.embeddings[i]
    }
  }

  const store = readEmbeddingStore(knowledgeBaseId)
  return {
    documents: enriched.map((doc) => {
      if (doc.embedding) return doc
      const text = buildIndexText(doc)
      const cached = getStoredEmbedding(knowledgeBaseId, doc.id, hashEmbeddingContent(text))
      return cached ? { ...doc, embedding: cached } : doc
    }),
    provider: store?.provider ?? 'local',
    model: store?.model ?? 'local-hash-v1',
    indexedCount: countStoredEmbeddings(knowledgeBaseId),
    totalCount: documents.length,
  }
}

export async function ensureKnowledgeBaseEmbeddings(
  knowledgeBaseId: string,
  documents: RetrievalDocument[],
): Promise<EmbeddingIndexResult> {
  if (!documents.length) {
    return {
      documents: [],
      provider: 'local',
      model: 'local-hash-v1',
      indexedCount: 0,
      totalCount: 0,
    }
  }

  const indexed = await indexKnowledgeBaseEmbeddings(knowledgeBaseId)
  const embeddingMap = new Map(indexed.documents.map((doc) => [doc.id, doc.embedding]))

  return {
    ...indexed,
    documents: documents.map((doc) => ({
      ...doc,
      embedding: embeddingMap.get(doc.id),
    })),
    totalCount: documents.length,
  }
}
