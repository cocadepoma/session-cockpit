import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarFile } from '../../types'
import { resetListOffset } from '../lib/lists'
import { describeError, record } from '../lib/trace'
import { countChanges, pathOfSnapshot, readChanges, removeSnapshots, snapshotDirectory, snapshotName } from './snapshots'

const filesState = atom({ plugin: 'session-cockpit', key: 'files' } as const, [])

export const withCounts = (path: string, hunks: string | null): SidebarFile => ({
  path,
  ...(hunks === null ? { added: 0, removed: 0 } : countChanges(hunks)),
})

export async function readEditedFiles($: EngineInterface) {
  return read($, filesState)
}

export async function replaceEditedFile($: EngineInterface, file: SidebarFile) {
  await update($, filesState, files => files.map(known => (known.path === file.path ? file : known)))
}

export async function recordEdit($: EngineInterface, path: string, baseline: string | null) {
  try {
    const directory = await snapshotDirectory($, await $.session.id())
    if (baseline !== null) await $.fs.write(`${directory}/${snapshotName(path)}`, baseline)
    if (!(await $.fs.exists(`${directory}/${snapshotName(path)}`))) return
    const file = withCounts(path, await readChanges($, directory, path))
    await update($, filesState, files =>
      files.some(known => known.path === path)
        ? files.map(known => (known.path === path ? file : known))
        : [...files, file],
    )
  } catch (error) {
    record(`edit of ${path} not tracked: ${describeError(error)}`)
  }
}

export async function loadFiles($: EngineInterface) {
  const directory = await snapshotDirectory($, await $.session.id())
  const entries = await $.fs.list(directory).catch(() => [])
  const tracked = entries
    .filter(entry => entry.kind === 'file')
    .sort((first, second) => first.mtimeMs - second.mtimeMs)
    .map(entry => pathOfSnapshot(entry.name))
  const files = await Promise.all(
    tracked.map(async (path): Promise<SidebarFile> => withCounts(path, await readChanges($, directory, path))),
  )
  await update($, filesState, () => files)

  return `${files.length} files`
}

export async function forgetFiles($: EngineInterface, sessionId: string | null) {
  await Promise.all([update($, filesState, () => []), resetListOffset($, 'files')])
  await removeSnapshots($, sessionId)
}
