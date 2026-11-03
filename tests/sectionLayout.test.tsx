import { expect, test } from 'claude-code/testing'
import { APP, PANE, givenEngine } from './fixtures'

const INDENTED_BODIES = ['context-body', 'usage-body', 'skills-body', 'settings-body', 'help-body']

test('each section indents its content two columns under its title', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.skillsOpen = true
  world.store.settingsOpen = true
  world.store.helpOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const indents = await Promise.all(INDENTED_BODIES.map(async key => (await ui.find({ key }))?.props.paddingLeft))

  expect(indents).toEqual(INDENTED_BODIES.map(() => 2))
  await ui.unmount()
})

test('a usage row with its pace mark still fits a narrow pane once indented, its bar giving back the indent', async ($, on) => {
  const { world } = givenEngine(on)
  world.rateLimits = [{ kind: 'seven_day', percentUsed: 25, resetsAt: '2026-10-26T22:00:00Z' }]
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 30 } })
  const bars = await ui.findAll({ type: 'Text', text: /^━+$/ })
  const filled = bars.findIndex(found => found.props.color === 'permission')
  const row = ['7d', `${bars[filled]?.text ?? ''}${bars[filled + 1]?.text ?? ''}`, '25%', '5d 12h', '▲ 117%']

  expect(await ui.find({ type: 'Text', text: /^▲ 117%$/ })).toBeDefined()
  expect(row.join(' ').length).toBeLessThanOrEqual(30 - 2 - 2)
  await ui.unmount()
})
