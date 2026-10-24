import type { EngineInterface } from 'claude-code'

import { readMeta } from '../data/meta'
import {
  filterList,
  listWindow,
  readListFilter,
  readListOffset,
  readSectionOpen,
  setListFilter,
} from '../lib/lists'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import { drawFilter, drawFold, drawListScroller } from '../lib/view'
import type { PaneInput } from '../lib/view'

const COLLAPSIBLE_MIN_ITEMS = 3

const isMcpCollapsible = (servers: string[]) => servers.length >= COLLAPSIBLE_MIN_ITEMS

const isMcpListOpen = (servers: string[], isOpen: boolean) => !isMcpCollapsible(servers) || isOpen

const filterServers = (servers: string[], filter: string) =>
  isMcpCollapsible(servers) ? filterList(servers, filter, server => [server]) : servers

export async function countServers($: EngineInterface) {
  const [meta, filter] = await Promise.all([readMeta($), readListFilter($, 'mcp')])

  return filterServers(meta.mcpServers, filter).length
}

export async function isMcpShown($: EngineInterface) {
  const [meta, isOpen] = await Promise.all([readMeta($), readSectionOpen($, 'mcp')])

  return isMcpListOpen(meta.mcpServers, isOpen)
}

export async function drawMcp($: EngineInterface, e: PaneInput): Promise<Block | null> {
  const { Box, Text } = $.ui.resolve(e)
  const [meta, filter, offset, isOpen] = await Promise.all([
    readMeta($),
    readListFilter($, 'mcp'),
    readListOffset($, 'mcp'),
    readSectionOpen($, 'mcp'),
  ])
  if (meta.mcpServers.length === 0) return null
  const isDropdown = isMcpCollapsible(meta.mcpServers)
  const matching = filterServers(meta.mcpServers, filter)
  const { start, visible } = listWindow(matching, offset)
  const filterRow = isDropdown
    ? drawFilter($, e, {
        id: 'mcp',
        placeholder: 'Filter servers…',
        submitLabel: 'clear',
        value: filter,
        onSubmit: () => void setListFilter($, 'mcp', ''),
      })
    : null

  const element = (
    <Box flexDirection="column">
      {isDropdown ? (
        drawFold($, e, {
          id: 'mcp',
          title: 'MCP',
          isOpen,
          suffix: <Text color="inactive">{isOpen ? '' : ` (${meta.mcpServers.length} active)`}</Text>,
        })
      ) : (
        <Text bold>MCP</Text>
      )}
      {isMcpListOpen(meta.mcpServers, isOpen) && (
        <Box flexDirection="column">
          {filterRow}
          {visible.map(server => (
            <Box key={server} flexDirection="row" gap={1}>
              <Text color="success">•</Text>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text bold wrap="truncate-end">
                  {server}
                </Text>
              </Box>
              <Text color="inactive">Connected</Text>
            </Box>
          ))}
          {drawListScroller($, e, 'mcp', { start, shown: visible.length, total: matching.length })}
          {matching.length === 0 && <Text color="inactive">No servers match</Text>}
        </Box>
      )}
    </Box>
  )

  return listBlock({
    id: 'mcp',
    element,
    isOpen: isMcpListOpen(meta.mcpServers, isOpen),
    hasFilter: filterRow !== null,
    windowRows: visible.length,
    total: matching.length,
    hasNotice: matching.length === 0,
  })
}
