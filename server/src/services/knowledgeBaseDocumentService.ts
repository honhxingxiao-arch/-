import type {
  KnowledgeBaseDocument,
  KnowledgeBaseDocumentStatus,
  KnowledgeBaseImportSource,
  KnowledgeBaseItem,
} from '../types.js'
import { indexKnowledgeBaseEmbeddings } from './embeddingIndexService.js'
import { parseDocumentContent } from './documentParseService.js'
import { externalizeFragmentImages, externalizeFragmentList } from './fragmentMediaService.js'
import { buildDocumentFragments, DOCUMENT_DETAIL_FRAGMENT_LIMIT, DOCUMENT_FRAGMENT_PREVIEW_LIMIT } from '../utils/documentParseContent.js'
import { assertUploadedFilesExist } from './importFileService.js'
import { createDocumentRecycleItem } from './documentRecycleService.js'
import { getKnowledgeBaseById } from './knowledgeBaseService.js'
import { getStore, updateStore } from './store.js'

const KNOWLEDGE_BASE_MAX_DOCUMENTS = 8

const LOCAL_FORMATS = ['pdf', 'docx', 'md', 'xlsx', 'txt']
const WEB_HOSTS = ['mp.weixin.qq.com', 'docs.example.com', 'help.example.com']

function inferFormat(name: string, type: 'local' | 'web'): string | undefined {
  if (type === 'web') return undefined
  const ext = name.split('.').pop()?.toLowerCase()
  return ext || 'file'
}

function resolveDocumentStatus(
  item: KnowledgeBaseItem,
  index: number,
  total: number,
): KnowledgeBaseDocumentStatus {
  if (item.status === 'completed') return 'completed'
  if (item.status === 'processing') {
    const done = item.processDone ?? 0
    if (index < done) return 'completed'
    if (index === done) return 'processing'
    return 'pending'
  }
  if (item.status === 'failed') {
    const failedCount = item.failedDocumentCount ?? 1
    if (index < failedCount) return 'failed'
    return 'completed'
  }
  if (total === 0) return 'pending'
  return 'completed'
}

function buildExcerpt(name: string, type: 'local' | 'web', summary?: string): string {
  const { excerpt } = buildDocumentFragments(name, type, summary, undefined, { previewLimit: 1 })
  return excerpt
}

function buildFragmentsForDocument(
  item: KnowledgeBaseItem,
  doc: Pick<KnowledgeBaseDocument, 'name' | 'type' | 'contentSummary'>,
  previewLimit = DOCUMENT_FRAGMENT_PREVIEW_LIMIT,
) {
  return buildDocumentFragments(doc.name, doc.type, doc.contentSummary, item.advancedConfig, {
    previewLimit,
  })
}

function applyParsedContent(
  item: KnowledgeBaseItem,
  doc: KnowledgeBaseDocument,
): KnowledgeBaseDocument {
  const parsed = buildFragmentsForDocument(item, doc)
  return {
    ...doc,
    fragmentCount: parsed.fragmentCount,
    excerpt: parsed.excerpt,
    fragments: parsed.fragments,
  }
}

function applyParseResult(
  doc: KnowledgeBaseDocument,
  result: Awaited<ReturnType<typeof parseDocumentContent>>,
  now: string,
): KnowledgeBaseDocument {
  if (!result.ok) {
    return {
      ...doc,
      status: 'failed',
      failReason: result.failReason,
      fragmentCount: undefined,
      excerpt: undefined,
      fragments: undefined,
      updatedAt: now,
    }
  }

  const externalized = result.fragments?.length
    ? externalizeFragmentList(result.fragments)
    : { fragments: result.fragments, changed: false }

  return {
    ...doc,
    status: 'completed',
    failReason: undefined,
    fragmentCount: result.fragmentCount,
    excerpt: result.excerpt,
    fragments: externalized.fragments,
    contentSummary: result.contentSummary ?? doc.contentSummary,
    updatedAt: now,
  }
}

function ensureExternalizedFragments(
  kbId: string,
  document: KnowledgeBaseDocument,
): KnowledgeBaseDocument {
  if (!document.fragments?.length) return document

  const { fragments, changed } = externalizeFragmentList(document.fragments)
  if (!changed) {
    return document
  }

  const updatedAt = new Date().toISOString()
  updateStore((draft) => {
    const kbIndex = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (kbIndex === -1) return
    const kb = draft.knowledgeBases[kbIndex]!
    const docs = kb.documents?.map((entry) =>
      entry.id === document.id
        ? {
            ...entry,
            fragments,
            excerpt: externalizeFragmentImages(entry.excerpt ?? '').content,
            updatedAt,
          }
        : entry,
    )
    if (docs) {
      draft.knowledgeBases[kbIndex] = { ...kb, documents: docs }
    }
  })

  return {
    ...document,
    fragments,
    excerpt: externalizeFragmentImages(document.excerpt ?? '').content,
    updatedAt,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseSingleDocument(kbId: string, docId: string) {
  const item = getKnowledgeBaseById(kbId)
  if (!item?.documents?.length) return

  const doc = item.documents.find((entry) => entry.id === docId)
  if (!doc) return

  const processingAt = new Date().toISOString()
  updateStore((draft) => {
    const kbIndex = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (kbIndex === -1) return
    const kb = draft.knowledgeBases[kbIndex]!
    const docs = kb.documents!.map((entry) =>
      entry.id === docId
        ? { ...entry, status: 'processing' as const, failReason: undefined, updatedAt: processingAt }
        : entry,
    )
    const progress = syncKnowledgeBaseProgressFromDocuments(kb, docs)
    draft.knowledgeBases[kbIndex] = {
      ...kb,
      documents: docs,
      ...progress,
      processingUpdatedAt: processingAt,
      updatedAt: processingAt,
    }
  })

  const result = await parseDocumentContent(item, doc)
  const finishedAt = new Date().toISOString()

  updateStore((draft) => {
    const kbIndex = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (kbIndex === -1) return
    const kb = draft.knowledgeBases[kbIndex]!
    const docs = kb.documents!.map((entry) =>
      entry.id === docId ? applyParseResult(entry, result, finishedAt) : entry,
    )
    const progress = syncKnowledgeBaseProgressFromDocuments(kb, docs)
    draft.knowledgeBases[kbIndex] = {
      ...kb,
      documents: docs,
      ...progress,
      updatedAt: finishedAt,
    }
  })
}

function sourceToDocument(
  item: KnowledgeBaseItem,
  source: KnowledgeBaseImportSource,
  index: number,
  total: number,
  now: string,
): KnowledgeBaseDocument {
  const status = resolveDocumentStatus(item, index, total)
  const parsed =
    status === 'completed'
      ? buildFragmentsForDocument(item, { name: source.name, type: source.type, contentSummary: source.contentSummary })
      : null

  return {
    id: `doc-${item.id}-${index + 1}`,
    knowledgeBaseId: item.id,
    name: source.name,
    type: source.type,
    format: inferFormat(source.name, source.type),
    fileId: source.fileId,
    url: source.url,
    sizeBytes: Math.max(0, source.sizeBytes ?? 0),
    status,
    fragmentCount: parsed?.fragmentCount,
    failReason:
      status === 'failed'
        ? source.type === 'web'
          ? '页面正文为空或抓取超时'
          : '文件格式不支持或内容无法解析'
        : undefined,
    contentSummary: source.contentSummary,
    sectionIds: source.sectionIds,
    excerpt: parsed?.excerpt ?? buildExcerpt(source.name, source.type, source.contentSummary),
    fragments: parsed?.fragments,
    createdAt: now,
    updatedAt: now,
  }
}

function buildPlaceholderDocuments(item: KnowledgeBaseItem, now: string): KnowledgeBaseDocument[] {
  const count = Math.max(item.documentCount, 0)
  if (count === 0) return []

  return Array.from({ length: count }, (_, index) => {
    const isWeb = index % 3 === 2
    const status = resolveDocumentStatus(item, index, count)

    if (isWeb) {
      const host = WEB_HOSTS[index % WEB_HOSTS.length]
      const name = `${item.name} · 网页资料 ${index + 1}`
      const url = `https://${host}/article/${index + 1}`
      const base = {
        id: `doc-${item.id}-${index + 1}`,
        knowledgeBaseId: item.id,
        name,
        type: 'web' as const,
        url,
        sizeBytes: 0,
        status,
        failReason: status === 'failed' ? '页面正文为空或抓取超时' : undefined,
        createdAt: now,
        updatedAt: now,
      }
      return status === 'completed' ? applyParsedContent(item, base) : base
    }

    const format = LOCAL_FORMATS[index % LOCAL_FORMATS.length]
    const name = `${item.name} · 资料 ${index + 1}.${format}`
    const base = {
      id: `doc-${item.id}-${index + 1}`,
      knowledgeBaseId: item.id,
      name,
      type: 'local' as const,
      format,
      sizeBytes: Math.max(128 * 1024, Math.floor(item.storageBytes / Math.max(count, 1))),
      status,
      failReason: status === 'failed' ? '文件格式不支持或内容无法解析' : undefined,
      createdAt: now,
      updatedAt: now,
    }
    return status === 'completed' ? applyParsedContent(item, base) : base
  })
}

function ensureDocuments(item: KnowledgeBaseItem): KnowledgeBaseDocument[] {
  if (item.documents?.length) {
    return item.documents.map((doc) => ({
      ...doc,
      status: doc.status ?? resolveDocumentStatus(item, 0, item.documents!.length),
    }))
  }

  const now = item.updatedAt || new Date().toISOString()
  if (item.importSources?.length) {
    return item.importSources.map((source, index) =>
      sourceToDocument(item, source, index, item.importSources!.length, now),
    )
  }

  return buildPlaceholderDocuments(item, now)
}

function persistDocuments(kbId: string, documents: KnowledgeBaseDocument[]) {
  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (index === -1) return
    draft.knowledgeBases[index] = {
      ...draft.knowledgeBases[index],
      documents,
      documentCount: documents.length,
      storageBytes: documents.reduce((sum, doc) => sum + Math.max(0, doc.sizeBytes), 0),
    }
  })
}

function syncKnowledgeBaseProgressFromDocuments(kb: KnowledgeBaseItem, documents: KnowledgeBaseDocument[]) {
  const doneCount = documents.filter((doc) => doc.status === 'completed').length
  const failedCount = documents.filter((doc) => doc.status === 'failed').length
  const processingCount = documents.filter((doc) => doc.status === 'processing').length
  const allSettled = documents.every(
    (doc) => doc.status === 'completed' || doc.status === 'failed',
  )

  let status: KnowledgeBaseItem['status'] = kb.status
  if (allSettled) {
    status = failedCount > 0 ? 'failed' : 'completed'
  } else if (processingCount > 0 || doneCount > 0) {
    status = 'processing'
  }

  return {
    status,
    processDone: doneCount,
    processTotal: documents.length,
    failedDocumentCount: failedCount > 0 ? failedCount : undefined,
    failedAt: failedCount > 0 ? new Date().toISOString() : undefined,
  }
}

function scheduleDocumentParseProgress(kbId: string, documentIds: string[]) {
  if (!documentIds.length) return

  void (async () => {
    for (const docId of documentIds) {
      await parseSingleDocument(kbId, docId)
      await sleep(400)
    }

    void indexKnowledgeBaseEmbeddings(kbId, { force: true }).catch((error) => {
      console.warn(`[embedding] failed to index knowledge base ${kbId}:`, error)
    })
  })()
}

/** 对知识库文档发起解析（默认解析所有非 completed 文档） */
export function scheduleKnowledgeBaseDocumentParse(kbId: string, documentIds?: string[]) {
  const item = getKnowledgeBaseById(kbId)
  if (!item) return

  const documents = ensureDocuments(item)
  const targets =
    documentIds?.length
      ? documents.filter((doc) => documentIds.includes(doc.id))
      : documents.filter((doc) => doc.status !== 'completed')

  const ids = targets.map((doc) => doc.id)
  if (!ids.length) return

  scheduleDocumentParseProgress(kbId, ids)
}

export function retryFailedDocuments(kbId: string) {
  const item = getKnowledgeBaseById(kbId)
  if (!item) throw new Error('知识库不存在')
  if (item.scope !== 'mine') throw new Error('公共知识库不可重新解析')

  const documents = ensureDocuments(item)
  const failedIds = documents.filter((doc) => doc.status === 'failed').map((doc) => doc.id)
  if (!failedIds.length) throw new Error('暂无失败文档')

  const now = new Date().toISOString()
  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (index === -1) return

    const current = draft.knowledgeBases[index]
    const nextDocs = documents.map((doc) =>
      failedIds.includes(doc.id)
        ? {
            ...doc,
            status: 'pending' as const,
            failReason: undefined,
            fragmentCount: undefined,
            fragments: undefined,
            updatedAt: now,
          }
        : doc,
    )

    draft.knowledgeBases[index] = {
      ...current,
      documents: nextDocs,
      status: 'processing',
      processDone: nextDocs.filter((doc) => doc.status === 'completed').length,
      processTotal: nextDocs.length,
      failedDocumentCount: undefined,
      failedAt: undefined,
      processingUpdatedAt: now,
      updatedAt: now,
    }
  })

  scheduleDocumentParseProgress(kbId, failedIds)
  return listKnowledgeBaseDocuments(kbId)
}

export function listKnowledgeBaseDocuments(kbId: string) {
  const item = getKnowledgeBaseById(kbId)
  if (!item) throw new Error('知识库不存在')

  const documents = ensureDocuments(item)
  if (!item.documents?.length) {
    persistDocuments(kbId, documents)
  }
  return documents
}

export function getKnowledgeBaseDocument(kbId: string, docId: string) {
  const item = getKnowledgeBaseById(kbId)
  if (!item) throw new Error('知识库不存在')

  const documents = listKnowledgeBaseDocuments(kbId)
  const document = documents.find((entry) => entry.id === docId)
  if (!document) throw new Error('文档不存在')

  if (document.fragments?.length) {
    return ensureExternalizedFragments(kbId, document)
  }

  if (document.status === 'completed') {
    const parsed = buildFragmentsForDocument(
      item,
      document,
      DOCUMENT_DETAIL_FRAGMENT_LIMIT,
    )
    return {
      ...document,
      fragmentCount: parsed.fragmentCount,
      excerpt: parsed.excerpt,
      fragments: parsed.fragments,
    }
  }

  return document
}

export function appendKnowledgeBaseDocuments(
  kbId: string,
  sources: KnowledgeBaseImportSource[],
) {
  const item = getKnowledgeBaseById(kbId)
  if (!item) throw new Error('知识库不存在')
  if (item.scope !== 'mine') throw new Error('公共知识库不可追加导入')

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('请选择要导入的资料')
  }

  const existing = ensureDocuments(item)
  if (existing.length + sources.length > KNOWLEDGE_BASE_MAX_DOCUMENTS) {
    throw new Error(`最多只能导入 ${KNOWLEDGE_BASE_MAX_DOCUMENTS} 个文档/页面`)
  }

  const localFileIds = sources.filter((entry) => entry.type === 'local' && entry.fileId).map((entry) => entry.fileId!)
  if (localFileIds.length) {
    assertUploadedFilesExist(localFileIds)
  }

  const now = new Date().toISOString()
  const startIndex = existing.length
  const appended = sources.map((source, offset) =>
    sourceToDocument(item, source, startIndex + offset, existing.length + sources.length, now),
  ).map((doc) => ({
    ...doc,
    status: 'pending' as const,
    fragmentCount: undefined,
    failReason: undefined,
    fragments: undefined,
  }))

  const nextDocuments = [...existing, ...appended]
  const addedBytes = appended.reduce((sum, doc) => sum + doc.sizeBytes, 0)

  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (index === -1) return

    const current = draft.knowledgeBases[index]
    const mergedSources = [...(current.importSources ?? []), ...sources]
    draft.knowledgeBases[index] = {
      ...current,
      documents: nextDocuments,
      importSources: mergedSources,
      documentCount: nextDocuments.length,
      storageBytes: current.storageBytes + addedBytes,
      status: 'processing',
      processDone: existing.filter((doc) => doc.status === 'completed').length,
      processTotal: nextDocuments.length,
      processingUpdatedAt: now,
      updatedAt: now,
      failedDocumentCount: undefined,
      failedAt: undefined,
      importMethod:
        mergedSources.some((entry) => entry.type === 'local') &&
        mergedSources.some((entry) => entry.type === 'web')
          ? 'mixed'
          : mergedSources.some((entry) => entry.type === 'web')
            ? 'web'
            : 'local',
    }
  })

  scheduleDocumentParseProgress(
    kbId,
    appended.map((doc) => doc.id),
  )

  return getKnowledgeBaseById(kbId)!
}

export function deleteKnowledgeBaseDocument(kbId: string, docId: string) {
  const item = getKnowledgeBaseById(kbId)
  if (!item) throw new Error('知识库不存在')
  if (item.scope !== 'mine') throw new Error('公共知识库不可删除文档')

  const documents = ensureDocuments(item)
  const target = documents.find((entry) => entry.id === docId)
  if (!target) throw new Error('文档不存在')

  const sourceIndex = documents.findIndex((entry) => entry.id === docId)
  const importSource = sourceIndex >= 0 ? item.importSources?.[sourceIndex] : undefined
  const recycleItem = createDocumentRecycleItem(target, item, importSource)

  const nextDocuments = documents.filter((entry) => entry.id !== docId)
  const now = new Date().toISOString()

  updateStore((draft) => {
    if (!Array.isArray(draft.documentRecycleBin)) {
      draft.documentRecycleBin = []
    }
    draft.documentRecycleBin.unshift(recycleItem)

    const index = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (index === -1) return

    const current = draft.knowledgeBases[index]
    draft.knowledgeBases[index] = {
      ...current,
      documents: nextDocuments,
      importSources: (current.importSources ?? []).filter((_, docIndex) => {
        const existingDoc = documents[docIndex]
        return existingDoc?.id !== docId
      }),
      documentCount: nextDocuments.length,
      storageBytes: nextDocuments.reduce((sum, doc) => sum + doc.sizeBytes, 0),
      processTotal: nextDocuments.length,
      processDone: nextDocuments.filter((doc) => doc.status === 'completed').length,
      updatedAt: now,
    }
  })

  return nextDocuments
}

export function reparseKnowledgeBaseDocument(kbId: string, docId: string) {
  const item = getKnowledgeBaseById(kbId)
  if (!item) throw new Error('知识库不存在')
  if (item.scope !== 'mine') throw new Error('公共知识库不可重新解析')

  const documents = ensureDocuments(item)
  if (!documents.some((entry) => entry.id === docId)) {
    throw new Error('文档不存在')
  }

  const now = new Date().toISOString()
  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((entry) => entry.id === kbId)
    if (index === -1) return

    const current = draft.knowledgeBases[index]
    draft.knowledgeBases[index] = {
      ...current,
      documents: documents.map((doc) =>
        doc.id === docId
          ? {
              ...doc,
              status: 'processing',
              failReason: undefined,
              updatedAt: now,
            }
          : doc,
      ),
      status: 'processing',
      updatedAt: now,
    }
  })

  scheduleDocumentParseProgress(kbId, [docId])
  return getKnowledgeBaseDocument(kbId, docId)
}

export function syncDocumentsOnCreate(item: KnowledgeBaseItem, sources: KnowledgeBaseImportSource[]) {
  if (!sources.length) return
  const now = item.createdAt
  const documents = sources.map((source, index) =>
    sourceToDocument(item, source, index, sources.length, now),
  )
  persistDocuments(item.id, documents)
}
