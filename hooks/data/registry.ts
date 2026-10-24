import type { EngineInterface } from 'claude-code'

import { PROCESS_TIMEOUT_MS } from '../lib/process'

const PS_REUSE_MS = 5_000

export type RegistryEntry = { pid: number; sessionId: string; cwd: string; name: string; status: string; waitingFor: string | null }

type CachedRegistryFile = { mtimeMs: number; size: number; entry: RegistryEntry | null }

const registryFiles = new Map<string, CachedRegistryFile>()
let lastRunning: { key: string; at: number; pids: Set<number> } | null = null

const parseRegistryEntry = (value: unknown): RegistryEntry | null => {
  if (typeof value !== 'object' || value === null) return null
  const { pid, sessionId, cwd, name, status, waitingFor } = value as Record<string, unknown>
  if (typeof pid !== 'number' || typeof sessionId !== 'string' || typeof cwd !== 'string') return null

  return {
    pid,
    sessionId,
    cwd,
    name: typeof name === 'string' ? name : sessionId.slice(0, 8),
    status: typeof status === 'string' ? status : 'unknown',
    waitingFor: typeof waitingFor === 'string' && waitingFor !== '' ? waitingFor : null,
  }
}

export function forgetRegistryReads() {
  registryFiles.clear()
  lastRunning = null
}

export async function readSessionRegistry($: EngineInterface, configDirectory: string) {
  const directory = `${configDirectory}/sessions`
  const entries = await $.fs.list(directory).catch(() => [])
  const files = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
  const listed = new Set(files.map(entry => `${directory}/${entry.name}`))
  for (const path of registryFiles.keys()) if (!listed.has(path)) registryFiles.delete(path)
  const parsed = await Promise.all(
    files.map(async entry => {
      const path = `${directory}/${entry.name}`
      const cached = registryFiles.get(path)
      if (cached !== undefined && cached.mtimeMs === entry.mtimeMs && cached.size === entry.size) return cached.entry
      try {
        const text = await $.fs.read(path)
        let parsedEntry: RegistryEntry | null = null
        try {
          parsedEntry = parseRegistryEntry(JSON.parse(text))
        } catch {
          parsedEntry = null
        }
        registryFiles.set(path, { mtimeMs: entry.mtimeMs, size: entry.size, entry: parsedEntry })

        return parsedEntry
      } catch {
        return null
      }
    }),
  )

  return parsed.filter(entry => entry !== null)
}

export async function runningPids($: EngineInterface, pids: readonly number[]) {
  if (pids.length === 0) return new Set<number>()
  const key = pids.toSorted((first, second) => first - second).join(',')
  const now = await $.clock.now()
  if (lastRunning !== null && lastRunning.key === key && now - lastRunning.at < PS_REUSE_MS) return lastRunning.pids
  const listed = await $.process
    .run(['ps', '-p', pids.join(','), '-o', 'pid='], { timeoutMs: PROCESS_TIMEOUT_MS })
    .catch(() => null)
  if (!listed) return new Set(pids)
  const running = new Set(listed.stdout.split('\n').map(line => Number(line.trim())).filter(pid => pid > 0))
  lastRunning = { key, at: now, pids: running }

  return running
}
