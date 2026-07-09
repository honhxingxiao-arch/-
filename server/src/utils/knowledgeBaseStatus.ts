import type { KnowledgeBaseItem } from '../types.js'

export function getKnowledgeBaseFailedDocumentCount(item: KnowledgeBaseItem): number {
  if (item.documents?.length) {
    return item.documents.filter((doc) => doc.status === 'failed').length
  }
  return item.failedDocumentCount ?? 0
}

export function isKnowledgeBaseCitable(item: KnowledgeBaseItem): boolean {
  if (item.status === 'processing') return false
  if (item.documentCount === 0) return false
  if (item.status === 'failed') return false
  if (getKnowledgeBaseFailedDocumentCount(item) > 0) return false
  return item.status === 'completed'
}

export function assertKnowledgeBaseCitable(item: KnowledgeBaseItem) {
  if (!isKnowledgeBaseCitable(item)) {
    const failedCount = getKnowledgeBaseFailedDocumentCount(item)
    if (failedCount > 0) {
      throw new Error(`有 ${failedCount} 个文档解析失败，暂不可引用`)
    }
    if (item.status === 'processing') {
      throw new Error('文档解析中，请稍后再试')
    }
    throw new Error('知识库暂不可引用')
  }
}
