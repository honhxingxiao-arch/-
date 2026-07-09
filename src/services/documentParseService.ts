import type { KnowledgeBaseDocument, KnowledgeBaseItem } from '../types.js'
import { buildDocumentFragments } from '../utils/documentParseContent.js'
import { fragmentBodyPlainText } from '../utils/documentRichContent.js'
import { extractDocumentText } from '../utils/documentTextExtractor.js'

export type DocumentParseSuccess = {
  ok: true
  fragmentCount: number
  excerpt: string
  fragments: NonNullable<KnowledgeBaseDocument['fragments']>
  contentSummary?: string
}

export type DocumentParseFailure = {
  ok: false
  failReason: string
}

export type DocumentParseResult = DocumentParseSuccess | DocumentParseFailure

export async function parseDocumentContent(
  item: KnowledgeBaseItem,
  doc: KnowledgeBaseDocument,
): Promise<DocumentParseResult> {
  const extracted = await extractDocumentText(
    {
      name: doc.name,
      type: doc.type,
      format: doc.format,
      fileId: doc.fileId,
      url: doc.url,
      contentSummary: doc.contentSummary,
    },
    { keepImageCaptions: item.advancedConfig?.keepImageCaptions !== false },
  )

  if (!extracted.ok) {
    return { ok: false, failReason: extracted.reason }
  }

  const parsed = buildDocumentFragments(
    doc.name,
    doc.type,
    doc.contentSummary,
    item.advancedConfig,
    { bodyText: extracted.text },
  )

  if (!parsed.fragmentCount) {
    return { ok: false, failReason: '正文过短，无法生成可用片段' }
  }

  return {
    ok: true,
    fragmentCount: parsed.fragmentCount,
    excerpt: parsed.excerpt,
    fragments: parsed.fragments,
    contentSummary: fragmentBodyPlainText(extracted.text).slice(0, 480),
  }
}
