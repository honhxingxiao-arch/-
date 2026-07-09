import type { KnowledgeBaseDocumentFragment, KnowledgeBaseImportAdvancedConfig } from '../types.js'
import { fragmentBodyHasImages, fragmentBodyPlainText } from './documentRichContent.js'

const DEFAULT_SLICE = 500
const DEFAULT_OVERLAP = 50
export const DETAIL_FRAGMENT_PREVIEW = 12

function defaultAdvancedConfig(): KnowledgeBaseImportAdvancedConfig {
  return {
    parseMode: 'smart',
    chunkPreset: 'standard',
    sliceLength: DEFAULT_SLICE,
    overlapLength: DEFAULT_OVERLAP,
    chapterHeadingLevel: 'auto-h1-h3',
    chapterKeepTitles: true,
    chapterSplitLong: true,
    chapterMaxLength: 2000,
    chapterMergeShort: true,
    chapterMergeThreshold: 120,
    dedupe: true,
    tableStructure: true,
    keepImageCaptions: true,
    enableOcr: false,
    retryCount: 2,
    completionAction: 'detail',
  }
}

function buildFallbackBody(name: string, type: 'local' | 'web', summary?: string): string {
  if (summary?.trim()) return summary.trim()

  const intro =
    type === 'web'
      ? `《${name}》网页正文已抓取并完成清洗。`
      : `《${name}》文档已完成文本提取。`

  const paragraphs = [
    intro,
    '本段内容用于知识库检索与问答召回测试，涵盖核心概念、操作步骤与注意事项。',
    '在实际应用中，系统会按切片策略将正文拆分为多个语义片段，供向量检索与引用溯源使用。',
    '请结合上下文理解各片段含义；召回时将返回与问题最相关的若干片段作为回答依据。',
    '若文档包含表格、图示说明或章节标题，解析流程会尽量保留结构信息以提升召回质量。',
    '以上内容均为模拟解析结果，用于演示文档详情与切片预览能力。',
  ]

  return paragraphs.join('\n\n')
}

function splitFixedChunks(text: string, sliceLength: number, overlapLength: number): string[] {
  if (fragmentBodyHasImages(text)) {
    return splitFragmentBodyWithImages(text, sliceLength)
  }

  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const chunks: string[] = []
  let start = 0
  while (start < normalized.length) {
    let end = Math.min(start + sliceLength, normalized.length)
    if (end < normalized.length) {
      const window = normalized.slice(start, end)
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
      )
      if (breakAt > sliceLength * 0.4) {
        end = start + breakAt + 1
      }
    }
    const piece = normalized.slice(start, end).trim()
    if (piece) chunks.push(piece)
    if (end >= normalized.length) break
    start = Math.max(end - overlapLength, start + 1)
  }
  return chunks
}

function splitFragmentBodyWithImages(text: string, sliceLength: number): string[] {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (!paragraphs.length) return []

  const chunks: string[] = []
  let buffer = ''

  const isImageOnlyParagraph = (paragraph: string) =>
    fragmentBodyHasImages(paragraph) && fragmentBodyPlainText(paragraph).length < 40

  for (const paragraph of paragraphs) {
    if (isImageOnlyParagraph(paragraph)) {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
      continue
    }

    if (paragraph.length > sliceLength && !fragmentBodyHasImages(paragraph)) {
      if (buffer) {
        chunks.push(buffer)
        buffer = ''
      }
      chunks.push(...splitFixedChunks(paragraph, sliceLength, Math.floor(sliceLength * 0.1)))
      continue
    }

    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph
    if (candidate.length > sliceLength && buffer) {
      chunks.push(buffer)
      buffer = paragraph
    } else {
      buffer = candidate
    }
  }

  if (buffer) chunks.push(buffer)
  return chunks
}

function splitChapterChunks(text: string, maxLength: number): string[] {
  const sections = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (!sections.length) return splitFixedChunks(text, maxLength, Math.floor(maxLength * 0.1))

  const chunks: string[] = []
  let buffer = ''
  for (const section of sections) {
    if (section.length > maxLength) {
      if (buffer) {
        chunks.push(buffer)
        buffer = ''
      }
      chunks.push(...splitFixedChunks(section, maxLength, Math.floor(maxLength * 0.1)))
      continue
    }
    const candidate = buffer ? `${buffer}\n\n${section}` : section
    if (candidate.length > maxLength && buffer) {
      chunks.push(buffer)
      buffer = section
    } else {
      buffer = candidate
    }
  }
  if (buffer) chunks.push(buffer)
  return chunks
}

export function sliceDocumentContent(
  text: string,
  config?: KnowledgeBaseImportAdvancedConfig,
): string[] {
  const resolved = config ?? defaultAdvancedConfig()
  const sliceLength = Math.max(120, resolved.sliceLength || DEFAULT_SLICE)
  const overlapLength = Math.max(0, Math.min(resolved.overlapLength ?? DEFAULT_OVERLAP, sliceLength - 1))
  const chapterMaxLength = Math.max(sliceLength, resolved.chapterMaxLength || 2000)

  if (fragmentBodyHasImages(text)) {
    return splitFragmentBodyWithImages(text, chapterMaxLength)
  }

  if (resolved.parseMode === 'chapter') {
    return splitChapterChunks(text, chapterMaxLength)
  }
  if (resolved.parseMode === 'fixed') {
    return splitFixedChunks(text, sliceLength, overlapLength)
  }
  return splitFixedChunks(text, sliceLength, overlapLength)
}

function inferFragmentHasImage(content: string): boolean {
  return fragmentBodyHasImages(content)
}

export function buildDocumentFragments(
  name: string,
  type: 'local' | 'web',
  contentSummary: string | undefined,
  config: KnowledgeBaseImportAdvancedConfig | undefined,
  options?: { previewLimit?: number; bodyText?: string },
): { fragments: KnowledgeBaseDocumentFragment[]; fragmentCount: number; excerpt: string } {
  const body = options?.bodyText?.trim()
    ? options.bodyText.trim()
    : buildFallbackBody(name, type, contentSummary)
  const chunks = sliceDocumentContent(body, config)
  const fragmentCount = Math.max(chunks.length, 1)
  const previewLimit = options?.bodyText
    ? chunks.length
    : (options?.previewLimit ?? DETAIL_FRAGMENT_PREVIEW)

  const fragments = chunks.slice(0, previewLimit).map((content, index) => ({
    id: `frag-${index + 1}`,
    content,
    charCount: content.length,
    index: index + 1,
    hasImage: inferFragmentHasImage(content),
    referenceCount: 0,
  }))

  const excerpt = chunks[0]?.slice(0, 280) ?? body.slice(0, 280)
  const excerptSuffix = (chunks[0]?.length ?? 0) > 280 || body.length > 280 ? '…' : ''

  return {
    fragments,
    fragmentCount,
    excerpt: excerpt + excerptSuffix,
  }
}

export const DOCUMENT_FRAGMENT_PREVIEW_LIMIT = DETAIL_FRAGMENT_PREVIEW
export const DOCUMENT_DETAIL_FRAGMENT_LIMIT = 100
