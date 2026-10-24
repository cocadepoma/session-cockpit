import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COST_ROOT, NOW, PANE, givenEngine } from './fixtures'

const pad = (value: number) => String(value).padStart(2, '0')

const day = (daysBefore: number) => {
  const today = new Date(NOW)
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBefore)

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const ledger = (sessionId: string, days: Record<string, number>) => JSON.stringify({ sessionId, days })

const OWN = `${COST_ROOT}/current.json`

const givenSession = async ($: Parameters<TestBody>[0], on: On, seed: (files: Record<string, string>) => void = () => {}, now = NOW) => {
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on, { now })
  const engine = givenEngine(on, { usesMockClock: true })
  engine.world.rateLimits = []
  seed(engine.world.files)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await clock.advance(1_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const line = async () => (await ui.find({ key: 'cost-totals' }))?.text

  return { ...engine, clock, ui, line }
}

test('a turn end adds the cost since the last reading to today in the session file', async ($, on) => {
  const { world, ui, line } = await givenSession($, on)
  expect(await line()).toBeUndefined()

  world.costUsd = 2
  await $.turn.complete({ answer: '' } as never)
  expect(JSON.parse(world.files[OWN] ?? 'null')).toMatchObject({ sessionId: 'current', days: { [day(0)]: 0.5 }, lastUsd: 2 })
  expect(await line()).toBe('today $0.50 · 7d $0.50')

  world.costUsd = 2.25
  await $.turn.complete({ answer: '' } as never)
  expect(JSON.parse(world.files[OWN] ?? 'null').days).toEqual({ [day(0)]: 0.75 })
  expect(await line()).toBe('today $0.75 · 7d $0.75')
  await ui.unmount()
})

test('a cost that went down counts in full, as after a clear', async ($, on) => {
  const { world, ui, line } = await givenSession($, on)
  world.costUsd = 2
  await $.turn.complete({ answer: '' } as never)

  world.costUsd = 0.3
  await $.turn.complete({ answer: '' } as never)

  expect(await line()).toBe('today $0.80 · 7d $0.80')
  await ui.unmount()
})

test('the cost a session already had when it started is not counted, and nothing is written for no change', async ($, on) => {
  const { world, ui, line } = await givenSession($, on)

  await $.turn.complete({ answer: '' } as never)

  expect(JSON.parse(world.files[OWN] ?? 'null')).toMatchObject({ days: {}, lastUsd: 1.5 })
  expect(await line()).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Usage$/ }))?.text).toBeUndefined()
  await ui.unmount()
})

test('the line sums every session file over today and the six days before', async ($, on) => {
  const { world, ui, line } = await givenSession($, on, files => {
    files[`${COST_ROOT}/other.json`] = ledger('other', { [day(0)]: 1, [day(3)]: 2, [day(6)]: 4, [day(7)]: 8 })
    files[`${COST_ROOT}/third.json`] = ledger('third', { [day(1)]: 0.5 })
    files[`${COST_ROOT}/broken.json`] = 'not json'
    files[`${COST_ROOT}/notes.txt`] = 'ignored'
  })
  expect(await line()).toBe('today $1.00 · 7d $7.50')

  world.costUsd = 2
  await $.turn.complete({ answer: '' } as never)
  expect(await line()).toBe('today $1.50 · 7d $8.00')
  await ui.unmount()
})

test('the totals follow the day when the clock passes midnight', async ($, on) => {
  const today = new Date(NOW)
  const beforeMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 30).getTime()
  const { clock, ui, line } = await givenSession(
    $,
    on,
    files => {
      files[`${COST_ROOT}/other.json`] = ledger('other', { [day(0)]: 1 })
    },
    beforeMidnight,
  )
  expect(await line()).toBe('today $1.00 · 7d $1.00')

  await clock.advance(60_000)
  expect(await line()).toBe('today $0.00 · 7d $1.00')
  await ui.unmount()
})

test('a session start deletes the files whose newest day is older than eight days and keeps the others', async ($, on) => {
  const { world, ui } = await givenSession($, on, files => {
    files[`${COST_ROOT}/stale.json`] = ledger('stale', { [day(9)]: 1, [day(12)]: 1 })
    files[`${COST_ROOT}/edge.json`] = ledger('edge', { [day(8)]: 1 })
    files[`${COST_ROOT}/mixed.json`] = ledger('mixed', { [day(30)]: 1, [day(2)]: 1 })
    files[`${COST_ROOT}/broken.json`] = 'not json'
  })

  expect(Object.keys(world.files).filter(path => path.startsWith(COST_ROOT)).sort()).toEqual([
    `${COST_ROOT}/broken.json`,
    OWN,
    `${COST_ROOT}/edge.json`,
    `${COST_ROOT}/mixed.json`,
  ])
  await ui.unmount()
})

test('a baseline kept in the session file stops a restart from counting the whole cost again', async ($, on) => {
  const { world, ui, line } = await givenSession($, on, files => {
    files[OWN] = JSON.stringify({ sessionId: 'current', days: { [day(0)]: 0.25 }, lastUsd: 1 })
  })

  await $.turn.complete({ answer: '' } as never)

  expect(JSON.parse(world.files[OWN] ?? 'null')).toMatchObject({ days: { [day(0)]: 0.75 }, lastUsd: 1.5 })
  expect(await line()).toBe('today $0.75 · 7d $0.75')
  await ui.unmount()
})

test('a compaction keeps the cost of its summary for the next turn end', async ($, on) => {
  const { world, ui, line } = await givenSession($, on)

  world.costUsd = 2
  await $.classic.SessionStart({ source: 'compact' })
  await $.turn.complete({ answer: '' } as never)

  expect(await line()).toBe('today $0.50 · 7d $0.50')
  await ui.unmount()
})

test('turn ends that overlap count a cost change once', async ($, on) => {
  const { world, ui, line } = await givenSession($, on)

  world.costUsd = 2
  await Promise.all([
    $.turn.complete({ answer: '' } as never),
    $.turn.complete({ answer: '', agentId: 'sub' } as never),
    $.turn.complete({ answer: '' } as never),
  ])

  expect(JSON.parse(world.files[OWN] ?? 'null').days).toEqual({ [day(0)]: 0.5 })
  expect(await line()).toBe('today $0.50 · 7d $0.50')
  await ui.unmount()
})

test('the totals are read for a main turn end while the pane is shown, never for a subagent or a hidden pane', async ($, on) => {
  const { world, ui } = await givenSession($, on)
  const reads = () => world.listed.filter(path => path === COST_ROOT).length
  const before = reads()

  world.costUsd = 2
  await $.turn.complete({ answer: '', agentId: 'sub' } as never)
  expect(reads()).toBe(before)

  await $.turn.complete({ answer: '' } as never)
  expect(reads()).toBe(before + 1)

  world.isPaneShown = false
  world.costUsd = 3
  await $.turn.complete({ answer: '' } as never)
  expect(reads()).toBe(before + 1)
  await ui.unmount()
})

test('a cost that cannot be written does not stop the turn end from going on', async ($, on) => {
  const { world, ui } = await givenSession($, on)
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  world.costUsd = 2
  world.isWriteFailing = true
  const result = await $.turn.complete({ answer: '' } as never)

  expect(result).toEqual({ text: '' })
  expect(await text(/spent/)).toBe('$2.00 spent')
  await ui.unmount()
})
