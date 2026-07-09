import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { UploadedImportFileRecord } from '../types.js'
import { getStore, updateStore } from './store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = join(__dirname, '../../data/uploads')
const MAX_BYTES = 200 * 1024 * 1024

mkdirSync(UPLOAD_DIR, { recursive: true })

export function saveUploadedFile(file: {
  originalname: string
  mimetype: string
  size: number
  path: string
}): UploadedImportFileRecord {
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.originalname} 超过 200MB 限制`)
  }

  const record: UploadedImportFileRecord = {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    originalName: file.originalname,
    mimeType: file.mimetype || 'application/octet-stream',
    sizeBytes: file.size,
    storedPath: file.path,
    uploadedAt: new Date().toISOString(),
  }

  updateStore((draft) => {
    draft.uploadedFiles.unshift(record)
  })

  return record
}

export function getUploadedFile(id: string) {
  return getStore().uploadedFiles.find((item) => item.id === id) ?? null
}

export function assertUploadedFilesExist(fileIds: string[]) {
  for (const fileId of fileIds) {
    if (!getUploadedFile(fileId)) {
      throw new Error(`上传文件不存在或已失效：${fileId}`)
    }
  }
}

export function createUploadedFileStream(record: UploadedImportFileRecord) {
  if (!existsSync(record.storedPath)) {
    throw new Error(`文件已丢失：${record.originalName}`)
  }
  return createReadStream(record.storedPath)
}

export function removeUploadedFile(id: string) {
  const record = getUploadedFile(id)
  if (!record) return
  if (existsSync(record.storedPath)) {
    try {
      unlinkSync(record.storedPath)
    } catch {
      // ignore
    }
  }
  updateStore((draft) => {
    draft.uploadedFiles = draft.uploadedFiles.filter((item) => item.id !== id)
  })
}
