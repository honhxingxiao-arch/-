import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '../../..')
const SERVER_DIR = join(__dirname, '../..')

function parseEnvFile(content: string) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator <= 0) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return
  parseEnvFile(readFileSync(path, 'utf-8'))
}

export function loadEnvFiles() {
  loadEnvFile(join(SERVER_DIR, '.env'))
  loadEnvFile(join(ROOT_DIR, '.env'))
  loadEnvFile(join(ROOT_DIR, '.env.local'))
}
