/** 匹配含引号 src 的 img（支持超长 data URL） */
const IMG_HTML_RE = /<img\b[^>]*?\bsrc=(?:"[^"]*"|'[^']*')[^>]*?\/?>/gi

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseImgTag(tag: string): { src: string; alt: string } | null {
  const attrs = tag.replace(/^<img\b/i, '').replace(/\/?>$/i, '')
  const srcMatch = attrs.match(/\bsrc=(?:"([^"]*)"|'([^']*)')/i)
  const src = srcMatch?.[1] ?? srcMatch?.[2]
  if (!src) return null
  const isDataImage = src.startsWith('data:image/')
  const isRemoteImage = /^https?:\/\//i.test(src)
  if (!isDataImage && !isRemoteImage) return null
  const altMatch = attrs.match(/\balt=(?:"([^"]*)"|'([^']*)')/i)
  return { src, alt: altMatch?.[1] ?? altMatch?.[2] ?? '图片' }
}

function serializeImgTag(tag: string): string {
  const parsed = parseImgTag(tag)
  if (!parsed) return ''
  const safeSrc = parsed.src.replace(/"/g, '&quot;')
  const safeAlt = parsed.alt.replace(/"/g, '&quot;')
  return `<img src="${safeSrc}" alt="${safeAlt}" class="kb-fragment-inline-img" />`
}

/** 将 mammoth / 网页 HTML 转为片段正文：保留 data URL 图片，段落用空行分隔 */
export function htmlToFragmentBody(html: string, options?: { keepImages?: boolean }): string {
  const keepImages = options?.keepImages !== false
  let normalized = html
    .replace(/\r\n/g, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')

  if (keepImages) {
    normalized = normalized.replace(IMG_HTML_RE, (tag) => serializeImgTag(tag))
  } else {
    normalized = normalized.replace(IMG_HTML_RE, '')
  }

  // 剥离其余 HTML，但保留已序列化的 <img> 标签
  normalized = normalized.replace(/<(?!img\b)[^>]+>/gi, '')
  normalized = decodeHtmlEntities(normalized)
  return normalized
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function markdownToFragmentBody(markdown: string, options?: { keepImages?: boolean }): string {
  const keepImages = options?.keepImages !== false
  let text = markdown.replace(/^\uFEFF/, '')

  if (keepImages) {
    text = text.replace(
      /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g,
      (_, alt: string, src: string) =>
        serializeImgTag(`src="${src}" alt="${alt || '图片'}"`),
    )
  }

  return text.trim()
}

export function fragmentBodyPlainText(content: string): string {
  return content
    .replace(IMG_HTML_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fragmentBodyHasImages(content: string): boolean {
  IMG_HTML_RE.lastIndex = 0
  return IMG_HTML_RE.test(content)
}
