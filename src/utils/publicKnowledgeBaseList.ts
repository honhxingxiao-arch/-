import type { KnowledgeBaseItem } from '../types.js'
import { isKnowledgeBaseCitable } from './knowledgeBaseStatus.js'
import { sortPublicKnowledgeBases, withPublicKnowledgeBaseCreator } from './sort.js'

export type PublicKnowledgeBaseTimeFilter = 'all' | '7d' | '30d'

export interface PublicKnowledgeBaseListQuery {
  page?: number
  pageSize?: number
  keyword?: string
  timeFilter?: PublicKnowledgeBaseTimeFilter
  tag?: string
}

export interface KnowledgeBaseListPageResult {
  items: KnowledgeBaseItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** 与前端 isPublicKnowledgeBase 一致：可引用 + 公共 scope/permission */
export function isVisiblePublicKnowledgeBase(item: KnowledgeBaseItem): boolean {
  if (!isKnowledgeBaseCitable(item)) return false
  return item.scope === 'public' || item.permission === 'public'
}

export function filterPublicKnowledgeBases(
  items: KnowledgeBaseItem[],
  query: Pick<PublicKnowledgeBaseListQuery, 'keyword' | 'timeFilter' | 'tag'>,
): KnowledgeBaseItem[] {
  let result = items.filter(isVisiblePublicKnowledgeBase).map(withPublicKnowledgeBaseCreator)

  if (query.timeFilter && query.timeFilter !== 'all') {
    const days = query.timeFilter === '7d' ? 7 : 30
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    result = result.filter((item) => new Date(item.createdAt).getTime() >= cutoff)
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

  return sortPublicKnowledgeBases(result)
}

export function listPublicKnowledgeBaseTags(items: KnowledgeBaseItem[]): string[] {
  const tags = new Set<string>()
  for (const item of items) {
    if (!isVisiblePublicKnowledgeBase(item)) continue
    for (const tag of item.tags) tags.add(tag)
  }
  return [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
