export const KNOWLEDGE_BASE_DESCRIPTION_PLACEHOLDER = '暂无描述'

export function normalizeKnowledgeBaseDescription(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed || trimmed === KNOWLEDGE_BASE_DESCRIPTION_PLACEHOLDER) return ''
  return trimmed
}
