import type { WebImportContentSectionDto, WebImportConfirmReason } from '../types.js'

export type SectionKind = WebImportContentSectionDto['kind']

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function stripTags(html: string) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function classifyKind(fragment: string, fallback: SectionKind = 'unknown'): SectionKind {
  const trimmed = fragment.trim()
  const opening = trimmed.slice(0, 240).toLowerCase()
  if (/^<nav\b/.test(opening) || /^<header\b/.test(opening)) return 'nav'
  if (/^<footer\b/.test(opening)) return 'footer'
  if (/^<aside\b/.test(opening)) return 'sidebar'
  if (fallback === 'main') return 'main'
  if (/(<main\b|<article\b)/.test(opening)) return 'main'
  if (/(class=["'][^"']*(?:nav|menu)|id=["'][^"']*(?:nav|menu))/.test(opening)) return 'nav'
  if (/(class=["'][^"']*footer|id=["'][^"']*footer)/.test(opening)) return 'footer'
  if (/(class=["'][^"']*(?:sidebar|aside)|id=["'][^"']*(?:sidebar|aside))/.test(opening)) {
    return 'sidebar'
  }
  return fallback
}

function removeSemanticBlocks(html: string) {
  return html
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
}

function defaultSelected(kind: SectionKind) {
  return kind === 'main' || kind === 'unknown'
}

function pushSection(
  sections: WebImportContentSectionDto[],
  index: { value: number },
  title: string,
  rawHtml: string,
  kind: SectionKind,
) {
  const text = stripHtml(rawHtml)
  if (text.length < 15) return
  const resolvedKind = classifyKind(rawHtml, kind)
  sections.push({
    id: `sec-${index.value++}`,
    title: title.slice(0, 80) || `内容区块 ${index.value}`,
    preview: text.slice(0, 140) + (text.length > 140 ? '…' : ''),
    wordCount: text.length,
    kind: resolvedKind,
    selected: defaultSelected(resolvedKind),
  })
}

function splitByHeadings(html: string, index: { value: number }, sections: WebImportContentSectionDto[]) {
  const headingPattern = /<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi
  const matches = [...html.matchAll(headingPattern)]
  if (!matches.length) return false

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    const title = stripTags(match[3] ?? '') || `标题 ${i + 1}`
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length
    const body = html.slice(start, end)
    pushSection(sections, index, title, body, 'main')
  }
  return sections.length > 0
}

function splitByParagraphs(text: string, index: { value: number }, sections: WebImportContentSectionDto[]) {
  const chunks = text.match(/[\s\S]{1,420}(?:\s|$)/g) ?? [text]
  chunks.forEach((chunk, i) => {
    const trimmed = chunk.trim()
    if (trimmed.length < 15) return
    pushSection(sections, index, `正文片段 ${i + 1}`, trimmed, 'unknown')
  })
}

function extractSemanticBlocks(html: string, index: { value: number }, sections: WebImportContentSectionDto[]) {
  const patterns: { regex: RegExp; kind: SectionKind; title: string }[] = [
    { regex: /<nav\b[\s\S]*?<\/nav>/gi, kind: 'nav', title: '导航区域' },
    { regex: /<header\b[\s\S]*?<\/header>/gi, kind: 'nav', title: '页头区域' },
    { regex: /<footer\b[\s\S]*?<\/footer>/gi, kind: 'footer', title: '页脚区域' },
    { regex: /<aside\b[\s\S]*?<\/aside>/gi, kind: 'sidebar', title: '侧边栏' },
  ]

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern.regex)) {
      pushSection(sections, index, pattern.title, match[0], pattern.kind)
    }
  }
}

export function extractContentSections(html: string): WebImportContentSectionDto[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

  const sections: WebImportContentSectionDto[] = []
  const index = { value: 0 }

  extractSemanticBlocks(cleaned, index, sections)

  const mainMatch =
    cleaned.match(/<main\b[\s\S]*?<\/main>/i) ??
    cleaned.match(/<article\b[\s\S]*?<\/article>/i)
  const mainHtml = mainMatch?.[0] ? removeSemanticBlocks(mainMatch[0]) : removeSemanticBlocks(cleaned)

  if (!splitByHeadings(mainHtml, index, sections)) {
    const text = stripHtml(mainHtml)
    if (text.length >= 15) {
      splitByParagraphs(text, index, sections)
    }
  }

  if (!sections.length) {
    const text = stripHtml(cleaned)
    if (text.length >= 15) {
      splitByParagraphs(text, index, sections)
    }
  }

  const seen = new Set<string>()
  return sections.filter((section) => {
    const key = `${section.kind}:${section.preview}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function deriveConfirmReason(wordCount: number): WebImportConfirmReason | undefined {
  if (wordCount < 120) return 'too_short'
  if (wordCount > 50000) return 'too_long'
  return undefined
}

export function sumSelectedSectionWords(
  sections: WebImportContentSectionDto[],
  selectedIds: string[],
) {
  const idSet = new Set(selectedIds)
  return sections
    .filter((section) => idSet.has(section.id))
    .reduce((sum, section) => sum + section.wordCount, 0)
}
