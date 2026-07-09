import { Router } from 'express'
import {
  batchPermanentlyDeleteRecycleItems,
  batchRestoreRecycleItems,
  buildStats,
  clearRecycleBin,
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  listKnowledgeBases,
  listMineKnowledgeBasesPaged,
  getMineKnowledgeBaseTags,
  listPublicKnowledgeBaseRanking,
  listPublicKnowledgeBasesPaged,
  getPublicKnowledgeBaseTags,
  listRecycleBin,
  permanentlyDeleteRecycleItem,
  reparseKnowledgeBase,
  recordKnowledgeBaseReference,
  restoreRecycleItem,
  updateKnowledgeBase,
} from '../services/knowledgeBaseService.js'
import { getEmbeddingPublicStatus } from '../config/embedding.js'
import { indexKnowledgeBaseEmbeddings } from '../services/embeddingIndexService.js'
import { runRecallBatchSearch, runRecallCompareSearch, runRecallSearch } from '../services/recallService.js'
import { appendRecallRecord, listRecallRecords } from '../services/recallRecordService.js'
import {
  appendKnowledgeBaseDocuments,
  deleteKnowledgeBaseDocument,
  getKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
  reparseKnowledgeBaseDocument,
  retryFailedDocuments,
} from '../services/knowledgeBaseDocumentService.js'
import {
  batchPermanentlyDeleteDocumentRecycleItems,
  batchRestoreDocumentRecycleItems,
  clearDocumentRecycleBin,
  listDocumentRecycleBin,
  permanentlyDeleteDocumentRecycleItem,
  restoreDocumentRecycleItem,
} from '../services/documentRecycleService.js'
import type {
  ApiSuccess,
  CreateKnowledgeBaseBody,
  KnowledgeBaseImportSource,
  KnowledgeRecallSearchMethod,
  RecallBatchRequestBody,
  RecallCompareRequestBody,
  RecallRequestBody,
  UpdateKnowledgeBaseBody,
} from '../types.js'

function parseRecallOptions(body: {
  topK?: number
  minScore?: number
  minScoreEnabled?: boolean
  searchMethod?: KnowledgeRecallSearchMethod
  rerankEnabled?: boolean
}) {
  const topK = Math.min(20, Math.max(1, Number(body.topK) || 5))
  const minScore = Math.min(1, Math.max(0, Number(body.minScore) ?? 0.5))
  const minScoreEnabled = body.minScoreEnabled !== false
  const searchMethod =
    body.searchMethod === 'keyword' || body.searchMethod === 'hybrid'
      ? body.searchMethod
      : 'semantic'
  const rerankEnabled = body.rerankEnabled !== false

  return { topK, minScore, minScoreEnabled, searchMethod, rerankEnabled }
}

import { assertKnowledgeBaseCitable, isKnowledgeBaseCitable } from '../utils/knowledgeBaseStatus.js'

function ensureRecallReady(item: NonNullable<ReturnType<typeof getKnowledgeBaseById>>, res: import('express').Response) {
  if (item.documentCount === 0) {
    res.status(400).json({ code: 400, message: '暂无可用文档' })
    return false
  }
  if (item.status === 'processing') {
    res.status(400).json({ code: 400, message: '文档解析中，请稍后再试' })
    return false
  }
  if (!isKnowledgeBaseCitable(item)) {
    res.status(400).json({ code: 400, message: '存在解析失败文档，暂不可引用' })
    return false
  }
  return true
}

const router = Router()


function ok<T>(data: T, message?: string): ApiSuccess<T> {
  return { code: 0, data, message }
}

function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : '服务器错误'
  const status = message.includes('不存在') ? 404 : 400
  return { status, body: { code: status, message } }
}

router.get('/stats', (_req, res) => {
  res.json(ok(buildStats()))
})

router.get('/embedding/status', (_req, res) => {
  res.json(ok(getEmbeddingPublicStatus()))
})

router.get('/recycle-bin', (_req, res) => {
  res.json(ok(listRecycleBin()))
})

router.get('/recycle-bin/documents', (_req, res) => {
  res.json(ok(listDocumentRecycleBin()))
})

router.post('/recycle-bin/documents/batch-restore', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : []
  if (!ids.length) {
    res.status(400).json({ code: 400, message: '请选择要恢复的项目' })
    return
  }
  try {
    const restored = batchRestoreDocumentRecycleItems(ids)
    res.json(ok(restored, '文档已恢复'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/recycle-bin/documents/batch-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : []
  if (!ids.length) {
    res.status(400).json({ code: 400, message: '请选择要删除的项目' })
    return
  }
  batchPermanentlyDeleteDocumentRecycleItems(ids)
  res.json(ok(null, '已批量彻底删除'))
})

router.delete('/recycle-bin/documents', (_req, res) => {
  clearDocumentRecycleBin()
  res.json(ok(null, '文档回收站已清空'))
})

router.post('/recycle-bin/documents/:id/restore', (req, res) => {
  try {
    const restored = restoreDocumentRecycleItem(req.params.id)
    res.json(ok(restored, '文档已恢复'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.delete('/recycle-bin/documents/:id', (req, res) => {
  try {
    permanentlyDeleteDocumentRecycleItem(req.params.id)
    res.json(ok(null, '已彻底删除'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/recycle-bin/batch-restore', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : []
  if (!ids.length) {
    res.status(400).json({ code: 400, message: '请选择要恢复的项目' })
    return
  }
  const restored = batchRestoreRecycleItems(ids)
  res.json(ok(restored, '知识库已恢复'))
})

router.post('/recycle-bin/batch-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : []
  if (!ids.length) {
    res.status(400).json({ code: 400, message: '请选择要删除的项目' })
    return
  }
  batchPermanentlyDeleteRecycleItems(ids)
  res.json(ok(null, '已批量彻底删除'))
})

router.delete('/recycle-bin', (_req, res) => {
  clearRecycleBin()
  res.json(ok(null, '回收站已清空'))
})

router.post('/recycle-bin/:id/restore', (req, res) => {
  try {
    const restored = restoreRecycleItem(req.params.id)
    res.json(ok(restored, '知识库已恢复'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.delete('/recycle-bin/:id', (req, res) => {
  try {
    permanentlyDeleteRecycleItem(req.params.id)
    res.json(ok(null, '已彻底删除'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.get('/mine/tags', (_req, res) => {
  res.json(ok({ tags: getMineKnowledgeBaseTags() }))
})

router.get('/mine', (req, res) => {
  const timeFilter = req.query.timeFilter
  const permission = req.query.permission
  const status = req.query.status
  const result = listMineKnowledgeBasesPaged({
    page: Number(req.query.page) || 1,
    pageSize: Number(req.query.pageSize) || 12,
    keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
    timeFilter:
      timeFilter === '7d' || timeFilter === '30d' || timeFilter === 'all' ? timeFilter : 'all',
    tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
    permission:
      permission === 'private' || permission === 'group' || permission === 'public'
        ? permission
        : 'all',
    status:
      status === 'processing' || status === 'completed' || status === 'failed'
        ? status
        : 'all',
  })
  res.json(ok(result))
})

router.get('/public/tags', (_req, res) => {
  res.json(ok({ tags: getPublicKnowledgeBaseTags() }))
})

router.get('/public/ranking', (req, res) => {
  const limit = Number(req.query.limit) || 20
  res.json(ok({ items: listPublicKnowledgeBaseRanking(limit) }))
})

router.get('/public', (req, res) => {
  const timeFilter = req.query.timeFilter
  const result = listPublicKnowledgeBasesPaged({
    page: Number(req.query.page) || 1,
    pageSize: Number(req.query.pageSize) || 20,
    keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
    timeFilter:
      timeFilter === '7d' || timeFilter === '30d' || timeFilter === 'all' ? timeFilter : 'all',
    tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
  })
  res.json(ok(result))
})

router.get('/', (req, res) => {
  const scope = req.query.scope
  if (scope === 'mine' || scope === 'public') {
    res.json(ok(listKnowledgeBases(scope)))
    return
  }
  res.json(ok(listKnowledgeBases()))
})

router.post('/', (req, res) => {
  try {
    const body = req.body as CreateKnowledgeBaseBody
    const item = createKnowledgeBase(body)
    res.status(201).json(ok(item, '知识库创建成功'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.get('/:id', (req, res) => {
  const item = getKnowledgeBaseById(req.params.id)
  if (!item) {
    res.status(404).json({ code: 404, message: '知识库不存在' })
    return
  }
  res.json(ok(item))
})

router.patch('/:id', (req, res) => {
  try {
    const body = req.body as UpdateKnowledgeBaseBody
    const item = updateKnowledgeBase(req.params.id, body)
    res.json(ok(item, '设置已保存'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/:id/reference', (req, res) => {
  try {
    const item = getKnowledgeBaseById(req.params.id)
    if (!item) {
      res.status(404).json({ code: 404, message: '知识库不存在' })
      return
    }
    assertKnowledgeBaseCitable(item)
    const actor = typeof req.body?.actor === 'string' ? req.body.actor.trim() : undefined
    const agentName = typeof req.body?.agentName === 'string' ? req.body.agentName.trim() : undefined
    const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : undefined
    const agentAvatarId =
      typeof req.body?.agentAvatarId === 'string' ? req.body.agentAvatarId.trim() : undefined
    const updated = recordKnowledgeBaseReference(req.params.id, { actor, agentName, agentId, agentAvatarId })
    res.json(ok(updated, '引用记录已更新'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.delete('/:id', (req, res) => {
  try {
    const recycleItem = deleteKnowledgeBase(req.params.id)
    res.json(ok(recycleItem, '已移入回收站'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/:id/reparse', (req, res) => {
  try {
    const item = reparseKnowledgeBase(req.params.id)
    res.json(ok(item, '已开始重新解析'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.get('/:id/documents', (req, res) => {
  try {
    const documents = listKnowledgeBaseDocuments(req.params.id)
    res.json(ok(documents))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.get('/:id/documents/:docId', (req, res) => {
  try {
    const document = getKnowledgeBaseDocument(req.params.id, req.params.docId)
    res.json(ok(document))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/:id/documents/import', (req, res) => {
  try {
    const sources = Array.isArray(req.body?.sources)
      ? (req.body.sources as KnowledgeBaseImportSource[])
      : []
    const item = appendKnowledgeBaseDocuments(req.params.id, sources)
    res.json(ok(item, '已提交追加导入'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.delete('/:id/documents/:docId', (req, res) => {
  try {
    const documents = deleteKnowledgeBaseDocument(req.params.id, req.params.docId)
    res.json(ok(documents, '文档已删除'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/:id/documents/retry-failed', (req, res) => {
  try {
    const documents = retryFailedDocuments(req.params.id)
    const item = getKnowledgeBaseById(req.params.id)
    res.json(ok({ item, documents }, '已开始重试失败文档'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/:id/documents/:docId/reparse', (req, res) => {
  try {
    const document = reparseKnowledgeBaseDocument(req.params.id, req.params.docId)
    res.json(ok(document, '已开始重新解析'))
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.get('/:id/recall/records', (req, res) => {
  const item = getKnowledgeBaseById(req.params.id)
  if (!item) {
    res.status(404).json({ code: 404, message: '知识库不存在' })
    return
  }
  res.json(ok(listRecallRecords(item.id)))
})

router.post('/:id/embeddings/reindex', async (req, res) => {
  const item = getKnowledgeBaseById(req.params.id)
  if (!item) {
    res.status(404).json({ code: 404, message: '知识库不存在' })
    return
  }

  try {
    const result = await indexKnowledgeBaseEmbeddings(item.id, { force: req.body?.force === true })
    res.json(
      ok({
        knowledgeBaseId: item.id,
        provider: result.provider,
        model: result.model,
        indexedCount: result.indexedCount,
        totalCount: result.totalCount,
      }, '向量索引已更新'),
    )
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/:id/recall/batch', async (req, res) => {
  const item = getKnowledgeBaseById(req.params.id)
  if (!item) {
    res.status(404).json({ code: 404, message: '知识库不存在' })
    return
  }
  if (!ensureRecallReady(item, res)) return

  const body = req.body as RecallBatchRequestBody
  const queries = Array.isArray(body.queries)
    ? body.queries.map((query) => String(query ?? '').trim()).filter(Boolean).slice(0, 20)
    : []

  if (!queries.length) {
    res.status(400).json({ code: 400, message: '请提供至少一个测试问题' })
    return
  }

  const options = parseRecallOptions(body)

  try {
    const { results, summary } = await runRecallBatchSearch(item.id, queries, options)
    res.json(
      ok({
        ...options,
        results,
        summary,
      }),
    )
  } catch (error) {
    const { status, body } = handleError(error)
    res.status(status).json(body)
  }
})

router.post('/:id/recall/compare', async (req, res) => {
  const item = getKnowledgeBaseById(req.params.id)
  if (!item) {
    res.status(404).json({ code: 404, message: '知识库不存在' })
    return
  }
  if (!ensureRecallReady(item, res)) return

  const body = req.body as RecallCompareRequestBody
  const query = String(body.query ?? '').trim()
  if (!query) {
    res.status(400).json({ code: 400, message: '请输入检索问题' })
    return
  }

  const configA = parseRecallOptions(body.configA ?? {})
  const configB = parseRecallOptions(body.configB ?? {})

  try {
    const compare = await runRecallCompareSearch(item.id, query, {
      ...configA,
      label: body.configA?.label ?? '方案 A',
    }, {
      ...configB,
      label: body.configB?.label ?? '方案 B',
    })
    res.json(ok(compare))
  } catch (error) {
    const { status, body: errorBody } = handleError(error)
    res.status(status).json(errorBody)
  }
})

router.post('/:id/recall', async (req, res) => {
  const item = getKnowledgeBaseById(req.params.id)
  if (!item) {
    res.status(404).json({ code: 404, message: '知识库不存在' })
    return
  }
  if (!ensureRecallReady(item, res)) return

  const body = req.body as RecallRequestBody
  const query = String(body.query ?? '').trim()
  if (!query) {
    res.status(400).json({ code: 400, message: '请输入检索问题' })
    return
  }

  const { topK, minScore, minScoreEnabled, searchMethod, rerankEnabled } = parseRecallOptions(body)
  const source = body.source === 'app' ? 'app' : 'test'

  const started = Date.now()

  try {
    const {
      chunks,
      candidateTotal,
      retrievalEngine,
      rerankApplied,
      embeddingProvider,
      embeddingModel,
      indexedFragmentCount,
    } = await runRecallSearch(item.id, query, {
      topK,
      minScore,
      minScoreEnabled,
      searchMethod,
      rerankEnabled,
    })
    const durationMs = Date.now() - started

    appendRecallRecord(item.id, {
      query,
      topK,
      minScore,
      minScoreEnabled,
      searchMethod,
      source,
      durationMs,
      chunks,
      candidateTotal,
    })

    res.json(
      ok({
        query,
        durationMs,
        candidateTotal,
        chunks,
        searchMethod,
        minScoreEnabled,
        minScore,
        topK,
        rerankEnabled,
        rerankApplied,
        retrievalEngine,
        embeddingProvider,
        embeddingModel,
        indexedFragmentCount,
      }),
    )
  } catch (error) {
    const { status, body: errorBody } = handleError(error)
    res.status(status).json(errorBody)
  }
})

export default router
