import type { KnowledgeBaseItem, KnowledgeBasePermission, KnowledgeBaseStatus } from '../types.js'
import { sortMineKnowledgeBases } from './sort.js'

export type MineKnowledgeBaseTimeFilter = 'all' | '7d' | '30d'

export interface MineKnowledgeBaseListQuery {
  page?: number
  pageSize?: number
  keyword?: string
  timeFilter?: MineKnowledgeBaseTimeFilter
  tag?: string
  permission?: KnowledgeBasePermission | 'all'
  status?: KnowledgeBaseStatus | 'all'
}

export interface KnowledgeBaseListPageResult {
  items: KnowledgeBaseItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

function getKnowledgeBaseEffectiveStatus(item: KnowledgeBaseItem): KnowledgeBaseStatus {
  if ((item.failedDocumentCount ?? 0) > 0) return 'failed'
  return item.status
}

export function filterMineKnowledgeBases(
  items: KnowledgeBaseItem[],
  query: Pick<
    MineKnowledgeBaseListQuery,
    'keyword' | 'timeFilter' | 'tag' | 'permission' | 'status'
  >,
): KnowledgeBaseItem[] {
  let result = items.filter((item) => item.scope === 'mine')

  if (query.timeFilter && query.timeFilter !== 'all') {
    const days = query.timeFilter === '7d' ? 7 : 30
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    result = result.filter((item) => new Date(item.createdAt).getTime() >= cutoff)
  }

  if (query.permission && query.permission !== 'all') {
    result = result.filter((item) => item.permission === query.permission)
  }

  if (query.status && query.status !== 'all') {
    result = result.filter((item) => getKnowledgeBaseEffectiveStatus(item) === query.status)
  }

  if (query.tag && query.tag !== 'all') {
    result = result.filter((item) => item.tags.includes(query.tag!))
  }

  const q = query.keyword?.trim().toLowerCase()
  if (q) {
    result = result.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)),
    )
  }

  return sortMineKnowledgeBases(result)
}

export function listMineKnowledgeBaseTags(items: KnowledgeBaseItem[]): string[] {
  const tags = new Set<string>()
  for (const item of items) {
    if (item.scope !== 'mine') continue
    for (const tag of item.tags) tags.add(tag)
  }
  return [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
