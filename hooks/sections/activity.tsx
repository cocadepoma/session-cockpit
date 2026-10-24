import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarActivityEntry } from '../../types'
import { baseName } from '../lib/paths'
import { firstLine, formatDuration, truncate } from '../lib/text'
import type { PaneInput } from '../lib/view'

const FINISHED_LIMIT = 5
const TARGET_LIMIT = 200
const AGENT_TOOL = 'Agent'
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g
const URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i

const INITIAL_ACTIVITY = { running: [], finished: [], sequence: 0 }

const activityState = atom({ plugin: 'session-cockpit', key: 'activity' } as const, INITIAL_ACTIVITY)
const tickState = atom({ plugin: 'session-cockpit', key: 'tick' } as const, 0)

const clean = (text: string) => truncate(text.replace(CONTROL_CHARACTERS, ' ').trim(), TARGET_LIMIT)

const targetOf = (input: object) => {
  const fields = input as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null)
  const path = text(fields.file_path) ?? text(fields.notebook_path)
  if (path !== null) return clean(baseName(path))
  const pattern = text(fields.pattern)
  if (pattern !== null) return clean(pattern)
  const command = text(fields.command)
  if (command !== null) return clean(firstLine(command))
  const authority = URL_HOST.exec(text(fields.url) ?? '')?.[1]
  const host = authority?.slice(authority.lastIndexOf('@') + 1)

  return host === undefined || host === '' ? null : clean(host)
}

const withoutChildren = (running: SidebarActivityEntry[], parentId: string) =>
  running.filter(entry => entry.parentId !== parentId)

export async function tickPane($: EngineInterface) {
  const { running } = await read($, activityState)
  if (running.length === 0) return
  await update($, tickState, count => count + 1)
}

export async function startToolActivity(
  $: EngineInterface,
  input: { tool: string; agentId?: string; tool_use_id?: string },
) {
  if (input.tool === AGENT_TOOL) return null
  const now = await $.clock.now()
  let id = ''
  await update($, activityState, activity => {
    const sequence = activity.sequence + 1
    id = typeof input.tool_use_id === 'string' && input.tool_use_id !== '' ? `tool:${input.tool_use_id}` : `tool:#${sequence}`
    const entry: SidebarActivityEntry = {
      id,
      kind: 'tool',
      name: clean(input.tool),
      target: targetOf(input),
      startedAt: now,
      endedAt: null,
      isError: false,
      parentId: input.agentId ?? null,
    }

    return {
      ...activity,
      sequence,
      running: [...activity.running.filter(running => running.id !== id), entry],
    }
  })

  return id
}

export async function startAgentActivity($: EngineInterface, agentId: string, type: string, description: string) {
  const now = await $.clock.now()
  const entry: SidebarActivityEntry = {
    id: agentId,
    kind: 'agent',
    name: clean(type),
    target: clean(description) || null,
    startedAt: now,
    endedAt: null,
    isError: false,
    parentId: null,
  }
  await update($, activityState, activity => ({
    ...activity,
    running: [...activity.running.filter(running => running.id !== agentId), entry],
  }))
}

export async function finishActivity($: EngineInterface, id: string, isError: boolean) {
  const now = await $.clock.now()
  await update($, activityState, activity => {
    const entry = activity.running.find(running => running.id === id)
    if (entry === undefined) return activity
    const isNested = entry.parentId !== null && activity.running.some(running => running.id === entry.parentId)
    const running = withoutChildren(
      activity.running.filter(running => running.id !== id),
      id,
    )
    const done = { ...entry, endedAt: now, isError }

    return {
      ...activity,
      running,
      finished: isNested ? activity.finished : [done, ...activity.finished].slice(0, FINISHED_LIMIT),
    }
  })
}

export async function reconcileAgents($: EngineInterface) {
  const { running } = await read($, activityState)
  const agents = running.filter(entry => entry.kind === 'agent')
  if (agents.length === 0) return
  const listed = await $.agent.list().catch(() => null)
  if (listed === null) return
  for (const agent of agents) {
    const status = listed.find(known => known.id === agent.id)?.status
    if (status === undefined || status === 'completed') await finishActivity($, agent.id, false)
    else if (status === 'failed' || status === 'killed') await finishActivity($, agent.id, true)
  }
}

export async function resetActivity($: EngineInterface) {
  const { running, finished } = await read($, activityState)
  if (running.length === 0 && finished.length === 0) return
  await update($, activityState, activity => ({ ...INITIAL_ACTIVITY, sequence: activity.sequence }))
}

export async function dropEndedToolRows($: EngineInterface) {
  await update($, activityState, activity => {
    const running = activity.running.filter(entry => entry.kind !== 'tool' || entry.parentId !== null)

    return running.length === activity.running.length ? activity : { ...activity, running }
  })
}

export async function drawActivity($: EngineInterface, e: PaneInput) {
  const { Box, Text } = $.ui.resolve(e)
  const [activity, now] = await Promise.all([read($, activityState), $.clock.now(), read($, tickState)])
  if (activity.running.length === 0 && activity.finished.length === 0) return null
  const ids = new Set(activity.running.map(entry => entry.id))
  const topLevel = activity.running.filter(entry => entry.parentId === null || !ids.has(entry.parentId))
  const spinner = SPINNER_FRAMES[Math.floor(now / 1000) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]
  const drawRow = (entry: SidebarActivityEntry, mark: JSX.Element, isNested: boolean) => (
    <Box key={`activity:${entry.id}`} flexDirection="row" gap={1}>
      {isNested && <Text color="inactive">└</Text>}
      {mark}
      <Text bold={entry.kind === 'agent'}>{entry.name}</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {entry.target !== null && (
          <Text color="inactive" wrap="truncate-end">
            {entry.target}
          </Text>
        )}
      </Box>
      <Text color="inactive">{formatDuration((entry.endedAt ?? now) - entry.startedAt)}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      <Text bold>{`Activity (${activity.running.length} running)`}</Text>
      {topLevel.flatMap(entry => [
        drawRow(entry, <Text color="warning">{spinner}</Text>, false),
        ...activity.running
          .filter(child => child.parentId === entry.id)
          .map(child => drawRow(child, <Text color="warning">{spinner}</Text>, true)),
      ])}
      {activity.finished.map(entry =>
        drawRow(entry, <Text color={entry.isError ? 'error' : 'success'}>{entry.isError ? '✗' : '✓'}</Text>, false),
      )}
    </Box>
  )
}
