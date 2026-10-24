import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { APP, PANE, SETTINGS_PLUGIN, givenEngine, givenTenFilesWithEmptyNotes, registerSession, wheelTick } from './fixtures'

const SECTIONS = [
  ['showLogo', /^█▀▀ ▀█▀/],
  ['showKeepAwake', /^○ Keep awake$/],
  ['showContext', /^Context$/],
  ['showUsage', /^Usage$/],
  ['showSkills', /^Skills$/],
  ['showSessions', /^Sessions$/],
  ['showConversations', /^Conversations$/],
  ['showNotes', /^Notes$/],
  ['showFiles', /^Files$/],
  ['showMcp', /^MCP$/],
  ['showTodos', /^Todo$/],
  ['showHelp', /^Help$/],
] as const

const ROWS = [
  ['showLogo', 'Logo'],
  ['showKeepAwake', 'Keep awake'],
  ['showContext', 'Context'],
  ['showUsage', 'Usage'],
  ['showSkills', 'Skills'],
  ['showSessions', 'Sessions'],
  ['showConversations', 'Conversations'],
  ['showNotes', 'Notes'],
  ['showFiles', 'Files'],
  ['showMcp', 'MCP'],
  ['showActivity', 'Activity'],
  ['showTodos', 'Todos'],
  ['showHelp', 'Help'],
] as const

const mountWithSections = async ($: Parameters<TestBody>[0], on: On) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Wire it', status: 'pending', activeForm: 'Wiring it' }] })

  return $.ui.mount({ ...PANE, surface: 'terminal' })
}

test('every section shows by default', async ($, on) => {
  const ui = await mountWithSections($, on)

  for (const [, marker] of SECTIONS) {
    expect((await ui.find({ type: 'Text', text: marker }))?.text, String(marker)).toBeDefined()
  }
  await ui.unmount()
})

test('there is no Activity section by default, even after a tool call', async ($, on) => {
  const ui = await mountWithSections($, on)
  await $.tool.call({ tool: 'Bash', command: 'true' })

  expect(await ui.find({ type: 'Text', text: /^Activity/ })).toBeUndefined()
  await ui.unmount()
})

for (const [option, marker] of SECTIONS) {
  test(`${option} set to false removes that section and no other`, { options: { [option]: false } }, async ($, on) => {
    const ui = await mountWithSections($, on)

    expect(await ui.find({ type: 'Text', text: marker })).toBeUndefined()
    for (const [, other] of SECTIONS.filter(([name]) => name !== option)) {
      expect((await ui.find({ type: 'Text', text: other }))?.text, String(other)).toBeDefined()
    }
    expect((await ui.find({ type: 'Text', text: /Sidebar for Claude Code/ }))?.text).toBe('Sidebar for Claude Code')
    await ui.unmount()
  })
}

test('a hidden list leaves the wheel to the next list and to the engine', { options: { showFiles: false } }, async ($, on) => {
  const reached: number[] = []
  on('ui.scroll', (_, e) => {
    reached.push(e.by)

    return {}
  })
  await givenTenFilesWithEmptyNotes($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.scroll(wheelTick(3))

  expect(reached).toEqual([3])
  await ui.unmount()
})

const contextColor = async ($: Parameters<TestBody>[0], on: On, percent: number) => {
  const { world } = givenEngine(on)
  world.percent = percent
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const color = (await ui.find({ type: 'Text', text: new RegExp(`^${percent}%$`) }))?.props.color
  await ui.unmount()

  return color
}

test('the context bar colour follows the default 70 and 85', async ($, on) => {
  expect(await contextColor($, on, 69)).toBe('success')
})

test('the default warning starts at 70', async ($, on) => {
  expect(await contextColor($, on, 70)).toBe('warning')
})

test('the default critical starts at 85', async ($, on) => {
  expect(await contextColor($, on, 85)).toBe('error')
})

test('the thresholds from the options drive the colour', { options: { contextWarning: 50, contextCritical: 60 } }, async ($, on) => {
  expect(await contextColor($, on, 55)).toBe('warning')
})

test('a critical threshold from the options turns the bar red', { options: { contextWarning: 50, contextCritical: 60 } }, async ($, on) => {
  expect(await contextColor($, on, 60)).toBe('error')
})

test('a warning at or above the critical falls back to 70 and 85', { options: { contextWarning: 90, contextCritical: 60 } }, async ($, on) => {
  expect(await contextColor($, on, 72)).toBe('warning')
})

test('a threshold outside 1 to 100 falls back to 70 and 85', { options: { contextWarning: 0, contextCritical: 40 } }, async ($, on) => {
  expect(await contextColor($, on, 30)).toBe('success')
})

const statusesFor = (hidden: string[] = []) =>
  ROWS.map(([name]) => (hidden.includes(name) || name === 'showActivity' ? ' hidden' : ' shown'))

const SETTING_IDS = ['logo', 'keepAwake', 'context', 'usage', 'skills', 'sessions', 'conversations', 'notes', 'files', 'mcp', 'activity', 'todos', 'help']

type DrawnNode = { props?: { key?: string }; children?: unknown[] }

const settingKeys = (node: unknown): string[] => {
  const { props, children = [] } = node as DrawnNode
  const own = props?.key?.startsWith('setting:') ? [props.key] : []

  return [
    ...own,
    ...children.flatMap(child => (typeof child === 'object' && child !== null ? settingKeys(child) : [])),
  ]
}

const mountSettings = async ($: Parameters<TestBody>[0], on: On, surface: 'terminal' | 'desktop') => {
  const given = givenEngine(on)
  given.world.store.settingsOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  return { ...given, ui: await $.ui.mount({ ...PANE, surface }) }
}

test('the Settings section is folded by default and lists no row', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^Settings$/ }))?.text).toBe('Settings')
  expect(await ui.find({ key: 'setting:logo' })).toBeUndefined()

  await ui.press({ key: 'settings-toggle' })
  expect(world.store.settingsOpen).toBe(true)
  expect(await ui.find({ key: 'setting:logo' })).toBeDefined()
  await ui.unmount()
})

test('Activity is drawn right below MCP and above Todo when showActivity is true', { options: { showActivity: true } }, async ($, on) => {
  const ui = await mountWithSections($, on)
  await $.tool.call({ tool: 'Bash', command: 'true' })

  const titles = (await ui.findAll({ type: 'Text', text: /^(MCP|Activity \(\d+ running\)|Todo)$/ })).map(found => found.text)

  expect(titles).toEqual(['MCP', 'Activity (0 running)', 'Todo'])
  await ui.unmount()
})

test('the Settings section comes after Help', async ($, on) => {
  const ui = await mountWithSections($, on)

  const titles = (await ui.findAll({ type: 'Text', text: /^(Help|Settings)$/ })).map(found => found.text)

  expect(titles).toEqual(['Help', 'Settings'])
  await ui.unmount()
})

test('the Settings section stays when every other section is hidden', {
  options: Object.fromEntries(ROWS.map(([option]) => [option, false])),
}, async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^Settings$/ }))?.text).toBe('Settings')
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`open, Settings lists every part in pane order as shown on ${surface}`, async ($, on) => {
    const { ui } = await mountSettings($, on, surface)

    expect(settingKeys(await ui.drawn())).toEqual(SETTING_IDS.map(id => `setting:${id}`))
    for (const [, label] of ROWS) {
      expect((await ui.find({ type: 'Text', text: new RegExp(`^${label}$`) }))?.text, label).toBe(label)
    }
    const statuses = await ui.findAll({ type: 'Text', text: /^ (shown|hidden)$/ })
    expect(statuses.map(status => status.text)).toEqual(statusesFor())
    expect(statuses.map(status => status.props.color)).toEqual(statusesFor().map(status => (status === ' shown' ? 'success' : 'inactive')))
    await ui.unmount()
  })
}

for (const [option, label] of ROWS) {
  test(`${option} set to false reads hidden in the Settings row ${label} and no other`, { options: { [option]: false } }, async ($, on) => {
    const { ui } = await mountSettings($, on, 'terminal')

    const statuses = await ui.findAll({ type: 'Text', text: /^ (shown|hidden)$/ })
    const expected = statusesFor([option])
    expect(statuses.map(status => status.text)).toEqual(expected)
    expect(statuses.map(status => status.props.color)).toEqual(expected.map(status => (status === ' shown' ? 'success' : 'inactive')))
    await ui.unmount()
  })

  test(`pressing the ${label} row sets ${option} through the plugin's own config row, flipped`, async ($, on) => {
    const { ui, world, toasts } = await mountSettings($, on, 'terminal')

    await ui.press({ key: `setting:${SETTING_IDS[ROWS.findIndex(([name]) => name === option)]}` })

    expect(world.config.sets).toEqual([{ key: `${SETTINGS_PLUGIN}.${option}`, value: option === 'showActivity' }])
    expect(toasts).toEqual([])
    await ui.unmount()
  })

  test(`pressing the ${label} row while ${option} is false asks for true`, { options: { [option]: false } }, async ($, on) => {
    const { ui, world } = await mountSettings($, on, 'terminal')

    await ui.press({ key: `setting:${SETTING_IDS[ROWS.findIndex(([name]) => name === option)]}` })

    expect(world.config.sets).toEqual([{ key: `${SETTINGS_PLUGIN}.${option}`, value: true }])
    await ui.unmount()
  })
}

test('a deny from the config change shows a toast naming the setting and leaves the row as it was', async ($, on) => {
  const { ui, world, toasts } = await mountSettings($, on, 'terminal')
  world.config.outcome = 'deny'

  await ui.press({ key: 'setting:skills' })

  expect(toasts).toEqual(['Could not change Skills: a policy owns it'])
  expect((await ui.findAll({ type: 'Text', text: /^ (shown|hidden)$/ })).map(status => status.text)).toEqual(statusesFor())
  await ui.unmount()
})

test('a rejection from the config change shows a toast and never throws out of the press', async ($, on) => {
  const { ui, world, toasts } = await mountSettings($, on, 'terminal')
  world.config.outcome = 'reject'

  await ui.press({ key: 'setting:mcp' })

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^Could not change MCP: /)
  expect(world.config.sets).toHaveLength(1)
  await ui.unmount()
})

test('a plugin with no config row for the field shows a toast and changes nothing', async ($, on) => {
  const { ui, world, toasts } = await mountSettings($, on, 'terminal')
  world.config.hasPluginRows = false

  await ui.press({ key: 'setting:logo' })

  expect(toasts).toEqual(['Could not change Logo: no showLogo setting'])
  expect(world.config.sets).toEqual([])
  await ui.unmount()
})

test('the wheel skips the Settings section, open or not', async ($, on) => {
  const reached: number[] = []
  on('ui.scroll', (_, e) => {
    reached.push(e.by)

    return {}
  })
  const { ui } = await mountSettings($, on, 'terminal')
  await $.ui.scroll(wheelTick(3))

  expect(reached).toEqual([3])
  await ui.unmount()
})
