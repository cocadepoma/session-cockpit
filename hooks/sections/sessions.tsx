import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarOpenSession } from '../../types'
import { arrangeAgents, forgetAgentReads, readPublishedAgents } from '../data/agents'
import { readMeta } from '../data/meta'
import { forgetRegistryReads, readSessionRegistry, runningPids } from '../data/registry'
import type { RegistryEntry } from '../data/registry'
import { readTitles } from '../data/transcripts'
import { shown } from '../lib/lastShown'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import { filterList, listWindow, readListFilter, readListOffset, readSectionOpen, setListFilter } from '../lib/lists'
import { baseName, claudeConfigDirectory, transcriptPath } from '../lib/paths'
import { truncate } from '../lib/text'
import { hasChanged } from '../lib/values'
import { drawFilter, drawFold, drawListScroller } from '../lib/view'
import type { PaneInput } from '../lib/view'

const SESSION_TITLE_TTL_MS = 60_000
const SESSION_STATUSES: Record<string, { label: string; color: string; rank: number }> = {
  waiting: { label: 'waiting', color: 'warning', rank: 0 },
  busy: { label: 'working', color: 'claude', rank: 1 },
  idle: { label: 'done', color: 'success', rank: 2 },
}
const UNKNOWN_SESSION_STATUS_RANK = 3
const SESSION_STATUS_MAX_WIDTH = 24
const AGENT_STATUS_COLORS: Record<string, string> = { running: 'claude', waiting: 'warning' }

const openSessionsState = atom({ plugin: 'session-cockpit', key: 'openSessions' } as const, [])

const sessionTitleCache = new Map<string, { title: string | null; checkedAt: number }>()

const filterSessions = (sessions: SidebarOpenSession[], filter: string) =>
  filterList(sessions, filter, session => [session.project, session.title])

const sessionStatusRank = (session: SidebarOpenSession) =>
  SESSION_STATUSES[session.status]?.rank ?? UNKNOWN_SESSION_STATUS_RANK

async function readOpenSessions($: EngineInterface) {
  return read($, openSessionsState).then(shown(openSessionsState))
}

export async function countSessions($: EngineInterface) {
  const [sessions, filter] = await Promise.all([readOpenSessions($), readListFilter($, 'sessions')])

  return filterSessions(sessions, filter).length
}

async function sessionTitles($: EngineInterface, configDirectory: string, entries: readonly RegistryEntry[]) {
  const now = Date.now()
  const transcriptOf = (entry: RegistryEntry) => transcriptPath(configDirectory, entry.cwd, entry.sessionId)
  const stale = entries.filter(entry => {
    const cached = sessionTitleCache.get(entry.sessionId)

    return !cached || now - cached.checkedAt > SESSION_TITLE_TTL_MS
  })
  const titles = await readTitles($, stale.map(transcriptOf))
  for (const entry of stale) {
    sessionTitleCache.set(entry.sessionId, { title: titles.get(transcriptOf(entry)) ?? null, checkedAt: now })
  }

  return (entry: RegistryEntry) => sessionTitleCache.get(entry.sessionId)?.title ?? entry.name
}

export function forgetSessionReads() {
  forgetRegistryReads()
  forgetAgentReads()
}

export async function refreshOpenSessions($: EngineInterface) {
  const [configDirectory, currentId] = await Promise.all([claudeConfigDirectory($), $.session.id()])
  const registry = await readSessionRegistry($, configDirectory)
  const running = await runningPids($, registry.map(entry => entry.pid))
  const alive = registry.filter(entry => running.has(entry.pid))
  const titleOf = await sessionTitles($, configDirectory, alive)
  const agentsOf = await readPublishedAgents($, configDirectory, alive.map(entry => entry.sessionId))
  const sessions = alive
    .map(entry => ({
      id: entry.sessionId,
      title: titleOf(entry),
      project: baseName(entry.cwd),
      status: entry.status,
      waitingFor: entry.waitingFor,
      isCurrent: entry.sessionId === currentId,
      agents: arrangeAgents(agentsOf.get(entry.sessionId) ?? []),
    }))
    .sort(
      (first, second) =>
        Number(second.isCurrent) - Number(first.isCurrent) ||
        sessionStatusRank(first) - sessionStatusRank(second) ||
        first.title.localeCompare(second.title),
    )
  const current = await read($, openSessionsState)
  if (hasChanged(current, sessions)) await update($, openSessionsState, () => sessions)

  return `${sessions.length} open sessions`
}

export async function drawSessions($: EngineInterface, e: PaneInput): Promise<Block | null> {
  const { Box, Text } = $.ui.resolve(e)
  const [sessions, filter, offset, isOpen, meta] = await Promise.all([
    readOpenSessions($),
    readListFilter($, 'sessions'),
    readListOffset($, 'sessions'),
    readSectionOpen($, 'sessions'),
    readMeta($),
  ])
  if (sessions.length === 0) return null
  const waitingSessions = sessions.filter(session => session.status === 'waiting').length
  const workingSessions = sessions.filter(session => session.status === 'busy').length
  const currentProject = baseName(meta.cwd)
  const matching = filterSessions(sessions, filter)
  const { start, visible } = listWindow(matching, offset)
  const windowRows = visible.reduce((sum, session) => sum + 1 + session.agents.length, 0)
  const filterRow = drawFilter($, e, {
    id: 'sessions',
    placeholder: 'Filter sessions…',
    submitLabel: 'clear',
    value: filter,
    onSubmit: () => void setListFilter($, 'sessions', ''),
  })

  const element = (
    <Box flexDirection="column">
      {drawFold($, e, {
        id: 'sessions',
        title: 'Sessions',
        isOpen,
        suffix: [
          <Text color="inactive">{` (${sessions.length}) `}</Text>,
          ...(waitingSessions > 0 ? [<Text color="warning">{`${waitingSessions} waiting`}</Text>] : []),
          ...(waitingSessions > 0 && workingSessions > 0 ? [<Text color="inactive">{' · '}</Text>] : []),
          ...(workingSessions > 0 ? [<Text color="claude">{`${workingSessions} working`}</Text>] : []),
          ...(waitingSessions === 0 && workingSessions === 0 ? [<Text color="success">all done</Text>] : []),
        ],
      })}
      {isOpen && (
        <Box flexDirection="column">
          {filterRow}
          {visible.map(session => {
            const status = SESSION_STATUSES[session.status]
            const color = status?.color ?? 'inactive'
            const label =
              session.project === currentProject ? session.title : `${session.project} · ${session.title}`
            const agentCount = session.agents.length
            const statusText =
              session.status === 'waiting' && session.waitingFor ? session.waitingFor : (status?.label ?? session.status)

            return (
              <Box key={`session:${session.id}`} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={color}>●</Text>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text bold={session.isCurrent} wrap="truncate-end">
                      {label}
                    </Text>
                  </Box>
                  <Text color={color}>
                    {truncate(
                      agentCount === 0 ? statusText : `${statusText} · ${agentCount} ${agentCount === 1 ? 'agent' : 'agents'}`,
                      SESSION_STATUS_MAX_WIDTH,
                    )}
                  </Text>
                </Box>
                {session.agents.map(agent => (
                  <Box key={`agent:${session.id}:${agent.id}`} flexDirection="row" gap={1} paddingLeft={2 * agent.depth}>
                    <Box flexGrow={1} flexShrink={1} minWidth={0}>
                      <Text wrap="truncate-end">{`└ ${agent.type} · ${agent.description}`}</Text>
                    </Box>
                    <Text color={AGENT_STATUS_COLORS[agent.status] ?? 'inactive'}>{agent.status}</Text>
                  </Box>
                ))}
              </Box>
            )
          })}
          {drawListScroller($, e, 'sessions', { start, shown: visible.length, total: matching.length })}
          {matching.length === 0 && <Text color="inactive">No sessions match</Text>}
        </Box>
      )}
    </Box>
  )

  return listBlock({
    id: 'sessions',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows,
    total: matching.length,
    hasNotice: matching.length === 0,
  })
}
