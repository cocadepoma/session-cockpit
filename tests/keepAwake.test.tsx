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
    expect(await text(/^○ Off$/)).toBe('○ Off')
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

// The PANE fixture is 40 columns wide; the pane pads one column on each side and the section body
// indents two more.
const SECTION_ROW_WIDTH = 40 - 2 - 2

type DrawnNode = { props?: Record<string, unknown>; children?: unknown[] }

const childNodes = (node: DrawnNode | undefined) =>
  (node?.children ?? []).filter((child): child is DrawnNode => typeof child === 'object' && child !== null)

const findDrawn = (node: DrawnNode | undefined, key: string): DrawnNode | undefined => {
  if (node?.props?.key === key) return node
  for (const child of childNodes(node)) {
    const found = findDrawn(child, key)
    if (found !== undefined) return found
  }

  return undefined
}

const drawnColors = (node: DrawnNode | undefined): unknown[] =>
  [node?.props?.color, node?.props?.backgroundColor, ...childNodes(node).flatMap(drawnColors)].filter(color => color !== undefined)

// The columns a drawn row takes: its text plus the horizontal margins of its boxes.
const drawnColumns = (node: DrawnNode): number => {
  const marginX = node.props?.marginX
  const margins = typeof marginX === 'number' ? 2 * marginX : 0

  return (node.children ?? []).reduce<number>(
    (columns, child) => columns + (typeof child === 'string' ? [...child].length : typeof child === 'object' && child !== null ? drawnColumns(child) : 0),
    margins,
  )
}

test('keep awake is a section of its own: a bold title over an indented body, off and on', async ($, on) => {
  const { world, ui, press, stop } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'

  expect((await ui.find({ type: 'Text', text: /^Keep awake$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ key: 'keep-awake-body' }))?.props.paddingLeft).toBe(2)

  await press()
  expect((await ui.find({ type: 'Text', text: /^Keep awake$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ key: 'keep-awake-body' }))?.props.paddingLeft).toBe(2)
  await stop()
})

test('keep awake off says Off in the secondary color and offers the presets in the pressable color', async ($, on) => {
  const { ui } = await givenKeepAwake($, on, { platform: 'Darwin' })

  expect((await ui.find({ type: 'Text', text: /^○ Off$/ }))?.props.color).toBe('inactive')
  for (const label of ['30m', '1h', '2h', '5h', '∞']) {
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${label}$`) }))?.props.color).toBe('suggestion')
  }
})

test('keep awake on says On and the time left in the active color, ∞ for an unlimited run', async ($, on) => {
  const { world, ui, press, pressKey, stop } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  const pill = { color: 'inverseText', backgroundColor: 'claude', bold: true }

  await pressKey('keep-awake-5h')
  expect((await ui.find({ type: 'Text', text: /^ ● On · 5h left $/ }))?.props).toMatchObject(pill)
  await stop()

  await press()
  expect((await ui.find({ type: 'Text', text: /^ ● On · ∞ $/ }))?.props).toMatchObject(pill)
  await stop()
})

test('keep awake draws no success green, off or on', async ($, on) => {
  const { world, ui, press, stop } = await givenKeepAwake($, on, { desktop: 'XFCE' })
  world.spawn.plans['systemd-inhibit'] = 'run'
  const colors = async () => drawnColors(findDrawn((await ui.drawn()) as DrawnNode, 'keep-awake-body'))

  const off = await colors()
  expect(off).toContain('inactive')
  expect(off).toContain('suggestion')
  expect(off).not.toContain('success')

  await press()
  const on_ = await colors()
  expect(on_).toContain('claude')
  expect(on_).toContain('warning')
  expect(on_).not.toContain('success')
  await stop()
})

test('keep awake rows fit the indented body of a forty-column pane, the unverified note cut first', async ($, on) => {
  const { world, ui, text, pressKey, stop, clock } = await givenKeepAwake($, on, { desktop: 'XFCE' })
  world.spawn.plans['systemd-inhibit'] = 'run'
  const rowColumns = async () => childNodes(findDrawn((await ui.drawn()) as DrawnNode, 'keep-awake-body')).map(drawnColumns)

  const off = await rowColumns()
  expect(off).toHaveLength(1)
  expect(off[0]).toBeLessThanOrEqual(SECTION_ROW_WIDTH)

  await pressKey('keep-awake-5h')
  await clock.advance(65_000)
  expect(await text(/^ ● On · 4h 59m left $/)).toBe(' ● On · 4h 59m left ')
  expect(await text(/unverified/)).toBe(' · unverified')
  const onRows = await rowColumns()
  expect(onRows).toHaveLength(1)
  expect(onRows[0]).toBeLessThanOrEqual(SECTION_ROW_WIDTH)
  await stop()
})

test('keep awake off shows the label and the five presets and no pill', async ($, on) => {
  const { ui, text } = await givenKeepAwake($, on, { platform: 'Darwin' })

  expect((await ui.find({ type: 'Text', text: /^○ Off$/ }))?.props).toMatchObject({ color: 'inactive' })
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

  expect(await text(/^ ● On · 5h left $/)).toBe(' ● On · 5h left ')
  expect(await ui.find({ key: 'keep-awake-30m' })).toBeUndefined()
  expect(await ui.find({ key: 'keep-awake-forever' })).toBeUndefined()
  expect(await text(/^○ Off$/)).toBeUndefined()
  await stop()
  expect(world.spawn.killed).toEqual(['caffeinate'])
  expect(await text(/^○ Off$/)).toBe('○ Off')
})

test('keep awake 30m shows 30m and forever shows the infinity mark', async ($, on) => {
  const timed = await givenKeepAwake($, on, { platform: 'Darwin' })
  timed.world.spawn.plans.caffeinate = 'run'
  await timed.pressKey('keep-awake-30m')
  expect(await timed.text(/^ ● On · 30m left $/)).toBe(' ● On · 30m left ')
  await timed.stop()

  await timed.press()
  expect(await timed.text(/^ ● On · ∞ $/)).toBe(' ● On · ∞ ')
  await timed.stop()
})

test('keep awake countdown moves with the clock', async ($, on) => {
  const { world, text, pressKey, stop, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  await pressKey('keep-awake-30m')
  expect(await text(/^ ● On · /)).toBe(' ● On · 30m left ')

  await clock.advance(65_000)
  expect(await text(/^ ● On · /)).toBe(' ● On · 29m left ')
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

  expect(await text(/^ ● On · /)).toBe(' ● On · 4h 59m left ')
  await stop()
})

test('keep awake keeps the old toast when a timed child exits before its deadline', async ($, on) => {
  const { world, text, pressKey, toasts, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  await pressKey('keep-awake-30m')

  await clock.set(NOW + 60_000)
  world.spawn.endings.caffeinate?.()
  await clock.advance(1_000)

  expect(await text(/^○ Off$/)).toBe('○ Off')
  expect(toasts).toEqual(['Keep awake stopped: caffeinate exited'])
})

test('keep awake falls through to the next candidate when one cannot start', async ($, on) => {
  const { world, press, text, stop } = await givenKeepAwake($, on, { desktop: 'Budgie:GNOME' })
  world.spawn.plans['systemd-inhibit'] = 'run'

  await press()

  expect(world.spawn.started.map(argv => argv[0])).toEqual(['gnome-session-inhibit', 'systemd-inhibit'])
  expect(await text(/^ ● On · ∞ $/)).toBe(' ● On · ∞ ')
  await stop()
})

test('keep awake falls through to the next candidate when one exits within the grace period', async ($, on) => {
  const { world, press, text, stop } = await givenKeepAwake($, on, { desktop: 'KDE' })
  world.spawn.plans['kde-inhibit'] = 'exit'
  world.spawn.plans['systemd-inhibit'] = 'run'

  await press()

  expect(world.spawn.started.map(argv => argv[0])).toEqual(['kde-inhibit', 'systemd-inhibit'])
  expect(await text(/^ ● On · ∞ $/)).toBe(' ● On · ∞ ')
  expect(await text(/unverified/)).toBeUndefined()
  await stop()
})

test('keep awake draws the switch off, on and unverified, and pressing it starts and stops one child', async ($, on) => {
  const { world, press, text, ui, stop } = await givenKeepAwake($, on, { desktop: 'XFCE' })
  world.spawn.plans['systemd-inhibit'] = 'run'

  expect((await ui.find({ type: 'Text', text: /^○ Off$/ }))?.props).toMatchObject({ color: 'inactive' })
  expect(await text(/unverified/)).toBeUndefined()

  await press()
  expect((await ui.find({ type: 'Text', text: /^ ● On · ∞ $/ }))?.props).toMatchObject({ color: 'inverseText', backgroundColor: 'claude' })
  expect((await ui.find({ type: 'Text', text: /unverified/ }))?.props.color).toBe('warning')
  expect(await text(/unverified/)).toBe(' · unverified here')
  expect(world.spawn.started).toEqual([[...SYSTEMD_INHIBIT, ...KEEP_AWAKE_HOLD]])
  expect(world.spawn.killed).toEqual([])

  await stop()
  expect(world.spawn.killed).toEqual(['systemd-inhibit'])
  expect(await text(/^○ Off$/)).toBe('○ Off')
  expect(await text(/unverified/)).toBeUndefined()
})

test('keep awake on a verified candidate shows no unverified label', async ($, on) => {
  const { world, press, text, stop } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'

  await press()

  expect(await text(/^ ● On · ∞ $/)).toBe(' ● On · ∞ ')
  expect(await text(/unverified/)).toBeUndefined()
  await stop()
})

test('keep awake turns itself off with a toast when the child exits later', async ($, on) => {
  const { world, press, text, toasts, clock } = await givenKeepAwake($, on, { platform: 'Darwin' })
  world.spawn.plans.caffeinate = 'run'
  await press()
  expect(await text(/^ ● On · ∞ $/)).toBe(' ● On · ∞ ')

  world.spawn.endings.caffeinate?.()
  await clock.advance(1_000)

  expect(await text(/^○ Off$/)).toBe('○ Off')
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
  expect(await text(/^ ● On · ∞ $/)).toBe(' ● On · ∞ ')
  expect(world.spawn.killed).toEqual([])
  await ui.press({ key: 'keep-awake-toggle' })
})
