import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { KnowledgeBaseDocumentFragment } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MEDIA_DIR = join(__dirname, '../../data/fragment-media')

mkdirSync(MEDIA_DIR, { recursive: true })

const DATA_IMG_SRC_RE = /(<img\b[^>]*?\bsrc=)"(data:image\/[^"]+)"/gi

function extensionForMime(mime: string) {
  const normalized = mime.toLowerCase()
  if (normalized.includes('svg')) return 'svg'
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('webp')) return 'webp'
  return 'bin'
}

function saveDataUrl(dataUrl: string): string | null {
  const match = /^data:(image\/[^;]+);base64,([\s\S]+)$/i.exec(dataUrl.trim())
  if (!match) return null

  const mime = match[1]
  const base64 = match[2].replace(/\s+/g, '')
  const hash = createHash('sha256').update(dataUrl).digest('hex').slice(0, 20)
  const filename = `${hash}.${extensionForMime(mime)}`
  const filepath = join(MEDIA_DIR, filename)

  if (!existsSync(filepath)) {
    writeFileSync(filepath, Buffer.from(base64, 'base64'))
  }

  return `/api/fragment-media/${filename}`
}

export function externalizeFragmentImages(content: string): { content: string; changed: boolean } {
  if (!content || !/data:image\//i.test(content)) {
    return { content, changed: false }
  }

  let changed = false
  const next = content.replace(DATA_IMG_SRC_RE, (full, prefix: string, dataUrl: string) => {
    const publicPath = saveDataUrl(dataUrl)
    if (!publicPath) return full
    changed = true
    return `${prefix}"${publicPath}"`
  })

  return { content: next, changed }
}

export function externalizeFragmentList(fragments: KnowledgeBaseDocumentFragment[]) {
  let changed = false
  const next = fragments.map((fragment) => {
    const { content, changed: fragmentChanged } = externalizeFragmentImages(fragment.content)
    if (!fragmentChanged) return fragment
    changed = true
    return {
      ...fragment,
      content,
      charCount: content.length,
      hasImage: true,
    }
  })
  return { fragments: next, changed }
}

export function resolveFragmentMediaPath(filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safe || safe !== filename) return null
  const filepath = join(MEDIA_DIR, safe)
  if (!existsSync(filepath)) return null
  return filepath
}

export function createFragmentMediaStream(filename: string) {
  const filepath = resolveFragmentMediaPath(filename)
  if (!filepath) return null
  return createReadStream(filepath)
}
