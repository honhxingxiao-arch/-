import cors from 'cors'
import express from 'express'
import importRouter from './routes/import.js'
import fragmentMediaRouter from './routes/fragmentMedia.js'
import knowledgeBasesRouter from './routes/knowledgeBases.js'
import webImportRouter from './routes/webImport.js'
import { initStore } from './services/store.js'

function createCorsOptions() {
  const raw = process.env.FRONTEND_ORIGIN?.trim()
  if (!raw) return undefined
  const origins = raw.split(',').map((item) => item.trim()).filter(Boolean)
  return {
    origin: origins.length === 1 ? origins[0] : origins,
  }
}

export function createApp() {
  initStore()

  const app = express()
  app.use(cors(createCorsOptions()))
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api/import', importRouter)
  app.use('/api/fragment-media', fragmentMediaRouter)
  app.use('/api/web-import', webImportRouter)
  app.use('/api/knowledge-bases', knowledgeBasesRouter)

  app.use((_req, res) => {
    res.status(404).json({ code: 404, message: '接口不存在' })
  })

  return app
}
