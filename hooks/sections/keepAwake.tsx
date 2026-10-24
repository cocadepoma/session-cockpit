import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarKeepAwake } from '../../types'
import { readSessionRegistry } from '../data/registry'
import type { Block } from '../lib/layout'
import { claudeConfigDirectory } from '../lib/paths'
import { PROCESS_TIMEOUT_MS } from '../lib/process'
import { record } from '../lib/trace'
import { hasChanged } from '../lib/values'
import { rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'

const KEEP_AWAKE_GRACE_MS = 500
const KEEP_AWAKE_REASON = 'Keep awake'
const KEEP_AWAKE_UNAVAILABLE = 'Keep awake is not available here'
const KEEP_AWAKE_APP_ID = 'claude-code'
const KEEP_AWAKE_TICK_MS = 5_000
const KEEP_AWAKE_DEADLINE_TOLERANCE_MS = 2_000
const KEEP_AWAKE_ENDED = 'Keep awake ended'
const UNVERIFIED_HINT = ' · unverified here'
const UNVERIFIED_SHORT_HINT = ' · unverified'

const KEEP_AWAKE_PRESETS: readonly KeepAwakePreset[] = [
  { id: '30m', label: '30m', seconds: 1_800 },
  { id: '1h', label: '1h', seconds: 3_600 },
  { id: '2h', label: '2h', seconds: 7_200 },
  { id: '5h', label: '5h', seconds: 18_000 },
  { id: 'forever', label: '∞', seconds: null },
]

type KeepAwakeCandidate = { argv: string[]; isVerified: boolean }

type KeepAwakePreset = { id: string; label: string; seconds: number | null }

type KeepAwakeChild = {
  stream: ReturnType<EngineInterface['process']['spawn']>
  first: Promise<IteratorResult<unknown, unknown>>
  argv: readonly string[]
  isVerified: boolean
  deadline: number | null
}

type KeepAwakePlatform = 'darwin' | 'linux' | 'other'

const keepAwakeState = atom({ plugin: 'session-cockpit', key: 'keepAwake' } as const, {
  isOn: false,
  isVerified: true,
  minutesLeft: null as number | null,
})

let keepAwakeChild: KeepAwakeChild | null = null
let isKeepAwakeStarting = false
let shownMinutesLeft: number | null = null

const keepAwakeDesktopTokens = (names: readonly (string | undefined)[]) =>
  (names.find(name => name !== undefined && name.trim() !== '') ?? '')
    .split(':')
    .map(token => token.trim().toLowerCase())
    .filter(token => token !== '')

const KEEP_AWAKE_DEATH_SIGNAL = ['setpriv', '--pdeathsig', 'TERM']

const keepAwakeHold = (seconds: number | null, pid: number | null) => {
  if (pid === null) return seconds === null ? null : ['sleep', String(seconds)]
  const tail = ['tail', `--pid=${pid}`, '-f', '/dev/null']

  return seconds === null ? tail : ['timeout', String(seconds), ...tail]
}

const keepAwakeCandidates = (
  platform: KeepAwakePlatform,
  desktops: readonly string[],
  pid: number | null,
  seconds: number | null,
): KeepAwakeCandidate[] => {
  if (seconds === null && pid === null) return []
  if (platform === 'darwin') {
    const timeout = seconds === null ? [] : ['-t', String(seconds)]
    const watch = pid === null ? [] : ['-w', String(pid)]

    return [{ argv: ['caffeinate', '-d', '-i', ...timeout, ...watch], isVerified: true }]
  }
  if (platform !== 'linux') return []
  const hold = keepAwakeHold(seconds, pid)
  if (hold === null) return []
  const systemd = (isVerified: boolean) => ({
    argv: [
      'systemd-inhibit',
      '--what=idle:sleep',
      `--who=${KEEP_AWAKE_APP_ID}`,
      `--why=${KEEP_AWAKE_REASON}`,
      '--mode=block',
      ...hold,
    ],
    isVerified,
  })
  const gnome = (isVerified: boolean) => ({
    argv: [
      'gnome-session-inhibit',
      '--inhibit',
      'idle',
      '--app-id',
      KEEP_AWAKE_APP_ID,
      '--reason',
      KEEP_AWAKE_REASON,
      ...hold,
    ],
    isVerified,
  })
  const has = (...names: string[]) => names.some(name => desktops.includes(name))
  if (has('kde')) {
    return [
      { argv: ['kde-inhibit', '--screenSaver', '--power', ...KEEP_AWAKE_DEATH_SIGNAL, ...hold], isVerified: true },
      systemd(true),
    ]
  }
  if (has('budgie')) return [gnome(false), systemd(false)]
  if (has('gnome')) return [gnome(true)]
  if (has('mate')) {
    return [
      { argv: ['mate-session-inhibit', '--inhibit', 'idle', ...KEEP_AWAKE_DEATH_SIGNAL, ...hold], isVerified: false },
      systemd(false),
    ]
  }
  if (has('sway', 'hyprland')) return [systemd(true)]

  return [systemd(false)]
}

async function keepAwakePlatform($: EngineInterface): Promise<KeepAwakePlatform> {
  const system = await $.process.run(['uname', '-s'], { timeoutMs: PROCESS_TIMEOUT_MS }).catch(() => null)
  const name = system?.stdout.trim().toLowerCase()

  return name === 'darwin' || name === 'linux' ? name : 'other'
}

async function keepAwakePid($: EngineInterface) {
  const [configDirectory, currentId] = await Promise.all([claudeConfigDirectory($), $.session.id()])
  const registry = await readSessionRegistry($, configDirectory)

  return registry.find(entry => entry.sessionId === currentId)?.pid ?? null
}

async function resolveKeepAwakeCandidates($: EngineInterface, seconds: number | null) {
  const [platform, pid, ...names] = await Promise.all([
    keepAwakePlatform($),
    keepAwakePid($).catch(() => null),
    $.env.get('XDG_CURRENT_DESKTOP'),
    $.env.get('XDG_SESSION_DESKTOP'),
    $.env.get('DESKTOP_SESSION'),
  ])

  return keepAwakeCandidates(platform, keepAwakeDesktopTokens(names), pid, seconds)
}

async function launchKeepAwake(
  $: EngineInterface,
  candidate: KeepAwakeCandidate,
  seconds: number | null,
): Promise<KeepAwakeChild | null> {
  const stream = $.process.spawn({ argv: candidate.argv })
  const first = stream.next()
  const grace = new AbortController()
  const outcome = await Promise.race([
    first.then(
      result => (result.done ? 'ended' : 'alive'),
      () => 'ended',
    ),
    $.clock.sleep(KEEP_AWAKE_GRACE_MS, { signal: grace.signal }).then(
      () => 'alive',
      () => 'ended',
    ),
  ])
  grace.abort()
  if (outcome === 'ended') {
    void stream.return({ code: null, signal: null }).catch(() => null)

    return null
  }

  const deadline = seconds === null ? null : (await $.clock.now()) + seconds * 1000

  return { stream, first, argv: candidate.argv, isVerified: candidate.isVerified, deadline }
}

export const keepAwakeMinutesLeft = (deadline: number | null, now: number) =>
  deadline === null ? null : Math.max(1, Math.ceil((deadline - now) / 60_000))

export const isKeepAwakeDue = (deadline: number | null, now: number) =>
  deadline !== null && now >= deadline - KEEP_AWAKE_DEADLINE_TOLERANCE_MS

const keepAwakeStateOf = (child: KeepAwakeChild | null, now: number) => ({
  isOn: child !== null,
  isVerified: child?.isVerified ?? true,
  minutesLeft: child === null ? null : keepAwakeMinutesLeft(child.deadline, now),
})

async function publishKeepAwake($: EngineInterface, next: SidebarKeepAwake) {
  shownMinutesLeft = next.minutesLeft
  await update($, keepAwakeState, () => next)
}

export const formatKeepAwakeMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

async function watchKeepAwake($: EngineInterface, child: KeepAwakeChild) {
  try {
    let pulled = await child.first
    while (!pulled.done) pulled = await child.stream.next()
  } catch {
    record(`keep awake: ${child.argv[0]} failed`)
  }
  if (keepAwakeChild !== child) return
  keepAwakeChild = null
  await publishKeepAwake($, keepAwakeStateOf(null, 0))
  const isDue = isKeepAwakeDue(child.deadline, await $.clock.now())
  $.ui.toast(isDue ? KEEP_AWAKE_ENDED : `Keep awake stopped: ${child.argv[0]} exited`)
}

async function startKeepAwake($: EngineInterface, seconds: number | null) {
  if (keepAwakeChild !== null) return true
  const candidates = await resolveKeepAwakeCandidates($, seconds)
  for (const candidate of candidates) {
    const child = await launchKeepAwake($, candidate, seconds)
    if (child === null) continue
    keepAwakeChild = child
    const now = await $.clock.now()
    await publishKeepAwake($, keepAwakeStateOf(child, now))
    void watchKeepAwake($, child)

    return true
  }

  return false
}

async function stopKeepAwake($: EngineInterface) {
  const child = keepAwakeChild
  keepAwakeChild = null
  await publishKeepAwake($, keepAwakeStateOf(null, 0))
  if (child !== null) void child.stream.return({ code: null, signal: null }).catch(() => null)
}

export async function pressKeepAwakePreset($: EngineInterface, seconds: number | null) {
  if (isKeepAwakeStarting || keepAwakeChild !== null) return
  isKeepAwakeStarting = true
  try {
    if (!(await startKeepAwake($, seconds))) $.ui.toast(KEEP_AWAKE_UNAVAILABLE)
  } finally {
    isKeepAwakeStarting = false
  }
}

export async function pressKeepAwakePill($: EngineInterface) {
  if (keepAwakeChild !== null) await stopKeepAwake($)
}

export async function syncKeepAwake($: EngineInterface) {
  const wanted = keepAwakeStateOf(keepAwakeChild, await $.clock.now())
  const current = await read($, keepAwakeState)
  if (hasChanged(current, wanted)) await publishKeepAwake($, wanted)
}

async function tickKeepAwake($: EngineInterface) {
  const child = keepAwakeChild
  if (child?.deadline == null) return
  if (keepAwakeMinutesLeft(child.deadline, await $.clock.now()) !== shownMinutesLeft) await syncKeepAwake($)
}

export function startKeepAwakeTick($: EngineInterface) {
  $.clock.every(KEEP_AWAKE_TICK_MS, () => void tickKeepAwake($))
}

export async function drawKeepAwake($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const keepAwake = await read($, keepAwakeState)

  if (!keepAwake.isOn) {
    const element = (
      <Box flexDirection="row">
        <Text bold color="suggestion">○ Keep awake</Text>
        <Text>   </Text>
        {KEEP_AWAKE_PRESETS.map((preset, index) => (
          <Box key={preset.id} flexDirection="row">
            {index > 0 && (
              <Box marginX={1}>
                <Text dimColor>·</Text>
              </Box>
            )}
            <Button key={`keep-awake-${preset.id}`} plain onPress={() => void pressKeepAwakePreset($, preset.seconds)}>
              <Text color="suggestion">{preset.label}</Text>
            </Button>
          </Box>
        ))}
      </Box>
    )

    return { element, rows: 1 }
  }
  const left = keepAwake.minutesLeft === null ? '∞' : formatKeepAwakeMinutes(keepAwake.minutesLeft)
  const pill = ` ● Keep awake · ${left} `
  const hint = pill.length + UNVERIFIED_HINT.length <= rowWidth(e) ? UNVERIFIED_HINT : UNVERIFIED_SHORT_HINT

  const element = (
    <Box flexDirection="row">
      <Button key="keep-awake-toggle" plain onPress={() => void pressKeepAwakePill($)}>
        <Text bold color="inverseText" backgroundColor="success">{pill}</Text>
        {!keepAwake.isVerified && <Text color="warning">{hint}</Text>}
      </Button>
    </Box>
  )

  return { element, rows: 1 }
}
