import type { EngineInterface } from 'claude-code'

import { DEBUG_ARGUMENT, OWN_COMMAND } from './lib/commands'
import { listAtRow, stackBlocks } from './lib/layout'
import { canListMove, readSectionOpen, scrollList } from './lib/lists'
import type { ListId } from './lib/lists'
import { PANE } from './lib/pane'
import { claudeConfigDirectory } from './lib/paths'
import { readTrace, record } from './lib/trace'
import type { Settings, ToggleableSection } from './lib/settings'
import type { PaneInput } from './lib/view'
import { catchUpWatchers } from './refresh'
import { drawActivity } from './sections/activity'
import { countConversations, drawConversations } from './sections/conversations'
import { countFiles, drawFiles } from './sections/files'
import { drawFooter } from './sections/footer'
import { drawHeader } from './sections/header'
import { drawHelp } from './sections/help'
import { drawKeepAwake } from './sections/keepAwake'
import { drawLogo } from './sections/logo'
import { countServers, drawMcp, isMcpShown } from './sections/mcp'
import { countNotes, drawNotes } from './sections/notes'
import { countSessions, drawSessions } from './sections/sessions'
import { drawSettings } from './sections/settings'
import { countSkills, drawSkills } from './sections/skills'
import { drawTodos } from './sections/todos'
import { drawContext, drawLimits } from './sections/usage'

const PANE_TITLE = 'Session'
const PANE_COLUMNS = 42
const OPEN_KEY = 'open'
const DEBUG_LOG_FILE = 'session-cockpit.debug.log'

const WHEEL_LISTS: readonly (ListId & ToggleableSection)[] = ['skills', 'sessions', 'conversations', 'notes', 'files', 'mcp']

let paneOffset = 0
let listSpans: ReturnType<typeof stackBlocks> = []

export const canPaneMove = (by: number, contentRows: number, bodyRows: number) =>
  by > 0 ? paneOffset < Math.max(0, contentRows - bodyRows) : paneOffset > 0

export const rememberPaneOffset = (offset: number) => {
  paneOffset = offset
}

export async function openSidebar($: EngineInterface, isRaised: boolean) {
  return $.ui.open({
    id: PANE,
    title: PANE_TITLE,
    columns: PANE_COLUMNS,
    ...(isRaised ? { focus: true as const } : {}),
  })
}

export async function isSidebarWanted($: EngineInterface) {
  const stored = await $.store.get(OPEN_KEY)

  return typeof stored === 'boolean' ? stored : true
}

export async function rememberSidebarClosed($: EngineInterface) {
  record('close mark: closed and remembered')
  await $.store.set(OPEN_KEY, false).catch(() => undefined)
}

export async function registerSidebarCommand($: EngineInterface) {
  await $.command.register({
    name: OWN_COMMAND,
    description: 'Show or hide the opencode-style session sidebar',
    argumentHint: `[${DEBUG_ARGUMENT}]`,
    immediate: true,
  })
}

export async function runSidebarCommand($: EngineInterface, args: string) {
  if (args === DEBUG_ARGUMENT) {
    const path = `${await claudeConfigDirectory($)}/${DEBUG_LOG_FILE}`
    const trace = readTrace()
    await $.fs.write(path, `${trace.join('\n')}\n`)

    return { text: `Sidebar trace (${trace.length} entries) written to ${path}` }
  }

  const pane = (await $.ui.panes()).find(open => open.id === PANE)
  record(`/sidebar: pane ${pane ? `shown=${pane.isShown} placed=${pane.isPlaced}` : 'absent'}`)
  if (pane?.isShown && pane.isPlaced) {
    await Promise.all([$.ui.close({ id: PANE }), $.store.set(OPEN_KEY, false)])

    return { text: 'Sidebar closed.' }
  }

  await $.store.set(OPEN_KEY, true)
  const opened = await openSidebar($, true)
  if (opened.isPlaced) await catchUpWatchers($)

  return { text: opened.isPlaced ? 'Sidebar shown.' : `Sidebar waits: ${opened.reason}` }
}

async function countList($: EngineInterface, id: ListId) {
  switch (id) {
    case 'skills':
      return countSkills($)
    case 'sessions':
      return countSessions($)
    case 'conversations':
      return countConversations($)
    case 'notes':
      return countNotes($)
    case 'files':
      return countFiles($)
    case 'mcp':
      return countServers($)
  }
}

async function isListShown($: EngineInterface, id: ListId) {
  return id === 'mcp' ? isMcpShown($) : readSectionOpen($, id)
}

export async function scrollFirstMovableList($: EngineInterface, by: number, settings: Settings) {
  for (const id of WHEEL_LISTS) {
    if (!settings.isShown(id) || !(await isListShown($, id))) continue
    const count = await countList($, id)
    if (await canListMove($, id, by, count)) {
      await scrollList($, id, by, count)

      return true
    }
  }

  return false
}

export async function scrollListUnderPointer($: EngineInterface, row: number, by: number) {
  const id = listAtRow(listSpans, paneOffset + row)
  if (id === null) return false
  const count = await countList($, id)
  if (!(await canListMove($, id, by, count))) return false
  await scrollList($, id, by, count)

  return true
}

export async function drawPane($: EngineInterface, e: PaneInput, settings: Settings) {
  paneOffset = e.props.scroll.offset
  const { Box } = $.ui.resolve(e)
  const [logo, header, keepAwake, context, limits, skills, sessions, conversations, notes, files, mcp, activity, todos, help, settingsSection, footer] =
    await Promise.all([
      settings.isShown('logo') ? drawLogo($, e) : null,
      drawHeader($, e),
      settings.isShown('keepAwake') ? drawKeepAwake($, e) : null,
      settings.isShown('context') ? drawContext($, e, settings.thresholds) : null,
      settings.isShown('usage') ? drawLimits($, e) : null,
      settings.isShown('skills') ? drawSkills($, e) : null,
      settings.isShown('sessions') ? drawSessions($, e) : null,
      settings.isShown('conversations') ? drawConversations($, e) : null,
      settings.isShown('notes') ? drawNotes($, e) : null,
      settings.isShown('files') ? drawFiles($, e) : null,
      settings.isShown('mcp') ? drawMcp($, e) : null,
      settings.isShown('activity') ? drawActivity($, e) : null,
      settings.isShown('todos') ? drawTodos($, e) : null,
      settings.isShown('help') ? drawHelp($, e) : null,
      drawSettings($, e, settings),
      drawFooter($, e),
    ])

  listSpans = stackBlocks([logo, header, keepAwake, context, limits, skills, sessions, conversations, notes, files, mcp])

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      {logo?.element}
      {header.element}
      {keepAwake?.element}
      {context?.element}
      {limits?.element}
      {skills?.element}
      {sessions?.element}
      {conversations?.element}
      {notes?.element}
      {files?.element}
      {mcp?.element}
      {activity}
      {todos}
      {help}
      {settingsSection}
      {footer}
    </Box>
  )
}
