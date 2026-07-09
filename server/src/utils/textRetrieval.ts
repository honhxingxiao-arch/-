const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/

export interface RetrievalDocument {
  id: string
  documentId: string
  fragmentId: string
  documentName: string
  content: string
  index?: number
  charCount?: number
  embedding?: number[]
}

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().trim()
  if (!normalized) return []

  const segments = normalized
    .split(/[\s,，。；;、？?！!：:（）()\[\]【】「」『』""''·\-_/]+/)
    .filter(Boolean)
  const tokens: string[] = []

  for (const segment of segments) {
    if (segment.length >= 2) tokens.push(segment)

    if (!CJK_RE.test(segment)) continue

    for (let i = 0; i < segment.length - 1; i += 1) {
      const pair = segment.slice(i, i + 2)
      if (CJK_RE.test(pair[0]!) && CJK_RE.test(pair[1]!)) tokens.push(pair)
    }

    for (const char of segment) {
      if (CJK_RE.test(char)) tokens.push(char)
    }
  }

  return tokens
}

function termFrequency(tokens: string[]) {
  const freq = new Map<string, number>()
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1)
  }
  return freq
}

function buildTfidfVector(tokens: string[], idf: Map<string, number>) {
  const tf = termFrequency(tokens)
  const vector = new Map<string, number>()
  const maxTf = Math.max(...tf.values(), 1)

  for (const [term, count] of tf) {
    const tfNorm = 0.5 + 0.5 * (count / maxTf)
    vector.set(term, tfNorm * (idf.get(term) ?? 0))
  }

  return vector
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0
  let normA = 0
  let normB = 0

  for (const value of a.values()) normA += value * value
  for (const value of b.values()) normB += value * value

  const smaller = a.size <= b.size ? a : b
  const other = a.size <= b.size ? b : a

  for (const [term, value] of smaller) {
    const otherValue = other.get(term)
    if (otherValue) dot += value * otherValue
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function keywordOverlapScore(query: string, haystack: string) {
  const qTokens = tokenize(query)
  if (!qTokens.length) return 0

  const normalizedHaystack = haystack.toLowerCase()
  let hits = 0
  for (const token of qTokens) {
    if (normalizedHaystack.includes(token)) hits += 1
  }

  return hits / qTokens.length
}

export function scoreDocuments(
  query: string,
  documents: RetrievalDocument[],
  method: 'semantic' | 'keyword' | 'hybrid',
): Array<RetrievalDocument & { score: number }> {
  if (!documents.length) return []

  const queryTokens = tokenize(`${query} ${query}`)
  const docTokens = documents.map((doc) =>
    tokenize(`${doc.documentName} ${doc.content}`),
  )

  const df = new Map<string, number>()
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }

  const idf = new Map<string, number>()
  const n = documents.length
  for (const [term, count] of df) {
    idf.set(term, Math.log(1 + n / count))
  }

  const queryVector = buildTfidfVector(queryTokens, idf)

  return documents.map((doc, index) => {
    const haystack = `${doc.documentName} ${doc.content}`
    const semantic = cosineSimilarity(queryVector, buildTfidfVector(docTokens[index]!, idf))
    const keyword = keywordOverlapScore(query, haystack)

    let score = semantic
    if (method === 'keyword') score = keyword
    if (method === 'hybrid') score = semantic * 0.65 + keyword * 0.35

    const phraseBonus =
      query.trim().length >= 2 && haystack.toLowerCase().includes(query.trim().toLowerCase())
        ? 0.12
        : 0

    return {
      ...doc,
      score: Number(Math.min(0.99, score + phraseBonus).toFixed(4)),
    }
  })
}
