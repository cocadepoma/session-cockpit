import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarDiff } from '../../types'
import { replaceEditedFile } from '../data/editedFiles'
import { readGitChanges, replaceGitFile } from '../data/git'
import { readMeta } from '../data/meta'
import { countChanges, readChanges, snapshotDirectory, snapshotName } from '../data/snapshots'
import { PANE } from '../lib/pane'
import { relativePath } from '../lib/paths'
import type { PaneInput } from '../lib/view'

const DIFF_MAX_CHARS = 100_000
const NO_CHANGES_NOTE = 'No changes since the session began'
const NO_GIT_CHANGES_NOTE = 'No changes against HEAD'

const diffState = atom({ plugin: 'session-cockpit', key: 'diff' } as const, null)

const viewDiff = (path: string, hunks: string, emptyNote = NO_CHANGES_NOTE): SidebarDiff => {
  if (hunks.trim() === '') return { path, source: '', note: emptyNote }
  if (hunks.length <= DIFF_MAX_CHARS) return { path, source: hunks, note: null }
  const all = hunks.split(/\n(?=@@ )/)
  const kept: string[] = []
  let length = 0
  for (const hunk of all) {
    if (length + hunk.length + 1 > DIFF_MAX_CHARS) break
    kept.push(hunk)
    length += hunk.length + 1
  }
  const note = `Too large to show in full: ${kept.length} of ${all.length} hunks shown`

  return { path, source: kept.join('\n'), note }
}

export async function openDiff($: EngineInterface, path: string) {
  const directory = await snapshotDirectory($, await $.session.id())
  const isSession = await $.fs.exists(`${directory}/${snapshotName(path)}`)
  const hunks = isSession ? await readChanges($, directory, path) : await readGitChanges($, path)
  const diff: SidebarDiff =
    hunks === null
      ? { path, source: '', note: 'Could not compute the diff' }
      : viewDiff(path, hunks, isSession ? NO_CHANGES_NOTE : NO_GIT_CHANGES_NOTE)
  const file = { path, ...countChanges(hunks ?? '') }
  await Promise.all([
    update($, diffState, () => diff),
    isSession ? replaceEditedFile($, file) : replaceGitFile($, file),
  ])
  await $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
}

export async function readDiff($: EngineInterface) {
  return read($, diffState)
}

async function clearDiff($: EngineInterface) {
  const diff = await read($, diffState)
  if (diff === null) return null
  await update($, diffState, () => null)

  return diff
}

export async function resetDiff($: EngineInterface) {
  await clearDiff($)
}

async function closeDiff($: EngineInterface) {
  const diff = await clearDiff($)
  if (diff !== null) await $.ui.scroll({ in: PANE, to: { key: `file:${diff.path}` }, block: 'center' }).catch(() => undefined)
}

export async function drawDiffView($: EngineInterface, e: PaneInput) {
  const { Box, Button, Code, Text } = $.ui.resolve(e)
  const [diff, meta] = await Promise.all([read($, diffState), readMeta($)])
  if (diff === null) return <Box />

  return (
    <Box flexDirection="column" paddingX={1}>
      <Button key="diff-back" variant="primary" hotkey="b" onPress={() => void closeDiff($)}>
        ← Back (b)
      </Button>
      <Text> </Text>
      <Text bold wrap="truncate-start">
        {relativePath(diff.path, meta.cwd)}
      </Text>
      {diff.note !== null && <Text color="inactive">{diff.note}</Text>}
      {diff.source !== '' && <Code source={diff.source} format="diff" path={diff.path} />}
    </Box>
  )
}
