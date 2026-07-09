export type EmbeddingProvider = 'api' | 'local'

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  apiKey: string | null
  apiBase: string
  model: string
  batchSize: number
  timeoutMs: number
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

export function getEmbeddingConfig(): EmbeddingConfig {
  const apiKey = process.env.EMBEDDING_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null
  const forcedProvider = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase()
  const provider: EmbeddingProvider =
    forcedProvider === 'local' ? 'local' : apiKey ? 'api' : 'local'

  return {
    provider,
    apiKey,
    apiBase: normalizeBaseUrl(
      process.env.EMBEDDING_API_BASE?.trim() || 'https://api.openai.com/v1',
    ),
    model: process.env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    batchSize: Math.min(64, Math.max(1, Number(process.env.EMBEDDING_BATCH_SIZE) || 16)),
    timeoutMs: Math.max(3000, Number(process.env.EMBEDDING_TIMEOUT_MS) || 30000),
  }
}

export function getEmbeddingPublicStatus() {
  const config = getEmbeddingConfig()
  return {
    provider: config.provider,
    model: config.model,
    apiBase: config.apiBase,
    configured: config.provider === 'api' && Boolean(config.apiKey),
  }
}
