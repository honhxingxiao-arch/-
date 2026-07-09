import { getEmbeddingConfig, type EmbeddingProvider } from '../config/embedding.js'
import { embedTextLocal } from '../utils/localEmbedding.js'

interface EmbeddingApiResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  model?: string
}

export interface EmbeddingBatchResult {
  provider: EmbeddingProvider
  model: string
  embeddings: number[][]
}

async function requestEmbeddings(inputs: string[]): Promise<EmbeddingBatchResult> {
  const config = getEmbeddingConfig()
  if (config.provider !== 'api' || !config.apiKey) {
    return {
      provider: 'local',
      model: 'local-hash-v1',
      embeddings: inputs.map((text) => embedTextLocal(text)),
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(`${config.apiBase}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: inputs,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Embedding API ${response.status}: ${detail.slice(0, 240)}`)
    }

    const payload = (await response.json()) as EmbeddingApiResponse
    const sorted = [...payload.data].sort((a, b) => a.index - b.index)
    return {
      provider: 'api',
      model: payload.model ?? config.model,
      embeddings: sorted.map((item) => item.embedding),
    }
  } catch (error) {
    console.warn('[embedding] API failed, falling back to local embeddings:', error)
    return {
      provider: 'local',
      model: 'local-hash-v1',
      embeddings: inputs.map((text) => embedTextLocal(text)),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function embedTexts(inputs: string[]): Promise<EmbeddingBatchResult> {
  if (!inputs.length) {
    return { provider: 'local', model: 'local-hash-v1', embeddings: [] }
  }

  const config = getEmbeddingConfig()
  if (config.provider === 'local') {
    return {
      provider: 'local',
      model: 'local-hash-v1',
      embeddings: inputs.map((text) => embedTextLocal(text)),
    }
  }

  const embeddings: number[][] = []
  let provider: EmbeddingProvider = 'api'
  let model = config.model

  for (let start = 0; start < inputs.length; start += config.batchSize) {
    const batch = inputs.slice(start, start + config.batchSize)
    const result = await requestEmbeddings(batch)
    embeddings.push(...result.embeddings)
    provider = result.provider
    model = result.model
  }

  return { provider, model, embeddings }
}

export async function embedQuery(text: string): Promise<{ embedding: number[]; provider: EmbeddingProvider; model: string }> {
  const result = await embedTexts([text])
  return {
    embedding: result.embeddings[0] ?? embedTextLocal(text),
    provider: result.provider,
    model: result.model,
  }
}
