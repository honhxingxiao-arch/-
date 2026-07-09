import { readFile } from 'node:fs/promises'
import mammoth from 'mammoth'
import { getUploadedFile } from '../services/importFileService.js'
import {
  fragmentBodyPlainText,
  htmlToFragmentBody,
  markdownToFragmentBody,
} from './documentRichContent.js'

export type DocumentTextExtractSource = 'file' | 'summary' | 'web'

export type DocumentTextExtractResult =
  | { ok: true; text: string; source: DocumentTextExtractSource }
  | { ok: false; reason: string }

const FETCH_TIMEOUT_MS = 12000
const USER_AGENT =
  'Mozilla/5.0 (compatible; KnowledgeBaseImporter/1.0; +https://example.com/bot)'

function inferExtension(name: string, format?: string) {
  const fromFormat = format?.toLowerCase().trim()
  if (fromFormat) return fromFormat
  return name.split('.').pop()?.toLowerCase() ?? ''
}

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

function normalizeWebContentSummary(summary: string) {
  const marker = '以下为正文预览（节选）：'
  const idx = summary.indexOf(marker)
  if (idx >= 0) {
    return summary
      .slice(idx + marker.length)
      .replace(/^[…\s]+/, '')
      .trim()
  }
  return summary.trim()
}

async function fetchWebPageText(url: string, keepImages: boolean): Promise<DocumentTextExtractResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    if (!response.ok) {
      return { ok: false, reason: `网页抓取失败（HTTP ${response.status}）` }
    }

    const html = await response.text()
    const text = keepImages ? htmlToFragmentBody(html, { keepImages: true }) : stripHtml(html)
    if (fragmentBodyPlainText(text).length < 20) {
      return { ok: false, reason: '网页正文过少，可能未完整抓取' }
    }
    return { ok: true, text, source: 'web' }
  } catch {
    return { ok: false, reason: '网页抓取超时或失败' }
  } finally {
    clearTimeout(timer)
  }
}

export async function extractDocumentText(
  doc: {
    name: string
    type: 'local' | 'web'
    format?: string
    fileId?: string
    url?: string
    contentSummary?: string
  },
  options?: { keepImageCaptions?: boolean },
): Promise<DocumentTextExtractResult> {
  const keepImages = options?.keepImageCaptions !== false
  if (doc.type === 'local' && doc.fileId) {
    const file = getUploadedFile(doc.fileId)
    if (!file) {
      return { ok: false, reason: '上传文件不存在或已失效，请重新上传' }
    }

    const ext = inferExtension(doc.name, doc.format)

    try {
      if (ext === 'txt') {
        const raw = await readFile(file.storedPath, 'utf-8')
        const text = raw.replace(/^\uFEFF/, '').trim()
        if (!text) return { ok: false, reason: '文件内容为空' }
        return { ok: true, text, source: 'file' }
      }

      if (ext === 'md') {
        const raw = await readFile(file.storedPath, 'utf-8')
        const text = markdownToFragmentBody(raw, { keepImages })
        if (!fragmentBodyPlainText(text)) return { ok: false, reason: '文件内容为空' }
        return { ok: true, text, source: 'file' }
      }

      if (ext === 'docx') {
        const buffer = await readFile(file.storedPath)
        const result = await mammoth.convertToHtml({ buffer })
        const text = htmlToFragmentBody(result.value, { keepImages })
        if (!fragmentBodyPlainText(text)) {
          return { ok: false, reason: '未能从 DOCX 中提取到正文' }
        }
        return { ok: true, text, source: 'file' }
      }

      if (ext === 'pdf') {
        return { ok: false, reason: 'PDF 解析即将支持，请先上传 DOCX 或 TXT' }
      }

      if (ext === 'xlsx' || ext === 'xls') {
        return { ok: false, reason: 'Excel 解析即将支持，请先导出为 TXT 或 DOCX' }
      }

      return { ok: false, reason: `暂不支持 .${ext || '未知'} 格式的文本提取` }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : '文件读取失败',
      }
    }
  }

  if (doc.type === 'web') {
    if (doc.contentSummary?.trim()) {
      const text = normalizeWebContentSummary(doc.contentSummary)
      if (text.length >= 20) {
        return { ok: true, text, source: 'summary' }
      }
    }

    if (doc.url) {
      return fetchWebPageText(doc.url, keepImages)
    }

    return { ok: false, reason: '网页正文为空或抓取失败' }
  }

  return { ok: false, reason: '缺少可解析的内容来源' }
}
