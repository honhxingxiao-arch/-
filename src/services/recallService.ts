import type { KnowledgeRecallChunk, KnowledgeRecallSearchMethod } from '../types.js'
import type { EmbeddingProvider } from '../config/embedding.js'
import { ensureKnowledgeBaseEmbeddings } from './embeddingIndexService.js'
import { getKnowledgeBaseById } from './knowledgeBaseService.js'
import { rerankDocuments } from '../utils/rerankService.js'
import { scoreDocuments, type RetrievalDocument } from '../utils/textRetrieval.js'
import { scoreDocumentsByVector } from '../utils/vectorRetrieval.js'

const RECALL_CHUNK_LIBRARY: Record<string, KnowledgeRecallChunk[]> = {
  kb1: [
    {
      id: 'kb1-c1',
      documentId: 'kb1-doc-1',
      fragmentId: 'frag-1',
      documentName: 'CT 扫描注意事项.pdf',
      content:
        'CT 检查前需确认患者有无碘造影剂过敏史；增强扫描前建议禁食 4 小时，并监测肾功能指标。',
      score: 0.94,
      index: 1,
    },
    {
      id: 'kb1-c2',
      documentId: 'kb1-doc-2',
      fragmentId: 'frag-1',
      documentName: 'MRI 读片要点.docx',
      content:
        'MRI T1/T2 信号对比是定位病灶的基础；弥散加权成像（DWI）对急性脑梗死高度敏感，应优先查看。',
      score: 0.89,
      index: 1,
    },
  ],
}

const DEFAULT_CHUNKS: KnowledgeRecallChunk[] = [
  {
    id: 'default-c1',
    documentId: 'default-doc',
    fragmentId: 'frag-1',
    documentName: '知识库说明.md',
    content: '请输入与知识库主题相关的关键词，系统将返回语义最相近的文档片段供召回效果评估。',
    score: 0.75,
    index: 1,
  },
]

export type KnowledgeRecallEngine = 'vector' | 'tfidf'

function buildChunkLibraryFromKnowledgeBase(knowledgeBaseId: string): RetrievalDocument[] {
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

function normalizeChunkContent(content: string) {
  return content
    .replace(/片段\s*\d+\s*[:：]/gi, '片段：')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickDiverseTopK(
  ranked: Array<KnowledgeRecallChunk & { score: number }>,
  topK: number,
): KnowledgeRecallChunk[] {
  if (topK <= 0 || ranked.length === 0) return []

  const selected: KnowledgeRecallChunk[] = []
  const seenContent = new Set<string>()
  const seenDocs = new Set<string>()
  const deferred: KnowledgeRecallChunk[] = []

  for (const chunk of ranked) {
    if (selected.length >= topK) break

    const contentKey = normalizeChunkContent(chunk.content)
    if (seenContent.has(contentKey)) continue

    if (seenDocs.has(chunk.documentId)) {
      deferred.push(chunk)
      continue
    }

    seenDocs.add(chunk.documentId)
    seenContent.add(contentKey)
    selected.push(chunk)
  }

  const pool = [...deferred, ...ranked]
  for (const chunk of pool) {
    if (selected.length >= topK) break
    if (selected.some((item) => item.id === chunk.id)) continue

    const contentKey = normalizeChunkContent(chunk.content)
    if (seenContent.has(contentKey)) continue

    seenContent.add(contentKey)
    selected.push(chunk)
  }

  return selected
}

function toRecallChunks(
  scored: Array<RetrievalDocument & { score: number }>,
): Array<KnowledgeRecallChunk & { score: number }> {
  return scored.map((item) => ({
    id: item.id,
    documentId: item.documentId,
    fragmentId: item.fragmentId,
    documentName: item.documentName,
    content: item.content,
    score: Number(item.score.toFixed(2)),
    index: item.index,
    charCount: item.charCount,
  }))
}

async function scoreWithEngine(
  query: string,
  documents: RetrievalDocument[],
  searchMethod: KnowledgeRecallSearchMethod,
): Promise<{
  scored: Array<RetrievalDocument & { score: number }>
  engine: KnowledgeRecallEngine
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
}> {
  if (searchMethod === 'keyword') {
    return {
      engine: 'tfidf',
      embeddingProvider: 'local',
      embeddingModel: 'local-hash-v1',
      scored: scoreDocuments(query, documents, 'keyword'),
    }
  }

  const vectorResult = await scoreDocumentsByVector(query, documents, searchMethod)
  return {
    engine: 'vector',
    embeddingProvider: vectorResult.embeddingProvider,
    embeddingModel: vectorResult.embeddingModel,
    scored: vectorResult.results,
  }
}

export interface RecallSearchOptions {
  topK: number
  minScore: number
  minScoreEnabled: boolean
  searchMethod: KnowledgeRecallSearchMethod
  rerankEnabled: boolean
}

export interface RecallSearchResult {
  chunks: KnowledgeRecallChunk[]
  candidateTotal: number
  retrievalEngine: KnowledgeRecallEngine
  rerankApplied: boolean
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  indexedFragmentCount: number
}

export async function runRecallSearch(
  knowledgeBaseId: string,
  query: string,
  options: RecallSearchOptions,
): Promise<RecallSearchResult> {
  const fromStore = buildChunkLibraryFromKnowledgeBase(knowledgeBaseId)

  if (fromStore.length > 0) {
    const indexed = await ensureKnowledgeBaseEmbeddings(knowledgeBaseId, fromStore)
    const { scored: rawScored, engine, embeddingProvider, embeddingModel } = await scoreWithEngine(
      query,
      indexed.documents,
      options.searchMethod,
    )
    const sorted = rawScored.sort((a, b) => b.score - a.score)

    const rerankApplied = options.rerankEnabled && options.searchMethod !== 'keyword'
    const reranked = rerankApplied
      ? rerankDocuments(query, sorted, Math.max(options.topK * 2, options.topK))
      : sorted

    const matched = options.minScoreEnabled
      ? reranked.filter((chunk) => chunk.score >= options.minScore)
      : reranked

    return {
      candidateTotal: sorted.length,
      retrievalEngine: engine,
      rerankApplied,
      embeddingProvider,
      embeddingModel,
      indexedFragmentCount: indexed.indexedCount,
      chunks: pickDiverseTopK(toRecallChunks(matched), options.topK),
    }
  }

  const library = RECALL_CHUNK_LIBRARY[knowledgeBaseId] ?? DEFAULT_CHUNKS
  const fallback = library
    .map((chunk) => ({ ...chunk, score: Number((chunk.score * 0.8).toFixed(2)) }))
    .sort((a, b) => b.score - a.score)

  const matched = options.minScoreEnabled
    ? fallback.filter((chunk) => chunk.score >= options.minScore)
    : fallback

  return {
    candidateTotal: fallback.length,
    retrievalEngine: 'tfidf',
    rerankApplied: false,
    embeddingProvider: 'local',
    embeddingModel: 'local-hash-v1',
    indexedFragmentCount: 0,
    chunks: pickDiverseTopK(matched, options.topK).slice(0, options.topK),
  }
}

export type RecallBatchItemStatus = 'full' | 'partial' | 'none'

export interface RecallBatchItemResult {
  query: string
  chunkCount: number
  candidateTotal: number
  topScore: number
  status: RecallBatchItemStatus
  durationMs: number
}

export interface RecallBatchSummary {
  total: number
  full: number
  partial: number
  none: number
  avgDurationMs: number
}

export async function runRecallBatchSearch(
  knowledgeBaseId: string,
  queries: string[],
  options: RecallSearchOptions,
): Promise<{ results: RecallBatchItemResult[]; summary: RecallBatchSummary }> {
  const results: RecallBatchItemResult[] = []

  for (const rawQuery of queries) {
    const query = rawQuery.trim()
    if (!query) continue

    const started = Date.now()
    const { chunks, candidateTotal } = await runRecallSearch(knowledgeBaseId, query, options)
    const durationMs = Date.now() - started
    const topScore = chunks[0]?.score ?? 0

    let status: RecallBatchItemStatus = 'none'
    if (chunks.length >= options.topK) status = 'full'
    else if (chunks.length > 0) status = 'partial'

    results.push({
      query,
      chunkCount: chunks.length,
      candidateTotal,
      topScore,
      status,
      durationMs,
    })
  }

  const total = results.length
  const full = results.filter((item) => item.status === 'full').length
  const partial = results.filter((item) => item.status === 'partial').length
  const none = results.filter((item) => item.status === 'none').length
  const avgDurationMs = total
    ? Math.round(results.reduce((sum, item) => sum + item.durationMs, 0) / total)
    : 0

  return {
    results,
    summary: { total, full, partial, none, avgDurationMs },
  }
}

export interface RecallCompareSide {
  label: string
  topK: number
  minScore: number
  minScoreEnabled: boolean
  searchMethod: KnowledgeRecallSearchMethod
  rerankEnabled: boolean
  durationMs: number
  candidateTotal: number
  chunks: KnowledgeRecallChunk[]
  retrievalEngine: KnowledgeRecallEngine
  rerankApplied: boolean
}

export async function runRecallCompareSearch(
  knowledgeBaseId: string,
  query: string,
  sideA: RecallSearchOptions & { label?: string },
  sideB: RecallSearchOptions & { label?: string },
): Promise<{ query: string; a: RecallCompareSide; b: RecallCompareSide }> {
  const startedA = Date.now()
  const resultA = await runRecallSearch(knowledgeBaseId, query, sideA)
  const durationA = Date.now() - startedA

  const startedB = Date.now()
  const resultB = await runRecallSearch(knowledgeBaseId, query, sideB)
  const durationB = Date.now() - startedB

  return {
    query,
    a: {
      label: sideA.label ?? '方案 A',
      topK: sideA.topK,
      minScore: sideA.minScore,
      minScoreEnabled: sideA.minScoreEnabled,
      searchMethod: sideA.searchMethod,
      rerankEnabled: sideA.rerankEnabled,
      durationMs: durationA,
      candidateTotal: resultA.candidateTotal,
      chunks: resultA.chunks,
      retrievalEngine: resultA.retrievalEngine,
      rerankApplied: resultA.rerankApplied,
    },
    b: {
      label: sideB.label ?? '方案 B',
      topK: sideB.topK,
      minScore: sideB.minScore,
      minScoreEnabled: sideB.minScoreEnabled,
      searchMethod: sideB.searchMethod,
      rerankEnabled: sideB.rerankEnabled,
      durationMs: durationB,
      candidateTotal: resultB.candidateTotal,
      chunks: resultB.chunks,
      retrievalEngine: resultB.retrievalEngine,
      rerankApplied: resultB.rerankApplied,
    },
  }
}
