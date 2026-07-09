import type { KnowledgeBaseItem, KnowledgeBaseStatus } from './types.js'
import { isPublicKnowledgeBase, sortPublicKnowledgeBases } from './publicKnowledgeBase.js'

export { isPublicKnowledgeBase, sortPublicKnowledgeBases, withPublicKnowledgeBaseCreator } from './publicKnowledgeBase.js'

const MINE_STATUS_ORDER: Record<KnowledgeBaseStatus, number> = {
  failed: 0,
  processing: 1,
  completed: 2,
}

function getMineStatusSortTime(item: KnowledgeBaseItem): number {
  switch (item.status) {
    case 'failed':
      return new Date(item.failedAt ?? item.updatedAt).getTime()
    case 'processing':
      return new Date(item.processingUpdatedAt ?? item.updatedAt ?? item.createdAt).getTime()
    case 'completed':
      return new Date(item.updatedAt).getTime()
  }
}

export function sortMineKnowledgeBases(items: KnowledgeBaseItem[]): KnowledgeBaseItem[] {
  return [...items].sort((a, b) => {
    const byStatus = MINE_STATUS_ORDER[a.status] - MINE_STATUS_ORDER[b.status]
    if (byStatus !== 0) return byStatus
    return getMineStatusSortTime(b) - getMineStatusSortTime(a)
  })
}
