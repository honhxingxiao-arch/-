import { Router } from 'express'
import multer from 'multer'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { saveUploadedFile, getUploadedFile, createUploadedFileStream } from '../services/importFileService.js'
import type { ApiSuccess } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const uploadDir = join(__dirname, '../../data/uploads')

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 8,
  },
})

const router = Router()

function ok<T>(data: T, message?: string): ApiSuccess<T> {
  return { code: 0, data, message }
}

router.post('/files', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ code: 400, message: '请选择要上传的文件' })
      return
    }
    const record = saveUploadedFile(req.file)
    res.status(201).json(
      ok(
        {
          id: record.id,
          name: record.originalName,
          sizeBytes: record.sizeBytes,
          mimeType: record.mimeType,
        },
        '文件上传成功',
      ),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '上传失败'
    res.status(400).json({ code: 400, message })
  }
})

router.get('/files/:id', (req, res) => {
  try {
    const record = getUploadedFile(req.params.id)
    if (!record) {
      res.status(404).json({ code: 404, message: '文件不存在或已失效' })
      return
    }
    res.setHeader('Content-Type', record.mimeType)
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`)
    createUploadedFileStream(record).pipe(res)
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取文件失败'
    res.status(400).json({ code: 400, message })
  }
})

export default router
