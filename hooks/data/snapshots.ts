import type { EngineInterface } from 'claude-code'

import { claudeConfigDirectory, relativePath } from '../lib/paths'
import { PROCESS_TIMEOUT_MS } from '../lib/process'
import { describeError, record } from '../lib/trace'
import { readSessionRegistry, runningPids } from './registry'

const SNAPSHOT_DIRECTORY = 'session-cockpit/diffs'
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const snapshotName = (path: string) => path.replace(/%/g, '%25').replace(/\//g, '%2F')

export const pathOfSnapshot = (name: string) =>
  name.replace(/%(2F|25)/g, (_, code: string) => (code === '2F' ? '/' : '%'))

export const countChanges = (hunks: string) => {
  const lines = hunks.split('\n')

  return {
    added: lines.filter(line => line.startsWith('+')).length,
    removed: lines.filter(line => line.startsWith('-')).length,
  }
}

export async function snapshotDirectory($: EngineInterface, sessionId: string) {
  return `${await claudeConfigDirectory($)}/${SNAPSHOT_DIRECTORY}/${sessionId}`
}

export async function captureBaseline($: EngineInterface, path: string) {
  try {
    const directory = await snapshotDirectory($, await $.session.id())
    if (await $.fs.exists(`${directory}/${snapshotName(path)}`)) return null

    return (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  } catch (error) {
    record(`baseline of ${path} skipped: ${describeError(error)}`)

    return null
  }
}

export async function readChanges($: EngineInterface, directory: string, path: string) {
  const cwd = await $.session.cwd()
  const label = relativePath(path, cwd)
  const current = (await $.fs.exists(path)) ? path : '/dev/null'
  const ran = await $.process
    .run(
      ['diff', '-u', '--label', `a/${label}`, '--label', `b/${label}`, `${directory}/${snapshotName(path)}`, current],
      { timeoutMs: PROCESS_TIMEOUT_MS },
    )
    .catch(() => null)
  if (ran === null || ran.exitCode > 1) return null
  const start = ran.stdout.search(/^@@ /m)

  return start < 0 ? '' : ran.stdout.slice(start)
}

export async function removeSnapshots($: EngineInterface, sessionId: string | null) {
  if (sessionId === null || !SESSION_ID_PATTERN.test(sessionId)) return
  const directory = await snapshotDirectory($, sessionId)
  await $.process.run(['rm', '-rf', '--', directory], { timeoutMs: PROCESS_TIMEOUT_MS }).catch(() => null)
}

export async function pruneSnapshots($: EngineInterface) {
  try {
    const [configDirectory, currentId, now] = await Promise.all([claudeConfigDirectory($), $.session.id(), $.clock.now()])
    const root = `${configDirectory}/${SNAPSHOT_DIRECTORY}`
    const listed = await $.fs.list(root).catch(() => [])
    const old = listed.filter(
      entry =>
        entry.kind === 'dir' &&
        SESSION_ID_PATTERN.test(entry.name) &&
        entry.name !== currentId &&
        now - entry.mtimeMs > SNAPSHOT_TTL_MS,
    )
    if (old.length === 0) return
    const registry = await readSessionRegistry($, configDirectory)
    if (!registry.some(entry => entry.sessionId === currentId)) return
    const running = await runningPids($, registry.map(entry => entry.pid))
    const live = new Set(registry.filter(entry => running.has(entry.pid)).map(entry => entry.sessionId))
    const expired = old.filter(entry => !live.has(entry.name))
    await Promise.all(expired.map(entry => removeSnapshots($, entry.name)))
    record(`pruned ${expired.length} old snapshot directories`)
  } catch (error) {
    record(`snapshot pruning failed: ${describeError(error)}`)
  }
}
