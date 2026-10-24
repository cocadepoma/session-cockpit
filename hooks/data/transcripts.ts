import type { EngineInterface } from 'claude-code'

import { PROCESS_TIMEOUT_MS } from '../lib/process'

const TITLE_PATTERN = '"(customTitle|aiTitle)":"([^"\\\\]|\\\\.)*"'

const parseTitleMatch = (match: string) => {
  try {
    const title: unknown = JSON.parse(match.slice(match.indexOf(':') + 1))

    return typeof title === 'string' ? { title, isCustom: match.startsWith('"customTitle"') } : null
  } catch {
    return null
  }
}

export async function readTitles($: EngineInterface, paths: readonly string[]) {
  const titles = new Map<string, string>()
  if (paths.length === 0) return titles
  const found = await $.process
    .run(['grep', '-HoE', TITLE_PATTERN, ...paths], { timeoutMs: PROCESS_TIMEOUT_MS })
    .catch(() => null)
  const customTitles = new Map<string, string>()
  for (const line of found?.stdout.split('\n') ?? []) {
    const separator = line.indexOf(':"')
    const entry = separator < 0 ? null : parseTitleMatch(line.slice(separator + 1))
    if (!entry) continue
    const path = line.slice(0, separator)
    if (entry.isCustom) customTitles.set(path, entry.title)
    else titles.set(path, entry.title)
  }
  for (const [path, title] of customTitles) titles.set(path, title)

  return titles
}
