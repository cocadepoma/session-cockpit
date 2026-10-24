import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { formatKeepAwakeMinutes, isKeepAwakeDue, keepAwakeMinutesLeft } from '../hooks/sections/keepAwake'
import { NOW, PANE, givenEngine, registerSession } from './fixtures'

const KEEP_AWAKE_PID = 4242

const KEEP_AWAKE_HOLD = ['tail', `--pid=${KEEP_AWAKE_PID}`, '-f', '/dev/null']

const DEATH_SIGNAL = ['setpriv', '--pdeathsig', 'TERM']

const KEEP_AWAKE_PRESETS = [
  { key: 'keep-awake-30m', label: '30m', seconds: 1_800 },
  { key: 'keep-awake-1h', label: '1h', seconds: 3_600 },
  { key: 'keep-awake-2h', label: '2h', seconds: 7_200 },
  { key: 'keep-awake-5h', label: '5h', seconds: 18_000 },
]

const timedHold = (seconds: number) => ['timeout', String(seconds), ...KEEP_AWAKE_HOLD]

const SYSTEMD_INHIBIT = ['systemd-inhibit', '--what=idle:sleep', '--who=claude-code', '--why=Keep awake', '--mode=block']

const GNOME_INHIBIT = [
  'gnome-session-inhibit',
  '--inhibit',
  'idle',
  '--app-id',
  'claude-code',
  '--reason',
  'Keep awake',
]

const givenKeepAwake = async (
  $: Parameters<TestBody>[0],
  on: On,
  { platform = 'Linux', desktop, pid = KEEP_AWAKE_PID }: { platform?: string; desktop?: string; pid?: number | null } = {},
) => {
  const clock = mock.clock(on, { now: NOW })
  const engine = givenEngine(on, { usesMockClock: true })
  engine.world.platform = platform
  if (desktop !== undefined) engine.world.env.XDG_CURRENT_DESKTOP = desktop
  if (pid !== null) {
    registerSession(engine.world.files, { pid, sessionId: 'current', cwd: '/home/dev/app', name: 'app', status: 'busy' })
  }
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const pressKey = async (key: string) => {
    const pressed = ui.press({ key })
    await clock.advance(500)
    await pressed
  }
  const press = () => pressKey('keep-awake-forever')
  const stop = () => pressKey('keep-awake-toggle')

  return { ...engine, ui, text, press, pressKey, stop, clock }
}

const keepAwakeCases: { name: string; options: Parameters<typeof givenKeepAwake>[2]; expected: string[][] }[] = [
  { name: 'macOS', options: { platform: 'Darwin', desktop: 'Aqua' }, expected: [['caffeinate', '-d', '-i', '-w', '4242']] },
  { name: 'macOS without a pid', options: { platform: 'Darwin', pid: null }, expected: [] },
  {
    name: 'KDE',
    options: { desktop: 'KDE' },
    expected: [['kde-inhibit', '--screenSaver', '--power', ...DEATH_SIGNAL, ...KEEP_AWAKE_HOLD], [...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]],
  },
  { name: 'KDE without a pid', options: { desktop: 'KDE', pid: null }, expected: [] },
  { name: 'GNOME', options: { desktop: 'ubuntu:GNOME' }, expected: [[...GNOME_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  {
    name: 'Budgie, which also names GNOME',
    options: { desktop: 'Budgie:GNOME' },
    expected: [[...GNOME_INHIBIT, ...KEEP_AWAKE_HOLD], [...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]],
  },
  {
    name: 'MATE',
    options: { desktop: 'MATE' },
    expected: [['mate-session-inhibit', '--inhibit', 'idle', ...DEATH_SIGNAL, ...KEEP_AWAKE_HOLD], [...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]],
  },
  { name: 'Sway', options: { desktop: 'sway' }, expected: [[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  { name: 'Hyprland', options: { desktop: 'Hyprland' }, expected: [[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  { name: 'XFCE', options: { desktop: 'XFCE' }, expected: [[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  { name: 'Cinnamon', options: { desktop: 'X-Cinnamon' }, expected: [[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  { name: 'LXQt', options: { desktop: 'LXQt' }, expected: [[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  { name: 'COSMIC', options: { desktop: 'COSMIC' }, expected: [[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  { name: 'no desktop', options: {}, expected: [[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]] },
  { name: 'no desktop and no pid', options: { pid: null }, expected: [] },
  { name: 'another operating system', options: { platform: 'FreeBSD', desktop: 'KDE' }, expected: [] },
]

for (const { name, options, expected } of keepAwakeCases) {
  test(`keep awake on ${name} tries ${expected.length} candidate${expected.length === 1 ? '' : 's'} in order and says so when none starts`, async ($, on) => {
    const { world, toasts, press, text } = await givenKeepAwake($, on, options)

    await press()

    expect(world.spawn.started).toEqual(expected)
    expect(toasts).toEqual(['Keep awake is not available here'])
    expect(await text(/^○ Keep awake$/)).toBe('○ Keep awake')
  })
}

for (const { key, label, seconds } of KEEP_AWAKE_PRESETS) {
  test(`keep awake ${label} on macOS passes ${seconds} seconds to caffeinate, with and without a pid`, async ($, on) => {
    const withPid = await givenKeepAwake($, on, { platform: 'Darwin' })
    await withPid.pressKey(key)
    expect(withPid.world.spawn.started).toEqual([['caffeinate', '-d', '-i', '-t', String(seconds), '-w', '4242']])
  })

  test(`keep awake ${label} on macOS without a pid passes only the timeout`, async ($, on) => {
    const { world, pressKey } = await givenKeepAwake($, on, { platform: 'Darwin', pid: null })
    await pressKey(key)
    expect(world.spawn.started).toEqual([['caffeinate', '-d', '-i', '-t', String(seconds)]])
  })

  test(`keep awake ${label} on Linux wraps every candidate's hold with the timeout`, async ($, on) => {
    const gnome = await givenKeepAwake($, on, { desktop: 'ubuntu:GNOME' })
    await gnome.pressKey(key)
    expect(gnome.world.spawn.started).toEqual([[...GNOME_INHIBIT, ...timedHold(seconds)]])
  })

  test(`keep awake ${label} on KDE tries both candidates with the timeout`, async ($, on) => {
    const { world, pressKey } = await givenKeepAwake($, on, { desktop: 'KDE' })
    await pressKey(key)
    expect(world.spawn.started).toEqual([
      ['kde-inhibit', '--screenSaver', '--power', ...DEATH_SIGNAL, ...timedHold(seconds)],
      [...SYSTEMD_INHIBIT, ...timedHold(seconds)],
    ])
  })

  test(`keep awake ${label} on the systemd fallback holds with timeout or sleep`, async ($, on) => {
    const withPid = await givenKeepAwake($, on, {})
    await withPid.pressKey(key)
    expect(withPid.world.spawn.started).toEqual([[...SYSTEMD_INHIBIT, ...timedHold(seconds)]])
  })

  test(`keep awake ${label} on the systemd fallback without a pid sleeps for the duration`, async ($, on) => {
    const { world, pressKey } = await givenKeepAwake($, on, { pid: null })
    await pressKey(key)
    expect(world.spawn.started).toEqual([[...SYSTEMD_INHIBIT, 'sleep', String(seconds)]])
  })
}

test(`keep awake on MATE holds with the timeout under setpriv`, async ($, on) => {
  const { world, pressKey } = await givenKeepAwake($, on, { desktop: 'MATE' })
  await pressKey('keep-awake-1h')
  expect(world.spawn.started).toEqual([
    ['mate-session-inhibit', '--inhibit', 'idle', ...DEATH_SIGNAL, ...timedHold(3_600)],
    [...SYSTEMD_INHIBIT, ...timedHold(3_600)],
  ])
})

test('keep awake off shows the label and the five presets and no pill', async ($, on) => {
  const { ui, text } = await givenKeepAwake($, on, { platform: 'Darwin' })

  expect((await ui.find({ type: 'Text', text: /^○ Keep awake$/ }))?.props).toMatchObject({ color: 'suggestion', bold: true })
  for (const label of ['30m', '1h', '2h', '5h', '∞']) expect(await text(new RegExp(`^${label}$`))).toBe(label)
  expect(await ui.find({ key: 'keep-awake-toggle' })).toBeUndefined()
  for (const key of ['keep-awake-30m', 'keep-awake-1h', 'keep-awake-2h', 'keep-awake-5h', 'keep-awake-forever']) {
    expect(await ui.find({ key })).toBeDefined()
  }
})

test('keep awake on shows the pill with the duration and hides the presets', async ($, on) => {
  const { world, ui, text, pressKey, stop } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'

  await pressKey('keep-awake-5h')

  expect(await text(/^ ● Keep awake · 5h $/)).toBe(' ● Keep awake · 5h ')
  expect(await ui.find({ key: 'keep-awake-30m' })).toBeUndefined()
  expect(await ui.find({ key: 'keep-awake-forever' })).toBeUndefined()
  expect(await text(/^○ Keep awake$/)).toBeUndefined()
  await stop()
  expect(world.spawn.killed).toEqual(['caffeinate'])
  expect(await text(/^○ Keep awake$/)).toBe('○ Keep awake')
})

test('keep awake 30m shows 30m and forever shows the infinity mark', async ($, on) => {
  const timed = await givenKeepAwake($, on, { platform: 'Darwin' })
  timed.world.spawn.plans.caffeinate = 'run'
  await timed.pressKey('keep-awake-30m')
  expect(await timed.text(/^ ● Keep awake · 30m $/)).toBe(' ● Keep awake · 30m ')
  await timed.stop()

  await timed.press()
  expect(await timed.text(/^ ● Keep awake · ∞ $/)).toBe(' ● Keep awake · ∞ ')
  await timed.stop()
})

test('keep awake countdown moves with the clock', async ($, on) => {
  const { world, text, pressKey, stop, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  await pressKey('keep-awake-30m')
  expect(await text(/^ ● Keep awake · /)).toBe(' ● Keep awake · 30m ')

  await clock.advance(65_000)
  expect(await text(/^ ● Keep awake · /)).toBe(' ● Keep awake · 29m ')
  await stop()
})

const countdownCases: [number, string][] = [
  [18_000_000, '5h'],
  [17_940_000, '4h 59m'],
  [17_939_000, '4h 59m'],
  [3_600_000, '1h'],
  [3_540_000, '59m'],
  [2_820_000, '47m'],
  [61_000, '2m'],
  [60_000, '1m'],
  [1_000, '1m'],
  [0, '1m'],
  [-5_000, '1m'],
]

for (const [left, expected] of countdownCases) {
  test(`keep awake countdown shows ${expected} with ${left} ms left`, () => {
    expect(formatKeepAwakeMinutes(keepAwakeMinutesLeft(left, 0) ?? 0)).toBe(expected)
  })
}

test('keep awake countdown has no minutes for an unlimited run', () => {
  expect(keepAwakeMinutesLeft(null, 0)).toBeNull()
})

test('keep awake counts an exit at or just before the deadline as the end and an earlier one as a stop', () => {
  expect(isKeepAwakeDue(10_000, 10_000)).toBe(true)
  expect(isKeepAwakeDue(10_000, 8_000)).toBe(true)
  expect(isKeepAwakeDue(10_000, 7_999)).toBe(false)
  expect(isKeepAwakeDue(null, 10_000)).toBe(false)
})

test('keep awake countdown shows hours and minutes for a long run', async ($, on) => {
  const { world, text, pressKey, stop, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  await pressKey('keep-awake-5h')

  await clock.advance(65_000)

  expect(await text(/^ ● Keep awake · /)).toBe(' ● Keep awake · 4h 59m ')
  await stop()
})

test('keep awake keeps the old toast when a timed child exits before its deadline', async ($, on) => {
  const { world, text, pressKey, toasts, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  await pressKey('keep-awake-30m')

  await clock.set(NOW + 60_000)
  world.spawn.endings.caffeinate?.()
  await clock.advance(1_000)

  expect(await text(/^○ Keep awake$/)).toBe('○ Keep awake')
  expect(toasts).toEqual(['Keep awake stopped: caffeinate exited'])
})

test('keep awake falls through to the next candidate when one cannot start', async ($, on) => {
  const { world, press, text, stop } = await givenKeepAwake($, on, { desktop: 'Budgie:GNOME' })
  world.spawn.plans['systemd-inhibit'] = 'run'

  await press()

  expect(world.spawn.started.map(argv => argv[0])).toEqual(['gnome-session-inhibit', 'systemd-inhibit'])
  expect(await text(/^ ● Keep awake · ∞ $/)).toBe(' ● Keep awake · ∞ ')
  await stop()
})

test('keep awake falls through to the next candidate when one exits within the grace period', async ($, on) => {
  const { world, press, text, stop } = await givenKeepAwake($, on, { desktop: 'KDE' })
  world.spawn.plans['kde-inhibit'] = 'exit'
  world.spawn.plans['systemd-inhibit'] = 'run'

  await press()

  expect(world.spawn.started.map(argv => argv[0])).toEqual(['kde-inhibit', 'systemd-inhibit'])
  expect(await text(/^ ● Keep awake · ∞ $/)).toBe(' ● Keep awake · ∞ ')
  expect(await text(/unverified/)).toBeUndefined()
  await stop()
})

test('keep awake draws the switch off, on and unverified, and pressing it starts and stops one child', async ($, on) => {
  const { world, press, text, ui, stop } = await givenKeepAwake($, on, { desktop: 'XFCE' })
  world.spawn.plans['systemd-inhibit'] = 'run'

  expect((await ui.find({ type: 'Text', text: /^○ Keep awake$/ }))?.props).toMatchObject({ color: 'suggestion', bold: true })
  expect(await text(/unverified/)).toBeUndefined()

  await press()
  expect((await ui.find({ type: 'Text', text: /^ ● Keep awake · ∞ $/ }))?.props).toMatchObject({ color: 'inverseText', backgroundColor: 'success' })
  expect((await ui.find({ type: 'Text', text: /unverified/ }))?.props.color).toBe('warning')
  expect(await text(/unverified/)).toBe(' · unverified here')
  expect(world.spawn.started).toEqual([[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]])
  expect(world.spawn.killed).toEqual([])

  await stop()
  expect(world.spawn.killed).toEqual(['systemd-inhibit'])
  expect(await text(/^○ Keep awake$/)).toBe('○ Keep awake')
  expect(await text(/unverified/)).toBeUndefined()
})

test('keep awake on a verified candidate shows no unverified label', async ($, on) => {
  const { world, press, text, stop } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'

  await press()

  expect(await text(/^ ● Keep awake · ∞ $/)).toBe(' ● Keep awake · ∞ ')
  expect(await text(/unverified/)).toBeUndefined()
  await stop()
})

test('keep awake turns itself off with a toast when the child exits later', async ($, on) => {
  const { world, press, text, toasts, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  await press()
  expect(await text(/^ ● Keep awake · ∞ $/)).toBe(' ● Keep awake · ∞ ')

  world.spawn.endings.caffeinate?.()
  await clock.advance(1_000)

  expect(await text(/^○ Keep awake$/)).toBe('○ Keep awake')
  expect(toasts).toEqual(['Keep awake stopped: caffeinate exited'])
  expect(world.spawn.killed).toEqual([])
})

test('keep awake starts one child however often it is pressed while starting', async ($, on) => {
  const { world, ui, text, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'

  const first = ui.press({ key: 'keep-awake-forever' })
  const second = ui.press({ key: 'keep-awake-forever' })
  await clock.advance(500)
  await Promise.all([first, second])

  expect(world.spawn.started).toHaveLength(1)
  expect(await text(/^ ● Keep awake · ∞ $/)).toBe(' ● Keep awake · ∞ ')
  expect(world.spawn.killed).toEqual([])
  await ui.press({ key: 'keep-awake-toggle' })
})
