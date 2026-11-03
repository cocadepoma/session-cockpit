import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type {
  SidebarDocker,
  SidebarDockerAction,
  SidebarDockerContainer,
  SidebarDockerControl,
  SidebarDockerImage,
  SidebarDockerTab,
  SidebarDockerVolume,
} from '../../types'
import { shown } from '../lib/lastShown'
import { readRawSectionOpen, setListFilter } from '../lib/lists'
import { isSidebarShown } from '../lib/pane'
import { PROCESS_TIMEOUT_MS } from '../lib/process'
import { firstLine } from '../lib/text'
import { describeError, record } from '../lib/trace'

const DOCKER_WATCH_MS = 5_000
// Restart and stop wait up to the container's stop timeout (10 s by default) before docker answers.
const ACTION_TIMEOUT_MS = 60_000
const CONFIRM_MS = 5_000
// Explicit fields, never `{{json .}}`: a template that touches .Size makes `docker ps` measure every container.
const CONTAINER_FORMAT = ['{{.ID}}', '{{.Names}}', '{{.Image}}', '{{.State}}', '{{.Status}}'].join('\t')
const IMAGE_FORMAT = ['{{.ID}}', '{{.Repository}}', '{{.Tag}}', '{{.Size}}'].join('\t')
const VOLUME_FORMAT = ['{{.Name}}', '{{.Driver}}'].join('\t')
const DAEMON_DOWN = /cannot connect to the docker daemon|is the docker daemon running/i
const COMMAND_MISSING = /ENOENT|not found|no such file/i
const ACTIVE_STATES: ReadonlySet<string> = new Set(['running', 'restarting', 'paused'])
const NONE = '<none>'

export const NOT_RUNNING_REASON = 'Docker is not running'
const MISSING_REASON = 'Docker CLI not found'
const SILENT_REASON = 'Docker did not answer'

const NO_VOLUMES: Pick<SidebarDocker, 'volumes' | 'volumesReason'> = { volumes: [], volumesReason: null }
const INITIAL_DOCKER: SidebarDocker = { status: 'unknown', reason: null, containers: [], images: [], imagesReason: null, ...NO_VOLUMES }
const INITIAL_CONTROL: SidebarDockerControl = { selected: null, armed: null, pending: [] }

const DESTRUCTIVE: ReadonlySet<SidebarDockerAction> = new Set(['rm', 'rmi'])
const VERBS: Record<SidebarDockerAction, string> = { restart: 'restart', stop: 'stop', start: 'start', rm: 'delete', rmi: 'delete' }

const dockerState = atom({ plugin: 'session-cockpit', key: 'docker' } as const, INITIAL_DOCKER)
const dockerTabState = atom({ plugin: 'session-cockpit', key: 'dockerTab' } as const, 'containers' as SidebarDockerTab)
const dockerControlState = atom({ plugin: 'session-cockpit', key: 'dockerControl' } as const, INITIAL_CONTROL)

let running: Promise<void> | null = null
let isQueued = false
let armTimer: Timer | null = null

export const isActiveContainer = (container: SidebarDockerContainer) => ACTIVE_STATES.has(container.state)

export const imageReference = (image: SidebarDockerImage) =>
  image.repository === NONE || image.tag === NONE ? image.id : `${image.repository}:${image.tag}`

export const imageLabel = (image: SidebarDockerImage) =>
  image.repository === NONE ? image.id : `${image.repository}:${image.tag}`

export const imageKey = (image: SidebarDockerImage) => `${image.id}/${image.repository}:${image.tag}`

export const containerTarget = (container: SidebarDockerContainer) => `container:${container.id}`

export const imageTarget = (image: SidebarDockerImage) => `image:${imageKey(image)}`

export const volumeTarget = (volume: SidebarDockerVolume) => `volume:${volume.name}`

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

// A dangling volume is one no container, running or stopped, refers to.
const parseVolumes = (stdout: string, danglingStdout: string) => {
  const dangling = new Set(danglingStdout.split('\n').filter(name => name !== ''))

  return fieldsOf(stdout, 2).map(([name = '', driver = '']): SidebarDockerVolume => ({ name, driver, isInUse: !dangling.has(name) }))
}

type RunResult = Awaited<ReturnType<typeof runDocker>> | { error: unknown }

const runReason = (result: RunResult) =>
  'error' in result ? errorReason(result.error) : result.exitCode === 0 ? null : failureReason(result.stderr, result.exitCode)

export const failureReason = (stderr: string, exitCode: number) =>
  DAEMON_DOWN.test(stderr) ? NOT_RUNNING_REASON : firstLine(stderr) || `docker exited with ${exitCode}`

export const errorReason = (error: unknown) => (COMMAND_MISSING.test(describeError(error)) ? MISSING_REASON : SILENT_REASON)

const unavailable = (reason: string): SidebarDocker => ({
  status: 'unavailable',
  reason,
  containers: [],
  images: [],
  imagesReason: null,
  ...NO_VOLUMES,
})

export function runDocker($: EngineInterface, argv: readonly string[], timeoutMs = PROCESS_TIMEOUT_MS) {
  return $.process.run(['docker', ...argv], { timeoutMs })
}

async function readSnapshot($: EngineInterface): Promise<SidebarDocker> {
  const [containers, images, volumes, dangling] = await Promise.all([
    runDocker($, ['ps', '--all', '--format', CONTAINER_FORMAT]).catch((error: unknown) => ({ error })),
    runDocker($, ['images', '--format', IMAGE_FORMAT]).catch((error: unknown) => ({ error })),
    runDocker($, ['volume', 'ls', '--format', VOLUME_FORMAT]).catch((error: unknown) => ({ error })),
    runDocker($, ['volume', 'ls', '--filter', 'dangling=true', '--format', '{{.Name}}']).catch((error: unknown) => ({ error })),
  ])
  if ('error' in containers) return unavailable(errorReason(containers.error))
  if (containers.exitCode !== 0) return unavailable(failureReason(containers.stderr, containers.exitCode))
  const imagesReason = runReason(images)
  const volumesReason = runReason(volumes) ?? runReason(dangling)

  return {
    status: 'ready',
    reason: null,
    containers: parseContainers(containers.stdout),
    images: imagesReason === null && !('error' in images) ? parseImages(images.stdout) : [],
    imagesReason,
    volumes:
      volumesReason === null && !('error' in volumes) && !('error' in dangling) ? parseVolumes(volumes.stdout, dangling.stdout) : [],
    volumesReason,
  }
}

// A reload keeps $.state, so a snapshot taken before volumes existed lacks them until the next read.
export async function readDocker($: EngineInterface) {
  return read($, dockerState)
    .then(shown(dockerState))
    .then(docker => ({ ...NO_VOLUMES, ...docker }))
}

export async function readDockerTab($: EngineInterface) {
  return read($, dockerTabState)
}

export async function selectDockerTab($: EngineInterface, tab: SidebarDockerTab) {
  disarmTimer()
  await Promise.all([
    update($, dockerTabState, () => tab),
    update($, dockerControlState, control => ({ ...control, selected: null, armed: null })),
    setListFilter($, 'docker', ''),
  ])
}

export async function readDockerControl($: EngineInterface) {
  return read($, dockerControlState)
}

// The deadline lives in the arm itself: a reload cancels the plugin's timers but keeps $.state, so
// the timer only resets the label and never decides whether a press deletes.
export const isArmed = (control: SidebarDockerControl, target: string, now: number) =>
  control.armed !== null && control.armed.target === target && now < control.armed.until

export async function selectDockerTarget($: EngineInterface, target: string) {
  disarmTimer()
  await update($, dockerControlState, control => ({
    ...control,
    selected: control.selected === target ? null : target,
    armed: null,
  }))
}

function disarmTimer() {
  armTimer?.cancel()
  armTimer = null
}

function startArmTimer($: EngineInterface, target: string, until: number) {
  disarmTimer()
  armTimer = $.clock.after(CONFIRM_MS, () => {
    armTimer = null
    void update($, dockerControlState, control =>
      control.armed?.target === target && control.armed.until === until ? { ...control, armed: null } : control,
    )
  })
}

// What a target names in the latest list: the argument docker gets and the name a toast shows.
async function resolveTarget($: EngineInterface, target: string) {
  const docker = await readDocker($)
  const container = docker.containers.find(candidate => containerTarget(candidate) === target)
  const image = docker.images.find(candidate => imageTarget(candidate) === target)
  const resolved = container
    ? { argument: container.id, label: container.name }
    : image
      ? { argument: imageReference(image), label: imageLabel(image) }
      : null

  return resolved === null || resolved.argument === '' || resolved.argument.startsWith('-') ? null : resolved
}

async function runAction($: EngineInterface, action: SidebarDockerAction, argument: string, label: string) {
  const ran = await runDocker($, [action, '--', argument], ACTION_TIMEOUT_MS).catch((error: unknown) => ({ error }))
  const reason = 'error' in ran ? errorReason(ran.error) : ran.exitCode === 0 ? null : failureReason(ran.stderr, ran.exitCode)
  if (reason !== null) {
    record(`docker ${action} ${argument} failed: ${reason}`)
    await $.ui.toast(`Could not ${VERBS[action]} ${label}: ${reason}`)
  }

  return reason === null
}

type PressDecision = 'skip' | 'arm' | 'run'

// The check and the mark are one update, so a fast second or third press can never start the same
// action twice. rm and rmi run only on a second press of the same target within CONFIRM_MS.
export async function pressDockerAction($: EngineInterface, target: string, action: SidebarDockerAction) {
  const now = await $.clock.now()
  const until = now + CONFIRM_MS
  let decision = 'skip' as PressDecision
  await update($, dockerControlState, current => {
    if (current.pending.some(pending => pending.target === target)) {
      decision = 'skip'

      return current
    }
    if (DESTRUCTIVE.has(action) && !isArmed(current, target, now)) {
      decision = 'arm'

      return { ...current, armed: { target, until } }
    }
    decision = 'run'

    return { ...current, armed: null, pending: [...current.pending, { target, action }] }
  })
  if (decision === 'arm') return startArmTimer($, target, until)
  if (decision === 'skip') return
  disarmTimer()
  try {
    const resolved = await resolveTarget($, target)
    if (resolved === null) return
    const isDone = await runAction($, action, resolved.argument, resolved.label)
    await refreshDocker($).catch(error => record(`docker refresh after ${action} failed: ${describeError(error)}`))
    if (isDone && DESTRUCTIVE.has(action)) {
      await update($, dockerControlState, current => (current.selected === target ? { ...current, selected: null } : current))
    }
  } finally {
    await update($, dockerControlState, current => ({
      ...current,
      pending: current.pending.filter(pending => pending.target !== target),
    }))
  }
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
