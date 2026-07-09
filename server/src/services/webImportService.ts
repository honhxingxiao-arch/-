import type {
  WebImportDiscoverRequest,
  WebImportDiscoverResponse,
  WebImportPageDto,
} from '../types.js'
import {
  deriveConfirmReason,
  extractContentSections,
} from '../utils/webImportSections.js'

const FETCH_TIMEOUT_MS = 12000
const USER_AGENT =
  'Mozilla/5.0 (compatible; KnowledgeBaseImporter/1.0; +https://example.com/bot)'

function extractTitle(html: string, fallback: string) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og?.[1]) return decodeHtmlEntities(og[1].trim())
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (title?.[1]) return decodeHtmlEntities(title[1].trim())
  return fallback
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

function countMatches(html: string, pattern: RegExp) {
  return (html.match(pattern) || []).length
}

function deriveTitleFromUrl(url: URL) {
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments.at(-1)
  if (!last) return url.hostname
  const decoded = decodeURIComponent(last.replace(/\.(html?|md|php)$/i, ''))
  if (/^\d+$/.test(decoded)) return `${url.hostname} · 页面 ${decoded.slice(0, 12)}`
  return decoded.replace(/[-_]+/g, ' ')
}

function formatStats(wordCount: number, tableCount: number, imageCaptionCount: number) {
  return `正文约 ${wordCount.toLocaleString()} 字 · 表格 ${tableCount} 个 · 图片说明 ${imageCaptionCount} 处`
}

function buildExcerpt(title: string, text: string, stats: string) {
  const snippet = text.slice(0, 480)
  return `【${title}】\n\n${stats}\n\n以下为正文预览（节选）：\n\n${snippet}${text.length > 480 ? '…' : ''}`
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
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
      throw new Error(`HTTP ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error('目标不是可解析的 HTML 页面')
    }
    const html = await response.text()
    return { html, finalUrl: response.url || url }
  } finally {
    clearTimeout(timer)
  }
}

function analyzeHtml(html: string, pageUrl: string, source?: string): WebImportPageDto {
  const parsed = new URL(pageUrl)
  const title = extractTitle(html, deriveTitleFromUrl(parsed))
  const text = stripHtml(html)
  const wordCount = text.length
  const tableCount = countMatches(html, /<table\b/gi)
  const imageCaptionCount = countMatches(html, /<img\b/gi)
  const sections = extractContentSections(html)
  const hasNoiseSections = sections.some(
    (section) => section.kind === 'nav' || section.kind === 'footer' || section.kind === 'sidebar',
  )
  let confirmReason = deriveConfirmReason(wordCount)
  if (!confirmReason && hasNoiseSections && sections.length > 1) {
    confirmReason = 'mixed_noise'
  }
  const needConfirm = Boolean(confirmReason)
  const description = formatStats(wordCount, tableCount, imageCaptionCount)

  return {
    id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    url: pageUrl,
    status: needConfirm ? 'need_confirm' : 'importable',
    description,
    wordCount,
    tableCount,
    imageCaptionCount,
    selected: !needConfirm,
    source,
    excerpt: buildExcerpt(title, text, description),
    sections,
    confirmReason,
  }
}

function extractSameOriginLinks(html: string, baseUrl: URL, maxDepth: number) {
  const links = new Set<string>()
  const pattern = /<a\b[^>]*\bhref=["']([^"'#]+)["']/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    try {
      const href = match[1].trim()
      if (!href || href.startsWith('mailto:') || href.startsWith('javascript:')) continue
      const resolved = new URL(href, baseUrl)
      if (resolved.origin !== baseUrl.origin) continue
      const depth = resolved.pathname.split('/').filter(Boolean).length
      if (depth > maxDepth + 1) continue
      resolved.hash = ''
      links.add(resolved.toString())
    } catch {
      continue
    }
  }
  return [...links]
}

function blockedPage(url: string, reason: string): WebImportPageDto {
  return {
    id: `web-blocked-${Date.now()}`,
    title: deriveTitleFromUrl(new URL(url)),
    url,
    status: 'blocked',
    description: reason,
    selected: false,
    source: '抓取失败',
  }
}

async function discoverCurrent(url: string): Promise<WebImportDiscoverResponse> {
  try {
    const { html, finalUrl } = await fetchHtml(url)
    const page = analyzeHtml(html, finalUrl, '当前页面')
    return {
      pages: [page],
      meta: {
        scope: 'current',
        startUrl: url,
        totalFound: 1,
        displayedCount: 1,
        truncated: false,
        fetchMode: 'live',
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '页面抓取失败'
    return {
      pages: [blockedPage(url, message)],
      meta: {
        scope: 'current',
        startUrl: url,
        totalFound: 1,
        displayedCount: 1,
        truncated: false,
        fetchMode: 'live',
      },
    }
  }
}

async function discoverSubdomain(
  url: string,
  maxPages: number,
  maxDepth: number,
): Promise<WebImportDiscoverResponse> {
  const parsed = new URL(url)
  try {
    const { html, finalUrl } = await fetchHtml(url)
    const primary = analyzeHtml(html, finalUrl, '入口页面')
    primary.selected = true
    const links = extractSameOriginLinks(html, new URL(finalUrl), maxDepth)
      .filter((item) => item !== finalUrl)
      .slice(0, Math.max(0, maxPages - 1))

    const pages: WebImportPageDto[] = [primary]
    for (const link of links) {
      try {
        const child = await fetchHtml(link)
        pages.push(analyzeHtml(child.html, child.finalUrl, `同域链接 · 深度 ${maxDepth}`))
      } catch {
        pages.push(blockedPage(link, '子页面抓取失败'))
      }
    }

    return {
      pages: pages.slice(0, maxPages),
      meta: {
        scope: 'subdomain',
        startUrl: url,
        totalFound: pages.length,
        displayedCount: Math.min(pages.length, maxPages),
        truncated: links.length + 1 > maxPages,
        fetchMode: 'live',
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '入口页抓取失败'
    return {
      pages: [blockedPage(url, message)],
      meta: {
        scope: 'subdomain',
        startUrl: url,
        totalFound: 1,
        displayedCount: 1,
        truncated: false,
        fetchMode: 'live',
      },
    }
  }
}

async function discoverSitemap(
  url: string,
  maxPages: number,
  sitemapUrl?: string,
): Promise<WebImportDiscoverResponse> {
  const parsed = new URL(url)
  const targetSitemap = sitemapUrl?.trim() || `${parsed.origin}/sitemap.xml`
  try {
    const { html } = await fetchHtml(targetSitemap)
    const locs = [...html.matchAll(/<loc>([^<]+)<\/loc>/gi)]
      .map((item) => item[1].trim())
      .filter((item) => item.startsWith(parsed.origin))
      .slice(0, maxPages)

    if (!locs.length) {
      return discoverSubdomain(url, maxPages, 2)
    }

    const pages: WebImportPageDto[] = []
    for (const link of locs) {
      try {
        const fetched = await fetchHtml(link)
        pages.push(analyzeHtml(fetched.html, fetched.finalUrl, 'sitemap.xml'))
      } catch {
        pages.push(blockedPage(link, 'sitemap 页面抓取失败'))
      }
    }

    return {
      pages,
      meta: {
        scope: 'sitemap',
        startUrl: url,
        totalFound: pages.length,
        displayedCount: pages.length,
        truncated: locs.length >= maxPages,
        sitemapUrl: targetSitemap,
        fetchMode: 'live',
      },
    }
  } catch {
    return discoverSubdomain(url, maxPages, 2)
  }
}

export async function discoverWebImportPages(
  body: WebImportDiscoverRequest,
): Promise<WebImportDiscoverResponse> {
  const url = body.url.trim()
  if (!url) throw new Error('请输入网页链接')
  let parsed: URL
  try {
    parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid')
    }
  } catch {
    throw new Error('请输入有效的 http/https 链接')
  }

  const maxPages = Math.min(Math.max(body.config.maxPages ?? 20, 1), 100)
  const maxDepth = Math.min(Math.max(body.config.maxDepth ?? 2, 1), 5)

  if (body.config.scope === 'current') return discoverCurrent(url)
  if (body.config.scope === 'subdomain') return discoverSubdomain(url, maxPages, maxDepth)
  return discoverSitemap(url, maxPages, body.config.sitemapUrl)
}
