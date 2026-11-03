import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarDocker, SidebarDockerContainer, SidebarDockerImage, SidebarDockerTab } from '../../types'
import { shown } from '../lib/lastShown'
import { readRawSectionOpen, setListFilter } from '../lib/lists'
import { isSidebarShown } from '../lib/pane'
import { PROCESS_TIMEOUT_MS } from '../lib/process'
import { firstLine } from '../lib/text'
import { describeError, record } from '../lib/trace'

const DOCKER_WATCH_MS = 5_000
// Explicit fields, never `{{json .}}`: a template that touches .Size makes `docker ps` measure every container.
const CONTAINER_FORMAT = ['{{.ID}}', '{{.Names}}', '{{.Image}}', '{{.State}}', '{{.Status}}'].join('\t')
const IMAGE_FORMAT = ['{{.ID}}', '{{.Repository}}', '{{.Tag}}', '{{.Size}}'].join('\t')
const DAEMON_DOWN = /cannot connect to the docker daemon|is the docker daemon running/i
const COMMAND_MISSING = /ENOENT|not found|no such file/i
const ACTIVE_STATES: ReadonlySet<string> = new Set(['running', 'restarting', 'paused'])
const NONE = '<none>'

export const NOT_RUNNING_REASON = 'Docker is not running'
const MISSING_REASON = 'Docker CLI not found'
const SILENT_REASON = 'Docker did not answer'

const INITIAL_DOCKER: SidebarDocker = { status: 'unknown', reason: null, containers: [], images: [] }

const dockerState = atom({ plugin: 'session-cockpit', key: 'docker' } as const, INITIAL_DOCKER)
const dockerTabState = atom({ plugin: 'session-cockpit', key: 'dockerTab' } as const, 'containers' as SidebarDockerTab)

let running: Promise<void> | null = null
let isQueued = false

export const isActiveContainer = (container: SidebarDockerContainer) => ACTIVE_STATES.has(container.state)

export const imageReference = (image: SidebarDockerImage) =>
  image.repository === NONE || image.tag === NONE ? image.id : `${image.repository}:${image.tag}`

export const imageLabel = (image: SidebarDockerImage) =>
  image.repository === NONE ? image.id : `${image.repository}:${image.tag}`

export const imageKey = (image: SidebarDockerImage) => `${image.id}/${image.repository}:${image.tag}`

const fieldsOf = (stdout: string, count: number) =>
  stdout
    .split('\n')
    .map(line => line.split('\t'))
    .filter(fields => fields.length === count && fields.every(field => field !== ''))

const parseContainers = (stdout: string) => {
  const containers = fieldsOf(stdout, 5).map(
    ([id = '', name = '', image = '', state = '', status = '']): SidebarDockerContainer => ({ id, name, image, state, status }),
  )

  return [...containers.filter(isActiveContainer), ...containers.filter(container => !isActiveContainer(container))]
}

const parseImages = (stdout: string) =>
  fieldsOf(stdout, 4).map(([id = '', repository = '', tag = '', size = '']): SidebarDockerImage => ({ id, repository, tag, size }))

export const failureReason = (stderr: string, exitCode: number) =>
  DAEMON_DOWN.test(stderr) ? NOT_RUNNING_REASON : firstLine(stderr) || `docker exited with ${exitCode}`

export const errorReason = (error: unknown) => (COMMAND_MISSING.test(describeError(error)) ? MISSING_REASON : SILENT_REASON)

const unavailable = (reason: string): SidebarDocker => ({ status: 'unavailable', reason, containers: [], images: [] })

export function runDocker($: EngineInterface, argv: readonly string[], timeoutMs = PROCESS_TIMEOUT_MS) {
  return $.process.run(['docker', ...argv], { timeoutMs })
}

async function readSnapshot($: EngineInterface): Promise<SidebarDocker> {
  const [containers, images] = await Promise.all([
    runDocker($, ['ps', '--all', '--format', CONTAINER_FORMAT]).catch((error: unknown) => ({ error })),
    runDocker($, ['images', '--format', IMAGE_FORMAT]).catch(() => null),
  ])
  if ('error' in containers) return unavailable(errorReason(containers.error))
  if (containers.exitCode !== 0) return unavailable(failureReason(containers.stderr, containers.exitCode))

  return {
    status: 'ready',
    reason: null,
    containers: parseContainers(containers.stdout),
    images: images?.exitCode === 0 ? parseImages(images.stdout) : [],
  }
}

export async function readDocker($: EngineInterface) {
  return read($, dockerState).then(shown(dockerState))
}

export async function readDockerTab($: EngineInterface) {
  return read($, dockerTabState)
}

export async function selectDockerTab($: EngineInterface, tab: SidebarDockerTab) {
  await Promise.all([update($, dockerTabState, () => tab), setListFilter($, 'docker', '')])
}

// One read at a time; a call that lands during a read runs one more after it, so a change made
// meanwhile (a Bash command, an action) is never hidden behind an older answer.
export function refreshDocker($: EngineInterface): Promise<void> {
  if (running !== null) {
    isQueued = true

    return running
  }
  running = (async () => {
    try {
      do {
        isQueued = false
        const snapshot = await readSnapshot($)
        await update($, dockerState, () => snapshot)
      } while (isQueued)
    } finally {
      running = null
    }
  })()

  return running
}

export async function refreshDockerIfOpen($: EngineInterface) {
  if (await readRawSectionOpen($, 'docker')) await refreshDocker($)
}

async function pollDocker($: EngineInterface) {
  if (await isSidebarShown($)) await refreshDockerIfOpen($)
}

export function startDockerWatch($: EngineInterface) {
  $.clock.every(DOCKER_WATCH_MS, () => void pollDocker($).catch(error => record(`docker watch failed: ${describeError(error)}`)))
}
