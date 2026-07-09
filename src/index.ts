import { loadEnvFiles } from './config/loadEnv.js'
import { createApp } from './app.js'

loadEnvFiles()

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST?.trim() || '0.0.0.0'

const app = createApp()

app.listen(PORT, HOST, () => {
  console.log(`Knowledge base API listening on http://${HOST}:${PORT}`)
})
