import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, givenEngine } from './fixtures'

const MODEL_OPTIONS = ['sonnet', 'opus', 'haiku', 'fable']

const EFFORT_OPTIONS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

const effortReply = (level: string) =>
  level === 'auto' ? 'Effort level set to auto (this session only)' : `Set effort level to ${level} (this session only): description`

const givenPicker = async ($: Parameters<TestBody>[0], on: On, { rejectsEffort = false, stepEffort = 'xhigh' as string | null, effortText = undefined as string | null | undefined } = {}) => {
  const engine = givenEngine(on)
  const runs: { command: string; args: string }[] = []
  on('command.run', { command: 'model' }, (_, e) => {
    runs.push({ command: 'model', args: e.args })
    engine.world.model = `claude-${e.args}-5-5`

    return { text: `Set model to ${e.args}` }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  if (!rejectsEffort) {
    on('command.run', { command: 'effort' }, (_, e) => {
      runs.push({ command: 'effort', args: e.args })

      return effortText === null ? {} : { text: effortText ?? effortReply(e.args) }
    })
  }
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  const step = async (effort: string | null, turnId = 'step') => {
    for await (const _ of $.turn.step({ turnId, index: 0, model: engine.world.model, messageCount: 1, ...(effort === null ? {} : { effort: effort as 'high' }) })) void _
  }
  if (stepEffort !== null) await step(stepEffort)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const isButton = async (key: string) => (await ui.find({ type: 'Button', key })) !== undefined
  const open = () => ui.press({ key: 'model-picker-toggle' })

  return { ...engine, runs, ui, text, isButton, open, step }
}

test('the picker is closed until the model line is pressed, and pressing it again closes it', async ($, on) => {
  const { ui, text, isButton, open } = await givenPicker($, on)

  expect(await text(/^Opus 5\.5$/)).toBe('Opus 5.5')
  expect(await isButton('model-pick-opus')).toBe(false)
  expect(await text(/^Model$/)).toBeUndefined()

  await open()
  expect(await text(/^Model$/)).toBe('Model')
  expect(await text(/^Effort$/)).toBe('Effort')
  for (const choice of MODEL_OPTIONS) expect(await isButton(`model-pick-${choice}`)).toBe(true)
  for (const choice of EFFORT_OPTIONS) expect(await isButton(`effort-pick-${choice}`)).toBe(true)

  await open()
  expect(await text(/^Model$/)).toBeUndefined()
  expect(await isButton('model-pick-opus')).toBe(false)
  await ui.unmount()
})

test('pressing a model runs /model once, refreshes the header, toasts the reply and keeps the picker open', async ($, on) => {
  const { runs, toasts, text, isButton, open, ui } = await givenPicker($, on)
  await open()

  await ui.press({ key: 'model-pick-haiku' })

  expect(runs).toEqual([{ command: 'model', args: 'haiku' }])
  expect(toasts).toEqual(['Set model to haiku'])
  expect(await text(/Haiku/)).toBe('Haiku 5.5')
  expect(await text(/haiku/)).toBe(' ● haiku ')
  expect(await isButton('model-pick-opus')).toBe(true)
})

test('the current model carries the marker, matched by its alias inside the model id', async ($, on) => {
  const { text, open } = await givenPicker($, on)
  await open()

  expect(await text(/● opus/)).toBe(' ● opus ')
  expect(await text(/● sonnet|● haiku|● fable/)).toBeUndefined()
})

test('pressing an effort runs /effort once, refreshes the header, toasts the reply and keeps the picker open', async ($, on) => {
  const { runs, toasts, text, open, ui } = await givenPicker($, on)
  await open()

  await ui.press({ key: 'effort-pick-high' })

  expect(runs).toEqual([{ command: 'effort', args: 'high' }])
  expect(toasts).toEqual([effortReply('high')])
  expect(await text(/^· high$/)).toBe('· high')
  expect(await text(/● high/)).toBe(' ● high ')
  expect(await text(/● xhigh/)).toBeUndefined()
})

test('the current effort carries the marker', async ($, on) => {
  const { text, open } = await givenPicker($, on)
  await open()

  expect(await text(/● xhigh/)).toBe(' ● xhigh ')
  expect(await text(/● (auto|low|medium|high|max)$/)).toBeUndefined()
})

test('a main-loop turn locks the options into dim text with a hint, and its completion unlocks them without reopening', async ($, on) => {
  const { runs, text, isButton, open, ui } = await givenPicker($, on)
  await open()

  await $.turn.start({ text: 'work', turnId: 't1' })
  for (const choice of MODEL_OPTIONS) expect(await isButton(`model-pick-${choice}`)).toBe(false)
  for (const choice of EFFORT_OPTIONS) expect(await isButton(`effort-pick-${choice}`)).toBe(false)
  expect((await ui.find({ type: 'Text', text: /^● opus$/ }))?.props.dimColor).toBe(true)
  expect(await text(/idle/)).toBe('Unlocks when Claude is idle')
  expect(runs).toEqual([])

  await $.turn.complete({ answer: '', turnId: 't1' } as never)
  expect(await isButton('model-pick-sonnet')).toBe(true)
  expect(await isButton('effort-pick-max')).toBe(true)
  expect(await text(/idle/)).toBeUndefined()
})

test('a subagent turn neither locks the picker nor unlocks a running main turn', async ($, on) => {
  const { text, isButton, open } = await givenPicker($, on)
  await open()

  await $.turn.start({ text: 'sub', turnId: 's1', agentId: 'sub' })
  expect(await isButton('model-pick-sonnet')).toBe(true)

  await $.turn.start({ text: 'work', turnId: 't1' })
  await $.turn.complete({ answer: '', turnId: 's1', agentId: 'sub' } as never)
  expect(await isButton('model-pick-sonnet')).toBe(false)
  expect(await text(/idle/)).toBe('Unlocks when Claude is idle')
})

test('a new conversation unlocks a picker left locked by a turn that never completed', async ($, on) => {
  const { isButton, open } = await givenPicker($, on)
  await open()
  await $.turn.start({ text: 'work', turnId: 't1' })
  expect(await isButton('model-pick-sonnet')).toBe(false)

  await $.classic.SessionStart({ source: 'clear' } as never)

  expect(await isButton('model-pick-sonnet')).toBe(true)
})

test('a rejected command toasts its message and leaves the picker usable', async ($, on) => {
  const { runs, toasts, isButton, open, ui } = await givenPicker($, on, { rejectsEffort: true })
  await open()

  await ui.press({ key: 'effort-pick-low' })

  expect(toasts).toEqual(['no implementation for command.run'])
  expect(runs).toEqual([])
  expect(await isButton('effort-pick-low')).toBe(true)
  await ui.press({ key: 'model-pick-sonnet' })
  expect(runs).toEqual([{ command: 'model', args: 'sonnet' }])
})

test('the model line shows a caret that follows the picker, and the current option is a coloured chip while the others are plain', async ($, on) => {
  const { text, open, ui } = await givenPicker($, on)

  expect(await text(/^▶ $/)).toBe('▶ ')
  await open()
  expect(await text(/^▼ $/)).toBe('▼ ')
  expect(await text(/^▶ $/)).toBeUndefined()

  expect((await ui.find({ type: 'Text', text: /^ ● opus $/ }))?.props).toMatchObject({ color: 'inverseText', backgroundColor: 'claude', bold: true })
  expect((await ui.find({ type: 'Text', text: /^ ● xhigh $/ }))?.props).toMatchObject({ color: 'inverseText', backgroundColor: 'claude', bold: true })
  expect((await ui.find({ type: 'Text', text: /^sonnet$/ }))?.props).toMatchObject({ color: 'suggestion' })
  expect((await ui.find({ type: 'Text', text: /^high$/ }))?.props.backgroundColor).toBeUndefined()
})

test('before any turn step or pick the effort is unknown: the header shows none and no option is marked', async ($, on) => {
  const { text, open } = await givenPicker($, on, { stepEffort: null })
  await open()

  expect(await text(/^· /)).toBeUndefined()
  expect(await text(/● (auto|low|medium|high|xhigh|max)/)).toBeUndefined()
})

test('an effort typed as /effort moves the header and the chip without the picker', async ($, on) => {
  const { text, open } = await givenPicker($, on)
  await open()

  await $.command.run({ command: 'effort', args: 'low' } as never)

  expect(await text(/^· low$/)).toBe('· low')
  expect(await text(/● low/)).toBe(' ● low ')
  expect(await text(/● xhigh/)).toBeUndefined()
})

test('picking auto keeps auto marked after the next turn step reports the level auto resolved to', async ($, on) => {
  const { text, open, ui, step } = await givenPicker($, on)
  await open()

  await ui.press({ key: 'effort-pick-auto' })
  expect(await text(/● auto/)).toBe(' ● auto ')

  await step('high', 'next')
  expect(await text(/● auto/)).toBe(' ● auto ')
  expect(await text(/^· auto$/)).toBe('· auto')
})

test('a model without effort clears the effort even after auto', async ($, on) => {
  const { text, open, ui, step } = await givenPicker($, on)
  await open()
  await ui.press({ key: 'effort-pick-auto' })

  await step(null, 'next')

  expect(await text(/● (auto|low|medium|high|xhigh|max)/)).toBeUndefined()
  expect(await text(/^· /)).toBeUndefined()
})

test('a reply that carries no level leaves the effort as it was', async ($, on) => {
  const { text, open, ui, toasts } = await givenPicker($, on, { effortText: 'This model does not support effort' })
  await open()

  await ui.press({ key: 'effort-pick-low' })

  expect(await text(/● xhigh/)).toBe(' ● xhigh ')
  expect(toasts).toContain('This model does not support effort')
})

test('a pick whose /effort answers with no text, as an interactive session does, marks the level that was picked', async ($, on) => {
  const { text, open, ui, runs } = await givenPicker($, on, { effortText: null })
  await open()

  await ui.press({ key: 'effort-pick-medium' })

  expect(runs).toEqual([{ command: 'effort', args: 'medium' }])
  expect(await text(/● medium/)).toBe(' ● medium ')
  expect(await text(/^· medium$/)).toBe('· medium')
  expect(await text(/● xhigh/)).toBeUndefined()
})

test('a typed /effort with no reply text marks its level, and one that is not a level changes nothing', async ($, on) => {
  const { text, open } = await givenPicker($, on, { effortText: null })
  await open()

  await $.command.run({ command: 'effort', args: ' Low ' } as never)
  expect(await text(/● low/)).toBe(' ● low ')

  await $.command.run({ command: 'effort', args: 'ultracode on' } as never)
  expect(await text(/● low/)).toBe(' ● low ')
})
