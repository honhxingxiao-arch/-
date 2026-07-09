import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED_KNOWLEDGE_BASES, SEED_RECYCLE_BIN } from '../data/seed.js'
import type { AppStore } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../../data')
const STORE_PATH = join(DATA_DIR, 'store.json')

let store: AppStore = {
  knowledgeBases: structuredClone(SEED_KNOWLEDGE_BASES),
  recycleBin: structuredClone(SEED_RECYCLE_BIN),
  documentRecycleBin: [],
  uploadedFiles: [],
}

function persist() {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

export function initStore() {
  if (existsSync(STORE_PATH)) {
    try {
      const raw = readFileSync(STORE_PATH, 'utf-8')
      store = JSON.parse(raw) as AppStore
      if (!Array.isArray(store.uploadedFiles)) {
        store.uploadedFiles = []
      }
      if (!Array.isArray(store.documentRecycleBin)) {
        store.documentRecycleBin = []
      }
      return
    } catch {
      // fall through to seed
    }
  }
  store = {
    knowledgeBases: structuredClone(SEED_KNOWLEDGE_BASES),
    recycleBin: structuredClone(SEED_RECYCLE_BIN),
    documentRecycleBin: [],
    uploadedFiles: [],
  }
  persist()
}

export function getStore(): AppStore {
  return store
}

export function updateStore(mutator: (draft: AppStore) => void) {
  mutator(store)
  persist()
}

export function resetStoreToSeed() {
  store = {
    knowledgeBases: structuredClone(SEED_KNOWLEDGE_BASES),
    recycleBin: structuredClone(SEED_RECYCLE_BIN),
    documentRecycleBin: [],
    uploadedFiles: [],
  }
  persist()
}
