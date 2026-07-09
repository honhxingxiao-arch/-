import type { KnowledgeBaseItem } from '../types.js'
import { CURRENT_USER_DISPLAY_NAME } from '../constants/currentUser.js'

/** 公共知识库：scope 为 public，或用户创建且权限为公开 */
export function isPublicKnowledgeBase(item: KnowledgeBaseItem): boolean {
  return item.scope === 'public' || item.permission === 'public'
}

/** 补齐本人公开知识库缺失的创作者存储名（内部存真实姓名，展示层再转为「我」） */
export function withPublicKnowledgeBaseCreator(item: KnowledgeBaseItem): KnowledgeBaseItem {
  if (item.isOfficial || !isPublicKnowledgeBase(item)) return item
  if (item.scope === 'mine' && item.permission === 'public' && !item.publishedBy?.trim()) {
    return { ...item, publishedBy: CURRENT_USER_DISPLAY_NAME }
  }
  return item
}

/** 公共知识库排序：引用次数从高到低 */
export function sortPublicKnowledgeBases(items: KnowledgeBaseItem[]): KnowledgeBaseItem[] {
  return [...items].sort((a, b) => {
    const byRef = b.referenceCount - a.referenceCount
    if (byRef !== 0) return byRef
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}
