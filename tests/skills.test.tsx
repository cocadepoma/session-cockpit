import { expect, test } from 'claude-code/testing'
import { PANE, givenEngine, wheelTick } from './fixtures'
import type { CommandStandIn } from './fixtures'

const numberedSkills = (description: (index: number) => string): CommandStandIn[] =>
  Array.from({ length: 12 }, (_, index) => ({
    name: `skill-${String(index + 1).padStart(2, '0')}`,
    description: description(index + 1),
    source: 'user',
  }))

test('the skills picker lists user and plugin skills, filters them and fills the prompt', async ($, on) => {
  const { filled } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

    expect(await text(/\(3\)/)).toBe(' (3)')
    expect(await text(/review-checklist/)).toBeUndefined()

    await ui.press({ key: 'skills-toggle' })
    expect(await text(/review-checklist/)).toBe('/frontend-review-checklist')
    expect(await text(/figma-use/)).toBe('/figma:figma-use')
    expect(await text(/^\/clear$/)).toBeUndefined()
    expect(await text(/^\/sidebar$/)).toBeUndefined()

    await ui.input({ key: 'skills-filter', text: 'merge', kind: 'change' })
    expect(await text(/gitlab-mr/)).toBe('/gitlab-mr')
    expect(await text(/review-checklist/)).toBeUndefined()

    await ui.press({ key: 'skill:gitlab-mr' })
    expect(filled.at(-1)).toBe('/gitlab-mr ')
    expect(await text(/review-checklist/)).toBe('/frontend-review-checklist')

    await ui.press({ key: 'skills-toggle' })
    await ui.unmount()
  }
})

test('the skills picker shows a short description and scrolls through a window of eight', async ($, on) => {
  givenEngine(on, {
    commands: numberedSkills(number => `Does thing number ${number} with a description far too long for the sidebar row`),
  })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const skillNames = async () =>
    (await ui.findAll({ type: 'Text', text: /^\/skill-/ })).map(element => element.text)

  await ui.press({ key: 'skills-toggle' })
  expect(await skillNames()).toEqual(
    ['01', '02', '03', '04', '05', '06', '07', '08'].map(number => `/skill-${number}`),
  )
  expect(await text(/number 1 /)).toBe(' Does thing number 1 with a…')
  expect(await text(/of 12/)).toBe('1–8 of 12')

  await ui.press({ key: 'skills-down' })
  expect(await skillNames()).toEqual(['05', '06', '07', '08', '09', '10', '11', '12'].map(n => `/skill-${n}`))
  expect(await text(/of 12/)).toBe('5–12 of 12')

  await ui.press({ key: 'skills-up' })
  expect(await text(/of 12/)).toBe('1–8 of 12')

  await ui.input({ key: 'skills-filter', text: 'skill-1', kind: 'change' })
  expect(await skillNames()).toEqual(['/skill-10', '/skill-11', '/skill-12'])
  expect(await text(/of \d+/)).toBeUndefined()
  await ui.unmount()
})

test('the wheel moves the skills window while the picker is open', async ($, on) => {
  givenEngine(on, { commands: numberedSkills(() => 'A skill') })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'skills-toggle' })

  expect(await $.ui.scroll(wheelTick(1))).toEqual({})
  expect((await ui.find({ type: 'Text', text: /of 12/ }))?.text).toBe('2–9 of 12')

  await $.ui.scroll(wheelTick(10))
  expect((await ui.find({ type: 'Text', text: /of 12/ }))?.text).toBe('5–12 of 12')

  await $.ui.scroll(wheelTick(-1))
  expect((await ui.find({ type: 'Text', text: /of 12/ }))?.text).toBe('4–11 of 12')
  await ui.unmount()
})
