import { atom, read, update } from 'claude-code'
import type { ContextMcpTool, EngineInterface, SessionContextBreakdown } from 'claude-code'

import type { SidebarContextRow } from '../../types'
import { flip, remember, shown } from '../lib/lastShown'
import type { Block } from '../lib/layout'
import { baseName } from '../lib/paths'
import { describeError, record } from '../lib/trace'
import { storedFlag } from '../lib/values'
import { formatTokens } from '../lib/text'
import type { PaneInput } from '../lib/view'

const DETAILS_KEY = 'contextDetailsOpen'
const TOP_ROWS = 5

const INITIAL_DETAILS = { categories: [], window: null, files: null, servers: null, isMeasuring: false }

const openState = atom({ plugin: 'session-cockpit', key: 'isContextDetailsOpen' } as const, false)
const detailsState = atom({ plugin: 'session-cockpit', key: 'contextDetails' } as const, INITIAL_DETAILS)

const largestFirst = (rows: SidebarContextRow[]) => rows.toSorted((a, b) => b.tokens - a.tokens)

const serversOf = (tools: ContextMcpTool[]) => {
  const totals = new Map<string, number>()
  for (const tool of tools) {
    if (tool.isLoaded) totals.set(tool.serverName, (totals.get(tool.serverName) ?? 0) + tool.tokens)
  }

  return largestFirst([...totals].map(([name, tokens]) => ({ name, tokens }))).slice(0, TOP_ROWS)
}

const categoriesOf = (breakdown: SessionContextBreakdown) =>
  largestFirst(breakdown.categories.filter(category => category.kind === 'used').map(({ name, tokens }) => ({ name, tokens })))

export async function restoreContextDetails($: EngineInterface) {
  const stored = await $.store.get(DETAILS_KEY)
  await update($, openState, current => remember(openState, storedFlag(stored, current)))
}

export async function resetMeasurement($: EngineInterface) {
  await update($, detailsState, () => INITIAL_DETAILS)
}

export async function refreshBreakdown($: EngineInterface) {
  if (!(await read($, openState).then(shown(openState)))) return
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const breakdown = usage?.context.breakdown
  if (breakdown === undefined) return
  await update($, detailsState, details => ({
    ...details,
    categories: categoriesOf(breakdown),
    window: breakdown.rawMaxTokens > 0 ? breakdown.rawMaxTokens : null,
  }))
}

async function toggleDetails($: EngineInterface) {
  const isOpen = flip(openState, await read($, openState))
  await Promise.all([update($, openState, () => isOpen), $.store.set(DETAILS_KEY, isOpen)])
  if (isOpen) await refreshBreakdown($)
}

async function measure($: EngineInterface) {
  const current = await read($, detailsState)
  if (current.isMeasuring) return
  await update($, detailsState, details => ({ ...details, isMeasuring: true }))
  try {
    const usage = await $.session.usage({ breakdown: 'full' })
    const breakdown = usage.context.breakdown
    const files = largestFirst((breakdown?.memoryFiles ?? []).map(({ path, tokens }) => ({ name: baseName(path), tokens })))
    await update($, detailsState, details => ({
      ...details,
      files: files.slice(0, TOP_ROWS),
      servers: serversOf(breakdown?.mcpTools ?? []),
      isMeasuring: false,
    }))
  } catch (error) {
    record(`context measure failed: ${describeError(error)}`)
    await update($, detailsState, details => ({ ...details, isMeasuring: false }))
  }
}

function drawRows($: EngineInterface, e: PaneInput, group: string, rows: SidebarContextRow[], window: number | null) {
  const { Box, Text } = $.ui.resolve(e)

  return rows.map(row => (
    <Box key={`context-${group}:${row.name}`} flexDirection="row" gap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{row.name}</Text>
      </Box>
      <Text color="inactive">{formatTokens(row.tokens)}</Text>
      {window !== null && <Text color="inactive">{`${Math.round((row.tokens / window) * 100)}%`}</Text>}
    </Box>
  ))
}

export async function drawContextDetails($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const [isOpen, details] = await Promise.all([read($, openState).then(shown(openState)), read($, detailsState)])
  const isMeasured = details.files !== null
  const files = details.files ?? []
  const servers = details.servers ?? []
  const isEmpty = isMeasured && details.files?.length === 0 && details.servers?.length === 0
  const rows = isOpen
    ? 1 +
      (details.categories.length === 0 ? 1 : details.categories.length) +
      (files.length > 0 ? 1 + files.length : 0) +
      (servers.length > 0 ? 1 + servers.length : 0) +
      (isEmpty ? 1 : 0) +
      1
    : 1

  const element = (
    <Box flexDirection="column">
      <Button key="context-details-toggle" plain onPress={() => void toggleDetails($)}>
        {isOpen ? '▼' : '▶'} <Text color="inactive">details</Text>
      </Button>
      {isOpen && (
        <Box flexDirection="column">
          {details.categories.length === 0 && <Text color="inactive">No breakdown yet</Text>}
          {drawRows($, e, 'category', details.categories, details.window)}
          {files.length > 0 && <Text bold>Memory files</Text>}
          {drawRows($, e, 'file', files, null)}
          {servers.length > 0 && <Text bold>MCP servers</Text>}
          {drawRows($, e, 'server', servers, null)}
          {isEmpty && <Text color="inactive">No memory files or MCP tools loaded</Text>}
          <Button key="context-measure" plain onPress={() => void measure($)}>
            <Text color="suggestion">{details.isMeasuring ? 'measuring…' : isMeasured ? 're-measure' : 'measure'}</Text>
          </Button>
        </Box>
      )}
    </Box>
  )

  return { element, rows }
}
