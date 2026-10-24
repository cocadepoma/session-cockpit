import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { NOW, PANE, givenEngine } from './fixtures'

type Outcome = 'ok' | 'error' | 'deny'

const behaviour: { delayMs: number; outcome: Outcome } = { delayMs: 0, outcome: 'ok' }

const answer = async (clock: ReturnType<typeof mock.clock>) => {
  if (behaviour.delayMs > 0) await clock.sleep(behaviour.delayMs)
  if (behaviour.outcome === 'deny') return { deny: 'Not allowed' } as never
  if (behaviour.outcome === 'error') return { isError: true as const, result: 'It failed' } as never

  return { result: { content: 'ok' } } as never
}

const givenActivity = async ($: Parameters<TestBody>[0], on: On) => {
  behaviour.delayMs = 0
  behaviour.outcome = 'ok'
  const clock = mock.clock(on, { now: NOW })
  const engine = givenEngine(on, { usesMockClock: true })
  on('tool.call', { tool: /^(Read|Grep|Glob|WebFetch|Agent)$/ }, () => answer(clock))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const rows = async () =>
    (await ui.findAll({ type: 'Text', text: /^(Read|Grep|Glob|Bash|WebFetch|Explore|Agent)$|^[✓✗└⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/ })).map(found => found.text)

  return { ...engine, clock, ui, text, rows }
}

const READ = { tool: 'Read', file_path: '/home/dev/app/src/index.ts' } as const

test('a running tool shows its name, target and elapsed time, and finishes with a tick and its duration', { options: { showActivity: true } }, async ($, on) => {
  const { clock, ui, text } = await givenActivity($, on)
  expect(await text(/^Activity/)).toBeUndefined()
  behaviour.delayMs = 2_000

  const call = $.tool.call(READ)
  await clock.settle()
  expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')
  expect(await text(/^Read$/)).toBe('Read')
  expect(await text(/^index\.ts$/)).toBe('index.ts')
  expect(await text(/^0s$/)).toBe('0s')

  await clock.advance(1_000)
  expect(await text(/^1s$/)).toBe('1s')
  expect(await text(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/)).toBeDefined()

  await clock.advance(1_000)
  await call
  expect(await text(/^Activity \(0 running\)$/)).toBe('Activity (0 running)')
  expect(await text(/^✓$/)).toBe('✓')
  expect(await text(/^2s$/)).toBe('2s')
  await ui.unmount()
})

test('a denied or errored call is marked with a cross and a successful one with a tick', { options: { showActivity: true } }, async ($, on) => {
  const { ui, rows } = await givenActivity($, on)

  behaviour.outcome = 'deny'
  await $.tool.call(READ)
  behaviour.outcome = 'error'
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
  behaviour.outcome = 'ok'
  await $.tool.call({ tool: 'Glob', pattern: '*.ts' } as never)

  expect(await rows()).toEqual(['✓', 'Glob', '✗', 'Grep', '✗', 'Read'])
  await ui.unmount()
})

test('the target is the base name, the pattern, the first line of a command or a URL host, with control characters stripped', { options: { showActivity: true } }, async ($, on) => {
  const { ui, text } = await givenActivity($, on)

  await $.tool.call({ tool: 'Grep', pattern: 'foo.*bar' } as never)
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com/docs?q=1', prompt: 'p' } as never)
  await $.tool.call({ tool: 'Bash', command: '\u001b[31mls -la\nrm -rf /' })
  await $.tool.call({ tool: 'TodoWrite', todos: [] })

  expect(await text(/^foo\.\*bar$/)).toBe('foo.*bar')
  expect(await text(/^example\.com$/)).toBe('example.com')
  expect(await text(/^\[31mls -la$/)).toBe('[31mls -la')
  expect(await text(/rm -rf/)).toBeUndefined()
  expect(await text(/^TodoWrite$/)).toBe('TodoWrite')
  await ui.unmount()
})

test('only the last five finished calls are kept, newest first', { options: { showActivity: true } }, async ($, on) => {
  const { ui, text } = await givenActivity($, on)

  for (const number of [1, 2, 3, 4, 5, 6, 7]) await $.tool.call({ tool: 'Grep', pattern: `p${number}` } as never)

  const patterns = (await ui.findAll({ type: 'Text', text: /^p\d$/ })).map(found => found.text)
  expect(patterns).toEqual(['p7', 'p6', 'p5', 'p4', 'p3'])
  expect(await text(/^Activity \(0 running\)$/)).toBe('Activity (0 running)')
  await ui.unmount()
})

test('a subagent is a row of its own and its tool calls nest under it until it finishes', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, text, rows } = await givenActivity($, on)

  world.agents = [{ id: 'a1', type: 'Explore', description: 'Map the code', status: 'running' }]
  await $.agent.spawn({ prompt: 'Look', description: 'Map the code', subagentType: 'Explore' } as never)
  expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')
  expect(await text(/^Explore$/)).toBe('Explore')
  expect(await text(/^Map the code$/)).toBe('Map the code')

  behaviour.delayMs = 3_000
  const nested = $.tool.call({ tool: 'Read', file_path: '/home/dev/app/a.ts', agentId: 'a1' } as never)
  await clock.settle()
  expect(await text(/^Activity \(2 running\)$/)).toBe('Activity (2 running)')
  expect(await rows()).toEqual([expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/), 'Explore', '└', expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/), 'Read'])

  await clock.advance(3_000)
  await nested
  expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')
  expect(await rows()).toEqual([expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/), 'Explore'])

  await $.turn.complete({ answer: '', agentId: 'a1', reason: 'answer', isAborted: false } as never)
  expect(await text(/^Activity \(0 running\)$/)).toBe('Activity (0 running)')
  expect(await rows()).toEqual(['✓', 'Explore'])
  await ui.unmount()
})

test('the Agent tool call is not a row and a background subagent stays running after it returns', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, text, rows } = await givenActivity($, on)
  behaviour.delayMs = 1_000

  const launch = $.tool.call({ tool: 'Agent', prompt: 'p', description: 'd', subagent_type: 'Explore' } as never)
  await clock.settle()
  expect(await text(/^Activity/)).toBeUndefined()

  world.agents = [{ id: 'a1', type: 'Explore', description: 'Background work', status: 'running' }]
  await $.agent.spawn({ prompt: 'p', description: 'Background work', subagentType: 'Explore' } as never)
  await clock.advance(1_000)
  await launch
  expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')

  await clock.advance(30_000)
  expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')
  expect(await text(/^31s$/)).toBe('31s')

  await $.turn.complete({ answer: '', agentId: 'a1', reason: 'aborted', isAborted: true } as never)
  expect(await rows()).toEqual(['✗', 'Explore'])
  await ui.unmount()
})

test('a new conversation clears the activity', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, text } = await givenActivity($, on)
  await $.tool.call(READ)
  expect(await text(/^Activity/)).toBeDefined()

  world.sessionId = 'other'
  await clock.advance(1_000)

  expect(await text(/^Activity/)).toBeUndefined()
  await ui.unmount()
})

const spawnReviewer = async ($: Parameters<TestBody>[0], world: { agents: unknown }) => {
  world.agents = [{ id: 'a1', type: 'Explore', description: 'Map the code', status: 'running' }]
  await $.agent.spawn({ prompt: 'Look', description: 'Map the code', subagentType: 'Explore' } as never)
}

test('a subagent whose turn end was missed is finished with a tick once the agent list says completed', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, text, rows } = await givenActivity($, on)
  await spawnReviewer($, world)
  await clock.advance(2_000)
  expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')

  world.agents = [{ id: 'a1', type: 'Explore', description: 'Map the code', status: 'completed' }]
  await clock.advance(1_000)

  expect(await text(/^Activity \(0 running\)$/)).toBe('Activity (0 running)')
  expect(await rows()).toEqual(['✓', 'Explore'])
  await ui.unmount()
})

test('a failed or killed agent is finished with a cross', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, rows } = await givenActivity($, on)
  await spawnReviewer($, world)

  world.agents = [{ id: 'a1', type: 'Explore', description: 'Map the code', status: 'killed' }]
  await clock.advance(1_000)

  expect(await rows()).toEqual(['✗', 'Explore'])
  await ui.unmount()
})

test('an agent missing from the list is finished with a tick', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, rows } = await givenActivity($, on)
  await spawnReviewer($, world)

  world.agents = []
  await clock.advance(1_000)

  expect(await rows()).toEqual(['✓', 'Explore'])
  await ui.unmount()
})

test('pending, running and waiting agents stay as rows', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, text } = await givenActivity($, on)
  await spawnReviewer($, world)

  for (const status of ['pending', 'waiting', 'running'] as const) {
    world.agents = [{ id: 'a1', type: 'Explore', description: 'Map the code', status }]
    await clock.advance(1_000)
    expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')
  }
  await ui.unmount()
})

test('rows are keyed by the call id, so two calls running together stay two rows', { options: { showActivity: true } }, async ($, on) => {
  const { clock, ui, text } = await givenActivity($, on)
  behaviour.delayMs = 2_000

  const first = $.tool.call({ ...READ, tool_use_id: 'u1' } as never)
  const second = $.tool.call({ ...READ, tool_use_id: 'u2' } as never)
  await clock.settle()
  expect(await text(/^Activity \(2 running\)$/)).toBe('Activity (2 running)')

  await clock.advance(2_000)
  await Promise.all([first, second])
  expect(await text(/^Activity \(0 running\)$/)).toBe('Activity (0 running)')
  await ui.unmount()
})

test('a main turn end removes the tool rows still running without recording them as finished', { options: { showActivity: true } }, async ($, on) => {
  const { clock, ui, text, rows } = await givenActivity($, on)
  behaviour.delayMs = 5_000

  const call = $.tool.call(READ)
  await clock.settle()
  expect(await text(/^Activity \(1 running\)$/)).toBe('Activity (1 running)')

  await $.turn.complete({ answer: '', reason: 'answer', isAborted: false } as never)
  expect(await text(/^Activity/)).toBeUndefined()

  await clock.advance(5_000)
  await call
  expect(await rows()).toEqual([])
  await ui.unmount()
})

test('a main turn end leaves a running subagent and its nested calls alone', { options: { showActivity: true } }, async ($, on) => {
  const { world, clock, ui, text } = await givenActivity($, on)
  await spawnReviewer($, world)
  behaviour.delayMs = 5_000
  const nested = $.tool.call({ tool: 'Read', file_path: '/home/dev/app/a.ts', agentId: 'a1' } as never)
  await clock.settle()

  await $.turn.complete({ answer: '', reason: 'answer', isAborted: false } as never)

  expect(await text(/^Activity \(2 running\)$/)).toBe('Activity (2 running)')
  await clock.advance(5_000)
  await nested
  await ui.unmount()
})

test('a URL target drops the credentials before the host', { options: { showActivity: true } }, async ($, on) => {
  const { ui, text } = await givenActivity($, on)

  await $.tool.call({ tool: 'WebFetch', url: 'https://user:tok@en@example.com:8080/x', prompt: 'p' } as never)

  expect(await text(/^example\.com:8080$/)).toBe('example.com:8080')
  expect(await text(/user:tok/)).toBeUndefined()
  await ui.unmount()
})

test('invisible direction and line separator characters are stripped from a target', { options: { showActivity: true } }, async ($, on) => {
  const { ui, text } = await givenActivity($, on)

  await $.tool.call({ tool: 'Bash', command: 'ls ‮-la⁦x' })

  expect(await text(/^ls -la x$/)).toBe('ls -la x')
  await ui.unmount()
})

const recordsActivity = async ($: Parameters<TestBody>[0], on: On) => {
  const written: string[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'activity') written.push(e.key)

    return next(e)
  })
  givenEngine(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await $.agent.spawn({ prompt: 'Look', description: 'Map the code', subagentType: 'Explore' } as never)
  await $.turn.complete({ answer: '', reason: 'answer', isAborted: false } as never)

  return written
}

test('with showActivity on, the hooks record into the activity state', { options: { showActivity: true } }, async ($, on) => {
  expect((await recordsActivity($, on)).length).toBeGreaterThan(0)
})

test('with showActivity off, nothing is recorded into the activity state', async ($, on) => {
  expect(await recordsActivity($, on)).toEqual([])
})

test('the elapsed time of a running tool moves with Context hidden', { options: { showActivity: true, showContext: false } }, async ($, on) => {
  const { clock, ui, text } = await givenActivity($, on)
  behaviour.delayMs = 5_000

  const call = $.tool.call(READ)
  await clock.settle()
  expect(await text(/^0s$/)).toBe('0s')

  await clock.advance(3_000)
  expect(await text(/^3s$/)).toBe('3s')

  await clock.advance(2_000)
  await call
  await ui.unmount()
})

test('the tick is written only while a row runs', { options: { showActivity: true } }, async ($, on) => {
  const ticks: string[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'tick') ticks.push(e.key)

    return next(e)
  })
  const { clock, ui } = await givenActivity($, on)
  behaviour.delayMs = 3_000

  await clock.advance(3_000)
  expect(ticks).toEqual([])

  const call = $.tool.call(READ)
  await clock.settle()
  await clock.advance(2_000)
  expect(ticks.length).toBeGreaterThan(0)

  await clock.advance(1_000)
  await call
  const settled = ticks.length
  await clock.advance(3_000)
  expect(ticks.length).toBe(settled)
  await ui.unmount()
})
