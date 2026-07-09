import { getKnowledgeBaseById } from './knowledgeBaseService.js'
import { updateStore } from './store.js'
import type { KnowledgeRecallChunk, KnowledgeRecallRecord, KnowledgeRecallSearchMethod } from '../types.js'

const MAX_RECORDS_PER_KB = 100

export function listRecallRecords(knowledgeBaseId: string): KnowledgeRecallRecord[] {
  const kb = getKnowledgeBaseById(knowledgeBaseId)
  return kb?.recallRecords ?? []
}

export function appendRecallRecord(
  knowledgeBaseId: string,
  payload: {
    query: string
    topK: number
    minScore: number
    minScoreEnabled: boolean
    searchMethod: KnowledgeRecallSearchMethod
    source: 'test' | 'app'
    durationMs: number
    chunks: KnowledgeRecallChunk[]
    candidateTotal: number
  },
): KnowledgeRecallRecord[] {
  const entry: KnowledgeRecallRecord = {
    id: `recall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    knowledgeBaseId,
    query: payload.query,
    topK: payload.topK,
    minScore: payload.minScore,
    minScoreEnabled: payload.minScoreEnabled,
    searchMethod: payload.searchMethod,
    source: payload.source,
    durationMs: payload.durationMs,
    chunkCount: payload.chunks.length,
    candidateTotal: payload.candidateTotal,
    createdAt: new Date().toISOString(),
    chunks: payload.chunks.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      fragmentId: chunk.fragmentId,
      documentName: chunk.documentName,
      score: chunk.score,
    })),
  }

  let nextRecords: KnowledgeRecallRecord[] = []
  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((item) => item.id === knowledgeBaseId)
    if (index < 0) return
    const kb = draft.knowledgeBases[index]!
    nextRecords = [entry, ...(kb.recallRecords ?? [])].slice(0, MAX_RECORDS_PER_KB)
    draft.knowledgeBases[index] = { ...kb, recallRecords: nextRecords }
  })

  return nextRecords
}
