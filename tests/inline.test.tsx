import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, givenEngine, runSidebar } from './fixtures'

const INLINE_PANE = { ...PANE, props: { ...PANE.props, placement: 'inline', bodyColumns: 100 } } as const

const MAIN_SCREEN = { columns: 100, rows: 40, isFullscreen: false }

const NARROW_FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }

const FULLSCREEN_HINT = 'Full sidebar: set "tui": "fullscreen" in ~/.claude/settings.json'

const WIDTH_HINT = 'Full sidebar: widen the terminal to 110 columns'

const startSession = async ($: Parameters<TestBody>[0], on: On) => {
  const engine = givenEngine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 'step', index: 0, model: engine.world.model, messageCount: 1, effort: 'xhigh' })) void _
  await $.tool.call({ tool: 'Bash', command: 'true' })

  return engine
}

const mountInline = async (
  $: Parameters<TestBody>[0],
  { surface = 'terminal' as 'terminal' | 'mobile', viewport = MAIN_SCREEN as typeof MAIN_SCREEN | typeof NARROW_FULLSCREEN } = {},
) => {
  const ui = await $.ui.mount({ ...INLINE_PANE, surface, viewport })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  return { ui, text }
}

test('a terminal without fullscreen closes the sidebar the session opened by itself, and the next session still wants it', async ($, on) => {
  const { world } = await startSession($, on)

  const { ui } = await mountInline($)
  await ui.unmount()

  expect(world.isPaneOpen).toBe(false)
  expect(world.store.open).toBeUndefined()
})

test('/sidebar on a terminal without fullscreen shows model, effort, context, limits and the fullscreen hint, with nothing to press', async ($, on) => {
  const { world } = await startSession($, on)
  world.isPaneOpen = false
  expect((await $.command.run(runSidebar)).text).toBe('Sidebar shown.')

  const { ui, text } = await mountInline($)

  expect(world.isPaneOpen).toBe(true)
  expect(await text(/Opus/)).toBe('Opus 5.5')
  expect(await text(/^· /)).toBe('· xhigh')
  expect(await text(/^Context$/)).toBe('Context')
  expect(await text(/^23%$/)).toBe('23%')
  expect(await text(/^5h$/)).toBe('5h')
  expect(await text(/^41%$/)).toBe('41%')
  expect(await text(/^7d$/)).toBe('7d')
  expect(await text(/^90%$/)).toBe('90%')
  expect(await text(/fullscreen/)).toBe(FULLSCREEN_HINT)
  expect(await text(/tokens|^Usage$|^Skills$|^Help$/)).toBeUndefined()
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  await ui.unmount()
})

test('the compact view leaves out Context and Usage when they are hidden', { options: { showContext: false, showUsage: false } }, async ($, on) => {
  const { world } = await startSession($, on)
  world.isPaneOpen = false
  await $.command.run(runSidebar)

  const { ui, text } = await mountInline($)

  expect(await text(/Opus/)).toBe('Opus 5.5')
  expect(await text(/^Context$|^23%$|^5h$|^7d$/)).toBeUndefined()
  expect(await text(/fullscreen/)).toBe(FULLSCREEN_HINT)
  await ui.unmount()
})

test('a remote surface that places the sidebar above its prompt draws the compact view and leaves it open', async ($, on) => {
  const { world } = await startSession($, on)

  const { ui, text } = await mountInline($, { surface: 'mobile' })

  expect(world.isPaneOpen).toBe(true)
  expect(await text(/Opus/)).toBe('Opus 5.5')
  expect(await text(/^23%$/)).toBe('23%')
  expect(await text(/tokens/)).toBeUndefined()
  expect(await text(/fullscreen/)).toBeUndefined()
  await ui.unmount()
})

test('a fullscreen terminal too narrow to dock keeps the sidebar it opened by itself and draws the compact view with the width hint', async ($, on) => {
  const { world } = await startSession($, on)

  const { ui, text } = await mountInline($, { viewport: NARROW_FULLSCREEN })

  expect(world.isPaneOpen).toBe(true)
  expect(await text(/^23%$/)).toBe('23%')
  expect(await text(/Full sidebar/)).toBe(WIDTH_HINT)
  await ui.unmount()
})

test('a fullscreen terminal still draws the full sidebar for the sidebar the session opened by itself', async ($, on) => {
  const { world } = await startSession($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  expect(world.isPaneOpen).toBe(true)
  expect(await text(/tokens/)).toBe('45,210 / 200,000 tokens')
  expect(await text(/fullscreen/)).toBeUndefined()
  await ui.unmount()
})
