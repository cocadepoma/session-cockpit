import { expect, mock, test } from 'claude-code/testing'
import {
  APP,
  HOUR_MS,
  NOW,
  PANE,
  TRANSCRIPTS,
  givenEngine,
  hourlyTranscripts,
  transcriptEntry,
  wheelTick,
} from './fixtures'

const agoCell = (hours: number) => `${`${hours}h`.padStart(3)} `

test('the conversations picker lists other sessions newest first and resumes the one picked', async ($, on) => {
  const { resumed } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

    expect(await text(/Renamed/)).toBeUndefined()

    await ui.press({ key: 'conversations-toggle' })
    expect(await text(/Renamed/)).toBe('Renamed "quoted" title')
    expect(await text(/^ 2h $/)).toBe(' 2h ')
    expect(await text(/Untitled/)).toBe('Untitled')
    expect(await text(/^ 3d $/)).toBe(' 3d ')
    expect(await text(/Draft title/)).toBeUndefined()

    await ui.press({ key: 'conversation:newer' })
    expect(resumed.at(-1)).toBe('newer')

    await ui.press({ key: 'conversations-toggle' })
    await ui.unmount()
  }
})

test('the current conversation is listed first with the header title, in bold and not pressable', async ($, on) => {
  const { resumed } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'conversations-toggle' })

  const [header, current, ...others] = await ui.findAll({
    type: 'Text',
    text: /^(Sidebar for Claude Code|Renamed "quoted" title|Untitled)$/,
  })
  expect(header?.text).toBe('Sidebar for Claude Code')
  expect(current?.text).toBe('Sidebar for Claude Code')
  expect(current?.props.bold).toBe(true)
  expect(others.map(found => found.text)).toEqual(['Renamed "quoted" title', 'Untitled'])
  expect(others.map(found => found.props.bold)).not.toContain(true)
  expect((await ui.find({ key: 'conversation:current' }))?.type).toBe('Box')
  expect(resumed).toEqual([])
  await ui.unmount()
})

test('the current conversation shows the first prompt until the session has a title, then New session when it has neither', async ($, on) => {
  const { world } = givenEngine(on)
  world.sessionId = 'brand-new'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = async (pattern: RegExp) => (await ui.findAll({ type: 'Text', text: pattern })).map(found => found.text)
  await ui.press({ key: 'conversations-toggle' })

  expect(await rows(/^New session$/)).toEqual(['New session', 'New session'])

  await $.prompt.submit({ text: 'Add OAuth login\nwith details', wait: false, origin: { kind: 'composer' } })
  expect(await rows(/^Add OAuth login$/)).toEqual(['Add OAuth login', 'Add OAuth login'])
  expect(await rows(/^New session$/)).toEqual([])
  await ui.unmount()
})

test('the current conversation counts inside the fifty listed', async ($, on) => {
  const many = Array.from({ length: 60 }, (_, index) => transcriptEntry(`many-${index}.jsonl`, NOW - (index + 1) * HOUR_MS))
  givenEngine(on, { transcripts: many })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'conversations-toggle' })
  expect((await ui.find({ type: 'Text', text: /of \d+/ }))?.text).toBe('1–8 of 50')
  await ui.unmount()
})

test('an open conversations picker shows conversations started elsewhere and rereads only the changed titles', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world, titleReads } = givenEngine(on, { usesMockClock: true })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  await ui.press({ key: 'conversations-toggle' })
  expect(await text(/Renamed/)).toBe('Renamed "quoted" title')

  const opened = titleReads.length
  world.transcripts = [...world.transcripts, transcriptEntry('fresh.jsonl', NOW + 60_000)]
  await clock.advance(1_000)
  expect(await text(/another tab/)).toBe('Opened in another tab')
  expect(titleReads.slice(opened)).toEqual([[`${TRANSCRIPTS}/fresh.jsonl`]])

  await clock.advance(1_000)
  expect(titleReads.slice(opened)).toEqual([[`${TRANSCRIPTS}/fresh.jsonl`]])

  world.transcripts = world.transcripts.map(entry =>
    entry.name === 'newer.jsonl' ? transcriptEntry('newer.jsonl', NOW + 120_000) : entry,
  )
  await clock.advance(1_000)
  expect(titleReads.slice(opened)).toEqual([[`${TRANSCRIPTS}/fresh.jsonl`], [`${TRANSCRIPTS}/newer.jsonl`]])

  await ui.press({ key: 'conversations-toggle' })
  const folded = titleReads.length
  world.transcripts = [...world.transcripts, transcriptEntry('later.jsonl', NOW + 180_000)]
  await clock.advance(1_000)
  expect(titleReads.length).toBe(folded)
  await ui.unmount()
})

test('the new mark beside Conversations starts a new conversation, folded or unfolded', async ($, on) => {
  const { cleared } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const before = cleared.length

    await ui.press({ key: 'conversation-new' })
    expect(cleared.length).toBe(before + 1)

    await ui.press({ key: 'conversations-toggle' })
    await ui.press({ key: 'conversation-new' })
    expect(cleared.length).toBe(before + 2)

    await ui.press({ key: 'conversations-toggle' })
    await ui.unmount()
  }
})

test('the conversations picker scrolls through a window of eight, by its arrows and the wheel', async ($, on) => {
  givenEngine(on, { transcripts: hourlyTranscripts })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const ages = async () => (await ui.findAll({ type: 'Text', text: /^ *\d+h $/ })).map(element => element.text)

  await ui.press({ key: 'conversations-toggle' })
  expect(await ages()).toEqual([1, 2, 3, 4, 5, 6, 7].map(agoCell))
  expect(await text(/of 13/)).toBe('1–8 of 13')

  await ui.press({ key: 'conversations-down' })
  expect(await ages()).toEqual([5, 6, 7, 8, 9, 10, 11, 12].map(agoCell))
  expect(await text(/of 13/)).toBe('6–13 of 13')

  await ui.press({ key: 'conversations-up' })
  expect(await text(/of 13/)).toBe('1–8 of 13')

  expect(await $.ui.scroll(wheelTick(1))).toEqual({})
  expect(await text(/of 13/)).toBe('2–9 of 13')

  await ui.press({ key: 'conversations-toggle' })
  await ui.press({ key: 'conversations-toggle' })
  expect(await text(/of 13/)).toBe('1–8 of 13')
  await ui.unmount()
})

test('the conversations filter narrows the list by title and by the shown title of the current one', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const currentRows = async () => (await ui.findAll({ type: 'Text', text: /^Sidebar for Claude Code$/ })).length
  await ui.press({ key: 'conversations-toggle' })
  expect(await currentRows()).toBe(2)

  await ui.input({ key: 'conversations-filter', text: 'QUOTED', kind: 'change' })
  expect(await text(/^Renamed/)).toBe('Renamed "quoted" title')
  expect(await text(/^Untitled$/)).toBeUndefined()
  expect(await currentRows()).toBe(1)

  await ui.input({ key: 'conversations-filter', text: 'sidebar', kind: 'change' })
  expect(await text(/^Renamed/)).toBeUndefined()
  expect(await currentRows()).toBe(2)

  await ui.input({ key: 'conversations-filter', text: '  claude code  ', kind: 'change' })
  expect(await currentRows()).toBe(2)

  await ui.input({ key: 'conversations-filter', text: 'zzz', kind: 'change' })
  expect(await text(/^No conversations match$/)).toBe('No conversations match')

  await ui.input({ key: 'conversations-filter', text: '', kind: 'change' })
  expect(await text(/^Untitled$/)).toBe('Untitled')
  expect(await text(/^No conversations match$/)).toBeUndefined()
  await ui.unmount()
})

test('Enter in the conversations filter resumes the first match that is not the current one, and nothing without a match', async ($, on) => {
  const { resumed } = givenEngine(on)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'conversations-toggle' })

  await ui.input({ key: 'conversations-filter', text: 'sidebar', kind: 'change' })
  await ui.input({ key: 'conversations-filter', text: 'sidebar' })
  await ui.input({ key: 'conversations-filter', text: 'zzz', kind: 'change' })
  await ui.input({ key: 'conversations-filter', text: 'zzz' })
  expect(resumed).toEqual([])

  await ui.input({ key: 'conversations-filter', text: 'quoted', kind: 'change' })
  await ui.input({ key: 'conversations-filter', text: 'quoted' })
  expect(resumed).toEqual(['newer'])
  expect((await ui.find({ type: 'Text', text: /^Renamed/ }))?.text).toBe('Renamed "quoted" title')
  await ui.unmount()
})

test('the conversations scroller and the wheel count the matches, and a filter change returns to the first window', async ($, on) => {
  givenEngine(on, { transcripts: hourlyTranscripts })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  await ui.press({ key: 'conversations-toggle' })

  await ui.input({ key: 'conversations-filter', text: 'batch', kind: 'change' })
  expect(await text(/of \d+/)).toBe('1–8 of 12')
  expect(await $.ui.scroll(wheelTick(1))).toEqual({})
  expect(await text(/of \d+/)).toBe('2–9 of 12')

  await ui.input({ key: 'conversations-filter', text: 'batch 1', kind: 'change' })
  expect(await text(/of \d+/)).toBeUndefined()
  expect(await text(/^Batch 1$/)).toBe('Batch 1')

  await ui.input({ key: 'conversations-filter', text: 'batch', kind: 'change' })
  expect(await text(/of \d+/)).toBe('1–8 of 12')
  await ui.unmount()
})
