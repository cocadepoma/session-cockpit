import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { HOUR_MS, NOW, PANE, givenEngine } from './fixtures'

const LIVE_LIMITS = [
  { kind: 'five_hour', percentUsed: 41.4, resetsAt: '2026-10-21T12:13:00Z' },
  { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-25T13:00:00Z' },
]

const storedLimits = (items: typeof LIVE_LIMITS, ageHours: number) => ({
  items,
  readAt: NOW - ageHours * HOUR_MS,
})

test('a session that receives rate limits stores them with the time they were read', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(world.store.lastLimits).toEqual({ items: LIVE_LIMITS, readAt: NOW })
})

test('a later session without a reading shows the stored limits at once with their age', async ($, on) => {
  const { world } = givenEngine(on)
  world.rateLimits = []
  world.store.lastLimits = storedLimits(LIVE_LIMITS, 2)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^41%$/)).toBe('41%')
  expect(await text(/^90%$/)).toBe('90%')
  expect(await text(/^ · 2h ago$/)).toBe(' · 2h ago')
  await ui.unmount()
})

test('a stored window that already reset is not shown and one still running is', async ($, on) => {
  const { world } = givenEngine(on)
  world.rateLimits = []
  world.store.lastLimits = storedLimits(
    [
      { kind: 'five_hour', percentUsed: 41.4, resetsAt: '2026-10-21T09:00:00Z' },
      { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-25T13:00:00Z' },
    ],
    3,
  )
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^41%$/)).toBeUndefined()
  expect(await text(/^90%$/)).toBe('90%')
  expect(await text(/ago$/)).toBe(' · 3h ago')
  await ui.unmount()
})

test('a live reading arriving after a stored one shows without the age and overwrites the store', async ($, on) => {
  const { world } = givenEngine(on)
  world.rateLimits = []
  world.store.lastLimits = storedLimits(LIVE_LIMITS, 2)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/ago$/)).toBe(' · 2h ago')

  world.rateLimits = [{ kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-21T14:00:00Z' }]
  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await text(/^12%$/)).toBe('12%')
  expect(await text(/^90%$/)).toBeUndefined()
  expect(await text(/ago$/)).toBeUndefined()
  expect(world.store.lastLimits).toEqual({
    items: [{ kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-21T14:00:00Z' }],
    readAt: NOW,
  })
  await ui.unmount()
})

test('an empty refresh tick after a live reading does not clear the shown limits', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^41%$/)).toBe('41%')

  world.rateLimits = []
  await clock.advance(60_000)

  expect(await text(/^41%$/)).toBe('41%')
  expect(await text(/^90%$/)).toBe('90%')
  expect(await text(/ago$/)).toBeUndefined()
  await ui.unmount()
})

test('off a subscription, with no reading ever and nothing stored, there is no Usage section', async ($, on) => {
  const { world } = givenEngine(on)
  world.rateLimits = []
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Usage$/ }))?.text).toBeUndefined()
  expect(world.store.lastLimits).toBeUndefined()
  await ui.unmount()
})

test('a fresh conversation shows the estimated context marked with a tilde until the first real figure', async ($, on) => {
  const { world } = givenEngine(on)
  world.tokens = undefined
  world.percent = undefined
  world.breakdownTokens = 20000
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^~10%$/)).toBe('~10%')
  expect(await text(/tokens/)).toBe('~20,000 / 200,000 tokens')

  world.tokens = 45210
  world.percent = 23
  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await text(/^23%$/)).toBe('23%')
  expect(await text(/tokens/)).toBe('45,210 / 200,000 tokens')
  await ui.unmount()
})

test('a breakdown that throws or is absent leaves the context at no usage yet', async ($, on) => {
  const { world } = givenEngine(on)
  world.tokens = undefined
  world.percent = undefined
  world.breakdownTokens = 'throws'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/No usage yet/)).toBe('No usage yet')

  world.breakdownTokens = undefined
  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await text(/No usage yet/)).toBe('No usage yet')
  expect(await text(/tokens/)).toBeUndefined()
  await ui.unmount()
})

type Limit = { kind: string; percentUsed: number; resetsAt: string }

const paceMarks = async ($: Parameters<TestBody>[0], on: On, limits: Limit[]) => {
  const { world } = givenEngine(on)
  world.rateLimits = limits
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const marks = (await ui.findAll({ type: 'Text', text: /^▲ / })).map(found => ({
    text: found.text,
    color: found.props.color,
  }))
  await ui.unmount()

  return marks
}

test('a window on course to reach 100 percent shows its projection in the error color', async ($, on) => {
  const marks = await paceMarks($, on, [{ kind: 'five_hour', percentUsed: 50, resetsAt: '2026-10-21T12:30:00Z' }])

  expect(marks).toEqual([{ text: '▲ 100%', color: 'error' }])
})

test('a projection from 90 up to 99 percent is a warning', async ($, on) => {
  const marks = await paceMarks($, on, [{ kind: 'five_hour', percentUsed: 45, resetsAt: '2026-10-21T12:30:00Z' }])

  expect(marks).toEqual([{ text: '▲ 90%', color: 'warning' }])
})

test('the seven day window is projected over seven days', async ($, on) => {
  const marks = await paceMarks($, on, [{ kind: 'seven_day', percentUsed: 50, resetsAt: '2026-10-24T22:00:00Z' }])

  expect(marks).toEqual([{ text: '▲ 100%', color: 'error' }])
})

test('a seven day window that has barely started shows no mark', async ($, on) => {
  const marks = await paceMarks($, on, [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-28T10:00:00Z' }])

  expect(marks).toEqual([])
})

test('no mark below 10 percent used', async ($, on) => {
  const marks = await paceMarks($, on, [{ kind: 'five_hour', percentUsed: 9, resetsAt: '2026-10-21T14:30:00Z' }])

  expect(marks).toEqual([])
})

test('no mark when the projection stays under 90 percent', async ($, on) => {
  const marks = await paceMarks($, on, [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-21T12:30:00Z' }])

  expect(marks).toEqual([])
})

test('no mark for a spend limit or an unknown kind', async ($, on) => {
  const marks = await paceMarks($, on, [
    { kind: 'spend_limit', percentUsed: 80, resetsAt: '2026-10-21T12:30:00Z' },
    { kind: 'mystery', percentUsed: 80, resetsAt: '2026-10-21T12:30:00Z' },
  ])

  expect(marks).toEqual([])
})

test('the context draws no session line and no cache countdown', async ($, on) => {
  givenEngine(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: '' } as never)
  await $.classic.SessionStart({ source: 'compact', seconds_since_last_response: 30 } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Context$/ })).toBeDefined()
  expect(await ui.find({ key: 'session-facts' })).toBeUndefined()
  expect(await ui.find({ key: 'cache-countdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^cache |reply |tok\/s|compact$/ })).toBeUndefined()
  await ui.unmount()
})
