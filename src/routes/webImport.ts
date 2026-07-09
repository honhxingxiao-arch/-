import { Router } from 'express'
import { discoverWebImportPages } from '../services/webImportService.js'
import type { ApiSuccess, WebImportDiscoverRequest } from '../types.js'

const router = Router()

function ok<T>(data: T, message?: string): ApiSuccess<T> {
  return { code: 0, data, message }
}

router.post('/discover', async (req, res) => {
  try {
    const body = req.body as WebImportDiscoverRequest
    const result = await discoverWebImportPages(body)
    res.json(ok(result, '页面发现完成'))
  } catch (error) {
    const message = error instanceof Error ? error.message : '页面发现失败'
    res.status(400).json({ code: 400, message })
  }
})

export default router
