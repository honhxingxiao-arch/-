import { SEED_KNOWLEDGE_BASES, SEED_RECYCLE_BIN } from '../data/seed.js'
import type {
  CreateKnowledgeBaseBody,
  KnowledgeBaseActivityLog,
  KnowledgeBaseCategory,
  KnowledgeBaseIconKey,
  KnowledgeBaseItem,
  KnowledgeBaseRecallConfig,
  KnowledgeBaseRecycleItem,
  KnowledgeBaseStats,
  UpdateKnowledgeBaseBody,
} from '../types.js'
import { sortMineKnowledgeBases, sortPublicKnowledgeBases, isPublicKnowledgeBase, withPublicKnowledgeBaseCreator } from '../utils/sort.js'
import {
  filterPublicKnowledgeBases,
  listPublicKnowledgeBaseTags,
  type PublicKnowledgeBaseListQuery,
  type KnowledgeBaseListPageResult,
} from '../utils/publicKnowledgeBaseList.js'
import {
  filterMineKnowledgeBases,
  listMineKnowledgeBaseTags,
  type MineKnowledgeBaseListQuery,
} from '../utils/mineKnowledgeBaseList.js'
import { CURRENT_USER_DISPLAY_NAME } from '../constants/currentUser.js'
import { assertUploadedFilesExist } from './importFileService.js'
import { syncDocumentsOnCreate, scheduleKnowledgeBaseDocumentParse } from './knowledgeBaseDocumentService.js'
import { normalizeKnowledgeBaseDescription } from '../utils/knowledgeBaseDescription.js'
import { getDocumentRecycleCount } from './documentRecycleService.js'
import { getStore, updateStore } from './store.js'

const CATEGORY_ICON: Record<KnowledgeBaseCategory, KnowledgeBaseIconKey> = {
  textbook: 'education',
  general: 'product',
}

const DEFAULT_COVER_KEY = 'cube'

function resolveCoverFields(body: {
  coverType?: KnowledgeBaseItem['coverType']
  coverKey?: KnowledgeBaseItem['coverKey']
  coverFileId?: string
}) {
  if (body.coverType === 'custom') {
    if (!body.coverFileId) {
      throw new Error('请上传封面图片')
    }
    assertUploadedFilesExist([body.coverFileId])
    return {
      coverType: 'custom' as const,
      coverFileId: body.coverFileId,
      coverKey: undefined,
    }
  }

  return {
    coverType: 'default' as const,
    coverKey: DEFAULT_COVER_KEY,
    coverFileId: undefined,
  }
}

const RETENTION_DAYS = 7

function computeRemainingDays(deletedAt: string) {
  const elapsedMs = Date.now() - new Date(deletedAt).getTime()
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000))
  return Math.max(0, RETENTION_DAYS - elapsedDays)
}

function scheduleMockParseProgress(id: string, total: number) {
  if (total <= 0) return

  for (let step = 1; step <= total; step += 1) {
    setTimeout(() => {
      updateStore((draft) => {
        const index = draft.knowledgeBases.findIndex((entry) => entry.id === id)
        if (index === -1) return

        const item = draft.knowledgeBases[index]
        if (item.status !== 'processing') return

        const now = new Date().toISOString()
        const completed = step >= total
        draft.knowledgeBases[index] = {
          ...item,
          status: completed ? 'completed' : 'processing',
          processDone: step,
          processTotal: total,
          processingUpdatedAt: now,
          updatedAt: now,
        }
      })
    }, step * 1200)
  }
}

function toRecycleItem(item: KnowledgeBaseItem, deletedBy = '我'): KnowledgeBaseRecycleItem {
  return {
    id: `recycle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    knowledgeBaseId: item.id,
    name: item.name,
    deletedAt: new Date().toISOString(),
    deletedBy,
    originalPermission: item.permission,
    documentCount: item.documentCount,
    remainingDays: RETENTION_DAYS,
    snapshot: structuredClone(item),
  }
}

/** List responses omit heavy nested fields to keep LAN/tunnel loads fast. */
function toKnowledgeBaseListSummary(item: KnowledgeBaseItem): KnowledgeBaseItem {
  const {
    documents: _documents,
    activityLogs: _activityLogs,
    importSources: _importSources,
    advancedConfig: _advancedConfig,
    permissionConfig: _permissionConfig,
    ...summary
  } = item
  return summary
}

export function listMineKnowledgeBasesPaged(
  query: MineKnowledgeBaseListQuery,
): KnowledgeBaseListPageResult {
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 12))
  const page = Math.max(1, Number(query.page) || 1)
  const { knowledgeBases } = getStore()
  const filtered = filterMineKnowledgeBases(knowledgeBases, query)
  const total = filtered.length
  const start = (page - 1) * pageSize
  const slice = filtered.slice(start, start + pageSize)

  return {
    items: slice.map(toKnowledgeBaseListSummary),
    total,
    page,
    pageSize,
    hasMore: start + slice.length < total,
  }
}

export function getMineKnowledgeBaseTags() {
  const { knowledgeBases } = getStore()
  return listMineKnowledgeBaseTags(knowledgeBases)
}

export function listPublicKnowledgeBasesPaged(
  query: PublicKnowledgeBaseListQuery,
): KnowledgeBaseListPageResult {
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))
  const page = Math.max(1, Number(query.page) || 1)
  const { knowledgeBases } = getStore()
  const filtered = filterPublicKnowledgeBases(knowledgeBases, query)
  const total = filtered.length
  const start = (page - 1) * pageSize
  const slice = filtered.slice(start, start + pageSize)

  return {
    items: slice.map(toKnowledgeBaseListSummary),
    total,
    page,
    pageSize,
    hasMore: start + slice.length < total,
  }
}

export function listPublicKnowledgeBaseRanking(limit = 20) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20))
  const { knowledgeBases } = getStore()
  const ranked = filterPublicKnowledgeBases(knowledgeBases, {}).slice(0, safeLimit)
  return ranked.map(toKnowledgeBaseListSummary)
}

export function getPublicKnowledgeBaseTags() {
  const { knowledgeBases } = getStore()
  return listPublicKnowledgeBaseTags(knowledgeBases)
}

export function listKnowledgeBases(scope?: 'mine' | 'public') {
  const { knowledgeBases } = getStore()
  if (scope === 'mine') {
    return sortMineKnowledgeBases(knowledgeBases.filter((item) => item.scope === 'mine')).map(
      toKnowledgeBaseListSummary,
    )
  }
  if (scope === 'public') {
    return sortPublicKnowledgeBases(
      knowledgeBases.filter(isPublicKnowledgeBase).map(withPublicKnowledgeBaseCreator),
    ).map(toKnowledgeBaseListSummary)
  }
  return knowledgeBases.map(withPublicKnowledgeBaseCreator).map(toKnowledgeBaseListSummary)
}

export function getKnowledgeBaseById(id: string) {
  return getStore().knowledgeBases.find((item) => item.id === id) ?? null
}

function appendActivityLog(item: KnowledgeBaseItem, log: Omit<KnowledgeBaseActivityLog, 'id'>) {
  const entry: KnowledgeBaseActivityLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...log,
  }
  const logs = [entry, ...(item.activityLogs ?? [])].slice(0, 20)
  return logs
}

function isAdvancedConfigEqual(
  left: UpdateKnowledgeBaseBody['advancedConfig'],
  right: KnowledgeBaseItem['advancedConfig'],
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function normalizeRecallConfig(input?: KnowledgeBaseRecallConfig | null): KnowledgeBaseRecallConfig {
  return {
    topK: Math.min(20, Math.max(1, Number(input?.topK) || 5)),
    minScore: Math.min(1, Math.max(0, Number(input?.minScore) ?? 0.5)),
    minScoreEnabled: input?.minScoreEnabled !== false,
  }
}

export function updateKnowledgeBase(id: string, body: UpdateKnowledgeBaseBody) {
  let updated: KnowledgeBaseItem | null = null
  let shouldReparseAll = false

  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((entry) => entry.id === id)
    if (index === -1) return

    const current = draft.knowledgeBases[index]
    if (current.scope !== 'mine') {
      throw new Error('公共知识库不可编辑')
    }

    if (body.advancedConfig !== undefined) {
      shouldReparseAll =
        !isAdvancedConfigEqual(body.advancedConfig, current.advancedConfig)
        && (current.documentCount ?? 0) > 0
    }

    const name = body.name?.trim()
    if (name !== undefined) {
      if (!name) throw new Error('请输入知识库名称')
      if (name.length > 50) throw new Error('名称不超过 50 个字符')
      const duplicated = draft.knowledgeBases.some(
        (item) => item.id !== id && item.scope === 'mine' && item.name.trim() === name,
      )
      if (duplicated) throw new Error('该名称已存在，请更换')
    }

    const permission = body.permission ?? current.permission
    if (permission === 'group' && body.permissionConfig?.groupIds?.length === 0) {
      throw new Error('请选择分组')
    }

    const category = body.category ?? current.category
    const now = new Date().toISOString()
    const nextTags =
      body.tags !== undefined
        ? body.tags.filter(Boolean)
        : current.tags

    const nextCover =
      body.coverType !== undefined || body.coverKey !== undefined || body.coverFileId !== undefined
        ? resolveCoverFields(body)
        : {
            coverType: (current.coverType ?? 'default') as KnowledgeBaseItem['coverType'],
            coverKey: current.coverType === 'custom' ? undefined : (current.coverKey ?? DEFAULT_COVER_KEY),
            coverFileId: current.coverType === 'custom' ? current.coverFileId : undefined,
          }

    updated = {
      ...current,
      ...(name !== undefined ? { name } : {}),
      ...(body.description !== undefined
        ? { description: normalizeKnowledgeBaseDescription(body.description) }
        : {}),
      category,
      iconKey: CATEGORY_ICON[category],
      permission,
      tags: body.tags !== undefined ? nextTags : current.tags,
      ...nextCover,
      ...(body.advancedConfig !== undefined ? { advancedConfig: body.advancedConfig } : {}),
      ...(body.recallConfig !== undefined ? { recallConfig: normalizeRecallConfig(body.recallConfig) } : {}),
      ...(body.permissionConfig ? { permissionConfig: body.permissionConfig } : {}),
      updatedAt: now,
      activityLogs: appendActivityLog(current, {
        type: 'update',
        message: shouldReparseAll ? '更新了知识库设置，并已发起全部重新解析' : '更新了知识库设置',
        createdAt: now,
      }),
    }
    draft.knowledgeBases[index] = updated
  })

  if (!updated) throw new Error('知识库不存在')
  if (shouldReparseAll) {
    return reparseKnowledgeBase(id)
  }
  return updated
}

export function createKnowledgeBase(body: CreateKnowledgeBaseBody) {
  const name = body.name.trim()
  if (!name) {
    throw new Error('请输入知识库名称')
  }
  if (name.length > 50) {
    throw new Error('名称不超过 50 个字符')
  }

  const { knowledgeBases } = getStore()
  const duplicated = knowledgeBases.some(
    (item) => item.scope === 'mine' && item.name.trim() === name,
  )
  if (duplicated) {
    throw new Error('该名称已存在，请更换')
  }

  const category = body.category ?? 'general'
  const sources = Array.isArray(body.sources) ? body.sources : []
  const localFileIds = sources.filter((item) => item.type === 'local' && item.fileId).map((item) => item.fileId!)
  if (localFileIds.length) {
    assertUploadedFilesExist(localFileIds)
  }

  const derivedDocumentCount = sources.length || Math.max(0, body.documentCount ?? 0)
  const derivedStorageBytes =
    sources.reduce((sum, item) => sum + Math.max(0, item.sizeBytes ?? 0), 0) ||
    Math.max(0, body.storageBytes ?? 0)
  const documentCount = derivedDocumentCount
  const storageBytes = derivedStorageBytes
  const processTotal = body.processTotal ?? (documentCount > 0 ? documentCount : undefined)
  const shouldParse = body.status === 'processing' && documentCount > 0
  const permission = body.permission ?? 'private'
  if (permission === 'group' && body.permissionConfig?.groupIds?.length === 0) {
    throw new Error('请选择分组')
  }
  const now = new Date().toISOString()
  const cover = resolveCoverFields(body)
  const item: KnowledgeBaseItem = {
    id: `kb-${Date.now()}`,
    name,
    description: normalizeKnowledgeBaseDescription(body.description),
    permission,
    status: shouldParse ? 'processing' : (body.status ?? 'completed'),
    scope: 'mine',
    category,
    iconKey: CATEGORY_ICON[category],
    ...cover,
    tags: body.tags?.filter(Boolean) ?? [],
    storageBytes,
    documentCount,
    referenceCount: 0,
    createdAt: now,
    updatedAt: now,
    ...(body.importMethod ? { importMethod: body.importMethod } : {}),
    ...(sources.length ? { importSources: sources } : {}),
    ...(body.advancedConfig ? { advancedConfig: body.advancedConfig } : {}),
    ...(body.recallConfig ? { recallConfig: normalizeRecallConfig(body.recallConfig) } : {}),
    ...(body.permissionConfig ? { permissionConfig: body.permissionConfig } : {}),
    ...(permission === 'public'
      ? { publishedBy: body.publishedBy?.trim() || CURRENT_USER_DISPLAY_NAME }
      : {}),
    ...(shouldParse
      ? {
          processDone: body.processDone ?? 0,
          processTotal,
          processingUpdatedAt: now,
        }
      : {}),
  }

  updateStore((draft) => {
    draft.knowledgeBases.unshift(item)
  })

  if (shouldParse && processTotal) {
    syncDocumentsOnCreate(item, sources)
    scheduleKnowledgeBaseDocumentParse(item.id)
    return getKnowledgeBaseById(item.id) ?? item
  }

  if (sources.length) {
    syncDocumentsOnCreate(item, sources)
    return getKnowledgeBaseById(item.id) ?? item
  }

  return item
}

export function reparseKnowledgeBase(id: string) {
  let updated: KnowledgeBaseItem | null = null

  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((item) => item.id === id)
    if (index === -1) return

    const item = draft.knowledgeBases[index]
    if (item.scope !== 'mine') {
      throw new Error('公共知识库不可重新解析')
    }

    const now = new Date().toISOString()
    const documents = (item.documents ?? []).map((doc) => ({
      ...doc,
      status: 'pending' as const,
      failReason: undefined,
      fragmentCount: undefined,
      fragments: undefined,
      updatedAt: now,
    }))

    updated = {
      ...item,
      documents: documents.length ? documents : item.documents,
      status: 'processing',
      processDone: 0,
      processTotal: item.documentCount || item.processTotal || 1,
      failedDocumentCount: undefined,
      failedAt: undefined,
      processingUpdatedAt: now,
      updatedAt: now,
      activityLogs: appendActivityLog(item, {
        type: 'parse',
        message: '已发起全部重新解析',
        createdAt: now,
      }),
    }
    draft.knowledgeBases[index] = updated
  })

  if (!updated) {
    throw new Error('知识库不存在')
  }

  scheduleKnowledgeBaseDocumentParse(id)
  return getKnowledgeBaseById(id) ?? updated
}

export function recordKnowledgeBaseReference(
  id: string,
  options: { actor?: string; agentName?: string; agentId?: string; agentAvatarId?: string } = {},
) {
  let updated: KnowledgeBaseItem | null = null

  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((entry) => entry.id === id)
    if (index === -1) return

    const current = draft.knowledgeBases[index]
    const now = new Date().toISOString()
    const actor = options.actor?.trim() || CURRENT_USER_DISPLAY_NAME
    const agentName = options.agentName?.trim() || '未命名智能体'
    updated = {
      ...current,
      referenceCount: current.referenceCount + 1,
      updatedAt: now,
      activityLogs: appendActivityLog(current, {
        type: 'reference',
        message: `${actor} 引用到 ${agentName}`,
        actor,
        agentName,
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(options.agentAvatarId ? { agentAvatarId: options.agentAvatarId } : {}),
        createdAt: now,
      }),
    }
    draft.knowledgeBases[index] = updated
  })

  if (!updated) throw new Error('知识库不存在')
  return updated
}

export function deleteKnowledgeBase(id: string) {
  let recycleItem: KnowledgeBaseRecycleItem | null = null

  updateStore((draft) => {
    const index = draft.knowledgeBases.findIndex((item) => item.id === id)
    if (index === -1) return

    const [removed] = draft.knowledgeBases.splice(index, 1)
    if (removed.scope !== 'mine') {
      draft.knowledgeBases.splice(index, 0, removed)
      throw new Error('公共知识库不可删除')
    }

    recycleItem = toRecycleItem(removed)
    draft.recycleBin.unshift(recycleItem)
  })

  if (!recycleItem) {
    throw new Error('知识库不存在')
  }
  return recycleItem
}

export function buildStats(): KnowledgeBaseStats {
  const { knowledgeBases, recycleBin } = getStore()
  return {
    mineCount: knowledgeBases.filter((item) => item.scope === 'mine').length,
    publicCount: knowledgeBases.filter(isPublicKnowledgeBase).length,
    totalDocuments: knowledgeBases.reduce((sum, item) => sum + item.documentCount, 0),
    totalReferences: knowledgeBases.reduce((sum, item) => sum + item.referenceCount, 0),
    pendingCount: knowledgeBases.filter((item) => item.status === 'processing').length,
    recycleCount: recycleBin.length + getDocumentRecycleCount(),
  }
}

export function listRecycleBin() {
  return getStore()
    .recycleBin.map((item) => ({
      id: item.id,
      name: item.name,
      deletedAt: item.deletedAt,
      deletedBy: item.deletedBy,
      originalPermission: item.originalPermission,
      documentCount: item.documentCount,
      remainingDays: computeRemainingDays(item.deletedAt),
      iconKey: item.snapshot.iconKey,
    }))
    .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime())
}

export function restoreRecycleItem(id: string) {
  let restored: KnowledgeBaseItem | null = null

  updateStore((draft) => {
    const index = draft.recycleBin.findIndex((item) => item.id === id)
    if (index === -1) return

    const [recycleItem] = draft.recycleBin.splice(index, 1)
    restored = recycleItem.snapshot
    draft.knowledgeBases.unshift(restored)
  })

  if (!restored) {
    throw new Error('回收站记录不存在')
  }
  return restored
}

export function permanentlyDeleteRecycleItem(id: string) {
  let deleted = false
  updateStore((draft) => {
    const before = draft.recycleBin.length
    draft.recycleBin = draft.recycleBin.filter((item) => item.id !== id)
    deleted = draft.recycleBin.length < before
  })
  if (!deleted) {
    throw new Error('回收站记录不存在')
  }
}

export function batchRestoreRecycleItems(ids: string[]) {
  const restored: KnowledgeBaseItem[] = []
  updateStore((draft) => {
    for (const id of ids) {
      const index = draft.recycleBin.findIndex((item) => item.id === id)
      if (index === -1) continue
      const [recycleItem] = draft.recycleBin.splice(index, 1)
      draft.knowledgeBases.unshift(recycleItem.snapshot)
      restored.push(recycleItem.snapshot)
    }
  })
  return restored
}

export function batchPermanentlyDeleteRecycleItems(ids: string[]) {
  updateStore((draft) => {
    draft.recycleBin = draft.recycleBin.filter((item) => !ids.includes(item.id))
  })
}

export function clearRecycleBin() {
  updateStore((draft) => {
    draft.recycleBin = []
  })
}

export function resetKnowledgeBaseData() {
  updateStore((draft) => {
    draft.knowledgeBases = structuredClone(SEED_KNOWLEDGE_BASES)
    draft.recycleBin = structuredClone(SEED_RECYCLE_BIN)
  })
}
