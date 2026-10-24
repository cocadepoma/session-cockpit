import type { EngineInterface } from 'claude-code'

import type { SidebarSessionAgent } from '../../types'
import { claudeConfigDirectory } from '../lib/paths'
import { PROCESS_TIMEOUT_MS } from '../lib/process'
import { describeError, record } from '../lib/trace'
import { readSessionRegistry, runningPids } from './registry'
import { SESSION_ID_PATTERN } from './snapshots'

const AGENT_DIRECTORY = 'session-cockpit/agents'
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['pending', 'running', 'waiting'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g

export type PublishedAgent = { id: string; type: string; description: string; status: string; parentId: string | null }

type CachedAgentsFile = { mtimeMs: number; size: number; published: { sessionId: string; agents: PublishedAgent[] } | null }

let lastPublished: string | null = null
const agentFiles = new Map<string, CachedAgentsFile>()

const agentsPath = (configDirectory: string, sessionId: string) => `${configDirectory}/${AGENT_DIRECTORY}/${sessionId}.json`

const parsePublishedAgent = (value: unknown): PublishedAgent | null => {
  if (typeof value !== 'object' || value === null) return null
  const { id, type, description, status, parentId } = value as Record<string, unknown>
  if (typeof id !== 'string' || typeof type !== 'string' || typeof description !== 'string' || typeof status !== 'string') {
    return null
  }

  return { id, type, description, status, parentId: typeof parentId === 'string' ? parentId : null }
}

export async function publishAgents($: EngineInterface) {
  try {
    const [configDirectory, sessionId, now, listed] = await Promise.all([
      claudeConfigDirectory($),
      $.session.id(),
      $.clock.now(),
      $.agent.list(),
    ])
    const agents = listed
      .filter(agent => ACTIVE_STATUSES.has(agent.status))
      .map(agent => ({
        id: agent.id,
        type: agent.type,
        description: agent.description.replace(CONTROL_CHARACTERS, ' ').trim(),
        status: agent.status,
        parentId: agent.parentId ?? null,
      }))
    const content = JSON.stringify(agents)
    const path = agentsPath(configDirectory, sessionId)
    if (lastPublished === `${sessionId}:${content}` && (await $.fs.exists(path))) return
    await $.fs.write(path, JSON.stringify({ sessionId, updatedAt: now, agents }))
    lastPublished = `${sessionId}:${content}`
  } catch (error) {
    record(`agents not published: ${describeError(error)}`)
  }
}

async function removeAgentFile($: EngineInterface, configDirectory: string, sessionId: string) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    record('agent file not removed: unsafe session id')

    return
  }
  await $.process
    .run(['rm', '-f', '--', agentsPath(configDirectory, sessionId)], { timeoutMs: PROCESS_TIMEOUT_MS })
    .catch(() => null)
}

export async function forgetAgents($: EngineInterface, sessionId: string) {
  try {
    lastPublished = null
    await removeAgentFile($, await claudeConfigDirectory($), sessionId)
  } catch (error) {
    record(`agent file removal failed: ${describeError(error)}`)
  }
}

export async function pruneAgents($: EngineInterface) {
  try {
    const [configDirectory, currentId] = await Promise.all([claudeConfigDirectory($), $.session.id()])
    const listed = await $.fs.list(`${configDirectory}/${AGENT_DIRECTORY}`).catch(() => [])
    const candidates = listed
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map(entry => entry.name.slice(0, -'.json'.length))
      .filter(sessionId => SESSION_ID_PATTERN.test(sessionId) && sessionId !== currentId)
    if (candidates.length === 0) return
    const registry = await readSessionRegistry($, configDirectory)
    if (registry.length === 0) return
    const running = await runningPids($, registry.map(entry => entry.pid))
    const live = new Set(registry.filter(entry => running.has(entry.pid)).map(entry => entry.sessionId))
    const expired = candidates.filter(sessionId => !live.has(sessionId))
    await Promise.all(expired.map(sessionId => removeAgentFile($, configDirectory, sessionId)))
    record(`pruned ${expired.length} agent files`)
  } catch (error) {
    record(`agent file pruning failed: ${describeError(error)}`)
  }
}

export function forgetAgentReads() {
  agentFiles.clear()
}

export async function readPublishedAgents($: EngineInterface, configDirectory: string, sessionIds: readonly string[]) {
  const published = new Map<string, PublishedAgent[]>()
  const wanted = new Set(sessionIds.map(sessionId => `${sessionId}.json`))
  const directory = `${configDirectory}/${AGENT_DIRECTORY}`
  const entries = await $.fs.list(directory).catch(() => [])
  const listed = new Set(entries.map(entry => `${directory}/${entry.name}`))
  for (const path of agentFiles.keys()) if (!listed.has(path)) agentFiles.delete(path)
  await Promise.all(
    entries
      .filter(entry => entry.kind === 'file' && wanted.has(entry.name))
      .map(async entry => {
        const path = `${directory}/${entry.name}`
        const cached = agentFiles.get(path)
        let file = cached !== undefined && cached.mtimeMs === entry.mtimeMs && cached.size === entry.size ? cached : null
        if (file === null) {
          try {
            const text = await $.fs.read(path)
            let content: CachedAgentsFile['published'] = null
            try {
              const { sessionId, agents } = JSON.parse(text) as Record<string, unknown>
              if (`${String(sessionId)}.json` === entry.name && Array.isArray(agents)) {
                content = { sessionId: String(sessionId), agents: agents.map(parsePublishedAgent).filter(agent => agent !== null) }
              }
            } catch {
              content = null
            }
            file = { mtimeMs: entry.mtimeMs, size: entry.size, published: content }
            agentFiles.set(path, file)
          } catch {
            return
          }
        }
        if (file.published !== null) published.set(file.published.sessionId, file.published.agents)
      }),
  )

  return published
}

export const arrangeAgents = (agents: readonly PublishedAgent[]): SidebarSessionAgent[] => {
  const ids = new Set(agents.map(agent => agent.id))
  const arranged: SidebarSessionAgent[] = []
  const placed = new Set<string>()
  const place = (agent: PublishedAgent, depth: number) => {
    if (placed.has(agent.id)) return
    placed.add(agent.id)
    arranged.push({ id: agent.id, type: agent.type, description: agent.description, status: agent.status, depth })
    for (const child of agents) if (child.parentId === agent.id) place(child, depth + 1)
  }
  for (const agent of agents) if (agent.parentId === null || !ids.has(agent.parentId)) place(agent, 1)
  for (const agent of agents) place(agent, 1)

  return arranged
}
