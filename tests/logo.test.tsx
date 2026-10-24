import { expect, mock, test } from 'claude-code/testing'

import { LOGO_FILE_ARGUMENT } from '../hooks/lib/commands'
import { NOW, PANE, givenEngine, runSidebar } from './fixtures'

test('the wordmark tops the sidebar and hides when the pane is too narrow for it', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const wide = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await wide.find({ type: 'Text', text: /^█▀▀ ▀█▀/ }))?.props.color).toBe('claude')
  expect((await wide.find({ type: 'Text', text: /^█▀▄ ▄▀▄ █▀▄$/ }))?.props.color).toBe('permission')
  await wide.unmount()

  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 20 }, surface: 'terminal' })
  expect(await narrow.find({ type: 'Text', text: /^█▀▀ ▀█▀/ })).toBeUndefined()
  expect((await narrow.find({ type: 'Text', text: /Sidebar for/ }))?.text).toBe('Sidebar for Claude Code')
  await narrow.unmount()
})

const LOGO_TOP = /^█▀▀ ▀█▀/

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the logo is drawn by default on ${surface}, with no toggle under it`, async ($, on) => {
    givenEngine(on)
    await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: LOGO_TOP })).toBeDefined()
    expect(await ui.find({ key: 'banner-toggle' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /hide logo|show logo/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`showLogo set to false hides the logo completely on ${surface}, header and footer stay`, { options: { showLogo: false } }, async ($, on) => {
    givenEngine(on)
    await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: LOGO_TOP })).toBeUndefined()
    expect(await ui.find({ key: 'banner:0' })).toBeUndefined()
    expect(await ui.find({ key: 'banner-toggle' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^◇$|^◆$/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /Sidebar for/ }))?.text).toBe('Sidebar for Claude Code')
    expect((await ui.find({ type: 'Text', text: /^Claude Code$/ }))?.text).toBe('Claude Code')
    await ui.unmount()
  })
}

test('the old banner flag is deleted from the store when a session starts', async ($, on) => {
  const { world } = givenEngine(on)
  world.store = { banner: false, helpOpen: true }

  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect('banner' in world.store).toBe(false)
  expect(world.store.helpOpen).toBe(true)
})

test('a stored banner flag no longer hides the logo', async ($, on) => {
  const { world } = givenEngine(on)
  world.store = { banner: false }
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: LOGO_TOP })).toBeDefined()
  await ui.unmount()
})

const runLogo = (args: string) => ({ ...runSidebar, command: 'logo', args })
const ART = '\n  /\\_/\\\n ( o.o )\n  > ^ <  \n'

test('/logo is registered to run mid-turn', async ($, on) => {
  const { registered } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect(registered.find(command => command.name === 'logo')?.immediate).toBe(true)
})

test('/logo draws the pasted art in place of the default, keeping its leading spaces, and stores it for every session', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo(ART))).text).toBe('Logo saved: 3 lines, 7 columns wide.')
  expect(world.store.logo).toBe(' /\\_/\\\n( o.o )\n > ^ <')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: LOGO_TOP })).toBeUndefined()
  const lines = await ui.findAll({ type: 'Text', text: /\/\\_\/\\|o\.o|> \^ </ })
  expect(lines.map(line => line.text)).toEqual([' /\\_/\\', '( o.o )', ' > ^ <'])
  expect(lines.map(line => line.props.color)).toEqual(['claude', 'claude', 'claude'])
  await ui.unmount()
})

test('a stored logo is drawn when a session starts, and hides when the pane is narrower than its widest line', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.logo = 'x'.repeat(30)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const wide = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await wide.find({ type: 'Text', text: /^x{30}$/ })).toBeDefined()
  await wide.unmount()

  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 31 }, surface: 'terminal' })
  expect(await narrow.find({ type: 'Text', text: /^x{30}$/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: LOGO_TOP })).toBeUndefined()
  await narrow.unmount()
})

test('a blank line inside the art keeps its row', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  await $.command.run(runLogo('top\n\nbottom'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await ui.findAll({ type: 'Text', text: /^(top| |bottom)$/ })
  expect(rows.map(row => row.text)).toEqual(['top', ' ', 'bottom'])
  await ui.unmount()
})

test('bare /logo restores the default logo and forgets the stored art', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.logo = 'mine'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo('  \n '))).text).toBe('Logo reset to the default.')
  expect('logo' in world.store).toBe(false)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: LOGO_TOP })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^mine$/ })).toBeUndefined()
  await ui.unmount()
})

test('/logo refuses art taller than 40 lines and keeps the current logo', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.logo = 'mine'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const tall = Array.from({ length: 41 }, (_, row) => `row ${row}`).join('\n')
  expect((await $.command.run(runLogo(tall))).text).toBe('Logo not saved: it has 41 lines, at most 40 fit.')
  expect(world.store.logo).toBe('mine')
})

test('a logo saved in another session shows here on the next watch', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: LOGO_TOP })).toBeDefined()

  world.store.logo = 'from elsewhere'
  await clock.advance(1_000)

  expect(await ui.find({ type: 'Text', text: /^from elsewhere$/ })).toBeDefined()
  await ui.unmount()
})

test('a stored logo that is not text is ignored', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.logo = 42
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: LOGO_TOP })).toBeDefined()
  await ui.unmount()
})

const ESC = '\u001b'
const PASTED_ANSI = '[31mRED[0m [38;5;208mORANGE[0m\n[38;2;0;200;255mCYAN[0m [1;42mBOLD[0m'

type TextFinder = { find: (query: { type: 'Text'; text: RegExp }) => Promise<{ props: Record<string, unknown> } | undefined> }

const segment = async (ui: TextFinder, text: string) =>
  (await ui.find({ type: 'Text', text: new RegExp(`^${text}$`) }))?.props

test('pasted ANSI codes that lost their ESC colour the logo, and the width ignores them', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo(PASTED_ANSI))).text).toBe('Logo saved: 2 lines, 10 columns wide.')
  expect(world.store.logo).toBe(PASTED_ANSI)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\[\d/ })).toBeUndefined()
  expect((await segment(ui, 'RED'))?.color).toBe('#cd0000')
  expect((await segment(ui, 'ORANGE'))?.color).toBe('#ff8700')
  expect((await segment(ui, 'CYAN'))?.color).toBe('#00c8ff')
  const bold = await segment(ui, 'BOLD')
  expect(bold?.bold).toBe(true)
  expect(bold?.backgroundColor).toBe('#00cd00')
  expect((await segment(ui, ' '))?.color).toBe('text')
  await ui.unmount()
})

test('ANSI codes that keep their ESC colour the logo the same way', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  await $.command.run(runLogo(`${ESC}[94mBLUE${ESC}[0m plain`))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await segment(ui, 'BLUE'))?.color).toBe('#5c5cff')
  expect((await segment(ui, ' plain'))?.color).toBe('text')
  await ui.unmount()
})

test('an ANSI style carries over to the next line until it is reset', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  await $.command.run(runLogo('[32;4mtop\nmiddle[24;39m\nbottom'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await segment(ui, 'top')).toMatchObject({ color: '#00cd00', underline: true })
  expect(await segment(ui, 'middle')).toMatchObject({ color: '#00cd00', underline: true })
  const bottom = await segment(ui, 'bottom')
  expect(bottom?.color).toBe('text')
  expect(bottom?.underline).toBeUndefined()
  await ui.unmount()
})

test('the 256-colour greys, the background resets and unknown codes are read as an xterm would', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  await $.command.run(runLogo('[48;5;244;5mgrey[49;38;5;300mkept[2;3;7;9mstyled[22;23;27;29;0mreset'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await segment(ui, 'grey')).toMatchObject({ backgroundColor: '#808080', color: 'text' })
  const kept = await segment(ui, 'kept')
  expect(kept?.backgroundColor).toBeUndefined()
  expect(kept?.color).toBe('text')
  expect(await segment(ui, 'styled')).toMatchObject({ dimColor: true, italic: true, inverse: true, strikethrough: true })
  const reset = await segment(ui, 'reset')
  expect(reset?.dimColor).toBeUndefined()
  expect(reset?.inverse).toBeUndefined()
  await ui.unmount()
})

test('/logo with a single line says line, not lines', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo('mine'))).text).toBe('Logo saved: 1 line, 4 columns wide.')
})

const LOGO_FILE = '/home/dev/.claude/session-cockpit/logo.ans'

test('/logo file loads the default file, saves it for every session and draws it in colour', async ($, on) => {
  const { world } = givenEngine(on)
  world.files[LOGO_FILE] = `${ESC}[38;2;255;128;0m /\\_/\\${ESC}[0m\n( o.o )`
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo(`${LOGO_FILE_ARGUMENT}`))).text).toBe('Logo saved: 2 lines, 7 columns wide.')
  expect(world.read).toContain(LOGO_FILE)
  expect(world.store.logo).toBe(`${ESC}[38;2;255;128;0m /\\_/\\${ESC}[0m\n( o.o )`)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const top = await ui.find({ type: 'Text', text: /\/\\_\/\\/ })
  expect(top?.props.color).toBe('#ff8000')
  await ui.unmount()
})

test('/logo file with a path reads that file, expanding a leading ~', async ($, on) => {
  const { world } = givenEngine(on)
  world.files['/home/dev/art/cat.ans'] = ART
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo(`${LOGO_FILE_ARGUMENT} ~/art/cat.ans`))).text).toBe('Logo saved: 3 lines, 7 columns wide.')
  expect(world.read).toContain('/home/dev/art/cat.ans')
})

test('/logo file says what it could not read and keeps the current logo', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.logo = 'mine'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo(`${LOGO_FILE_ARGUMENT} /tmp/none.ans`))).text).toBe(
    'Logo not loaded: cannot read /tmp/none.ans.',
  )
  expect(world.store.logo).toBe('mine')
})

test('/logo file refuses a file with cursor moves or clears, and an empty file', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.logo = 'mine'
  world.files[LOGO_FILE] = `top${ESC}[2Kbottom`
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo(LOGO_FILE_ARGUMENT))).text).toBe(
    `Logo not loaded: ${LOGO_FILE} has escape codes other than colours.`,
  )
  world.files[LOGO_FILE] = '\n  \n'
  expect((await $.command.run(runLogo(LOGO_FILE_ARGUMENT))).text).toBe(`Logo not loaded: ${LOGO_FILE} is empty.`)
  expect(world.store.logo).toBe('mine')
})

test('/logo file refuses a file taller than 40 lines', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.logo = 'mine'
  world.files[LOGO_FILE] = Array.from({ length: 41 }, (_, row) => `row ${row}`).join('\n')
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runLogo(LOGO_FILE_ARGUMENT))).text).toBe('Logo not loaded: it has 41 lines, at most 40 fit.')
  expect(world.store.logo).toBe('mine')
})
