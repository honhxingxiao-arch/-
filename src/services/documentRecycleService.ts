import type {
  KnowledgeBaseDocument,
  KnowledgeBaseDocumentRecycleItem,
  KnowledgeBaseImportSource,
  KnowledgeBaseItem,
} from '../types.js'
import { indexKnowledgeBaseEmbeddings } from './embeddingIndexService.js'
import { getKnowledgeBaseById } from './knowledgeBaseService.js'
import { getStore, updateStore } from './store.js'

export const DOCUMENT_RECYCLE_RETENTION_DAYS = 7
const KNOWLEDGE_BASE_MAX_DOCUMENTS = 8

function computeRemainingDays(deletedAt: string) {
  const elapsedDays = Math.floor(
    (Date.now() - new Date(deletedAt).getTime()) / (24 * 60 * 60 * 1000),
  )
  return Math.max(0, DOCUMENT_RECYCLE_RETENTION_DAYS - elapsedDays)
}

function toDocumentRecycleItem(
  document: KnowledgeBaseDocument,
  knowledgeBase: KnowledgeBaseItem,
  importSource?: KnowledgeBaseImportSource,
  deletedBy = '我',
): KnowledgeBaseDocumentRecycleItem {
  return {
    id: `doc-recycle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    documentId: document.id,
    knowledgeBaseId: knowledgeBase.id,
    knowledgeBaseName: knowledgeBase.name,
    documentName: document.name,
    type: document.type,
    format: document.format,
    sizeBytes: document.sizeBytes,
    deletedAt: new Date().toISOString(),
    deletedBy,
    remainingDays: DOCUMENT_RECYCLE_RETENTION_DAYS,
    snapshot: structuredClone(document),
    importSourceSnapshot: importSource ? structuredClone(importSource) : undefined,
  }
}

export function createDocumentRecycleItem(
  document: KnowledgeBaseDocument,
  knowledgeBase: KnowledgeBaseItem,
  importSource?: KnowledgeBaseImportSource,
) {
  return toDocumentRecycleItem(document, knowledgeBase, importSource)
}

export function listDocumentRecycleBin() {
  const items = getStore().documentRecycleBin ?? []
  return items
    .map((item) => ({
      id: item.id,
      documentId: item.documentId,
      knowledgeBaseId: item.knowledgeBaseId,
      knowledgeBaseName: item.knowledgeBaseName,
      documentName: item.documentName,
      type: item.type,
      format: item.format,
      sizeBytes: item.sizeBytes,
      deletedAt: item.deletedAt,
      deletedBy: item.deletedBy,
      remainingDays: computeRemainingDays(item.deletedAt),
    }))
    .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime())
}

function assertDocumentRestorable(recycleItem: KnowledgeBaseDocumentRecycleItem) {
  const kb = getKnowledgeBaseById(recycleItem.knowledgeBaseId)
  if (!kb) {
    throw new Error('所属知识库不存在，无法恢复')
  }
  if (kb.scope !== 'mine') {
    throw new Error('公共知识库不可恢复文档')
  }

  const documents = kb.documents ?? []
  const documentCount = documents.length > 0 ? documents.length : kb.documentCount
  if (documentCount >= KNOWLEDGE_BASE_MAX_DOCUMENTS) {
    throw new Error(`该知识库已达文档上限（${KNOWLEDGE_BASE_MAX_DOCUMENTS} 个）`)
  }
  if (documents.some((entry) => entry.id === recycleItem.documentId)) {
    throw new Error('文档已存在，无法重复恢复')
  }
}

export function restoreDocumentRecycleItem(id: string) {
  const recycleItem = getStore().documentRecycleBin?.find((item) => item.id === id)
  if (!recycleItem) {
    throw new Error('回收站记录不存在')
  }

  assertDocumentRestorable(recycleItem)

  let restored: KnowledgeBaseDocument | null = null
  const now = new Date().toISOString()

  updateStore((draft) => {
    const recycleIndex = draft.documentRecycleBin?.findIndex((item) => item.id === id) ?? -1
    if (recycleIndex === -1) return

    const [item] = draft.documentRecycleBin!.splice(recycleIndex, 1)
    const kbIndex = draft.knowledgeBases.findIndex((entry) => entry.id === item.knowledgeBaseId)
    if (kbIndex === -1) return

    const kb = draft.knowledgeBases[kbIndex]!
    const documents = kb.documents ?? []
    const nextDocuments = [...documents, { ...item.snapshot, updatedAt: now }]
    const importSources = item.importSourceSnapshot
      ? [...(kb.importSources ?? []), item.importSourceSnapshot]
      : kb.importSources

    draft.knowledgeBases[kbIndex] = {
      ...kb,
      documents: nextDocuments,
      importSources,
      documentCount: nextDocuments.length,
      storageBytes: nextDocuments.reduce((sum, doc) => sum + Math.max(0, doc.sizeBytes), 0),
      processTotal: nextDocuments.length,
      processDone: nextDocuments.filter((doc) => doc.status === 'completed').length,
      updatedAt: now,
    }
    restored = item.snapshot
  })

  if (!restored) {
    throw new Error('回收站记录不存在')
  }

  const kbId = recycleItem.knowledgeBaseId
  void indexKnowledgeBaseEmbeddings(kbId, { force: true }).catch((error) => {
    console.warn(`[embedding] failed to reindex after document restore ${id}:`, error)
  })

  return restored
}

export function permanentlyDeleteDocumentRecycleItem(id: string) {
  let deleted = false
  updateStore((draft) => {
    if (!Array.isArray(draft.documentRecycleBin)) return
    const before = draft.documentRecycleBin.length
    draft.documentRecycleBin = draft.documentRecycleBin.filter((item) => item.id !== id)
    deleted = draft.documentRecycleBin.length < before
  })
  if (!deleted) {
    throw new Error('回收站记录不存在')
  }
}

export function batchRestoreDocumentRecycleItems(ids: string[]) {
  return ids.map((id) => restoreDocumentRecycleItem(id))
}

export function batchPermanentlyDeleteDocumentRecycleItems(ids: string[]) {
  updateStore((draft) => {
    if (!Array.isArray(draft.documentRecycleBin)) return
    draft.documentRecycleBin = draft.documentRecycleBin.filter((item) => !ids.includes(item.id))
  })
}

export function clearDocumentRecycleBin() {
  updateStore((draft) => {
    draft.documentRecycleBin = []
  })
}

export function getDocumentRecycleCount() {
  return getStore().documentRecycleBin?.length ?? 0
}
