import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { APP, NOW, PANE, dockerContainer, dockerImage, givenEngine } from './fixtures'

const SHOWN = { options: { showDocker: true } }

const POSTGRES = '1622725f7f74'
const MAILPIT = 'b9839b50e0f3'
const WEB = 'a1b2c3d4e5f6'

const dockerCalls = (ran: string[][]) => ran.filter(argv => argv[0] === 'docker').map(argv => argv[1])

const listedContainers = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^api-/ })).map(found => found.text)

const givenDocker = async ($: Parameters<TestBody>[0], on: On, { isOpen = true, usesMockClock = false } = {}) => {
  const clock = usesMockClock ? mock.clock(on, { now: NOW }) : null
  const engine = givenEngine(on, { usesMockClock })
  engine.world.isPaneOpen = true
  if (isOpen) engine.world.store.dockerOpen = true
  engine.world.docker.containers = [
    dockerContainer(POSTGRES, 'api-postgres-1', 'exited'),
    dockerContainer(MAILPIT, 'api-mailpit-1', 'running', 'axllent/mailpit:v1.31.4'),
  ]
  engine.world.docker.images = [
    dockerImage('47928bf67eb6', 'nginx', '1.30-alpine', '93.1MB'),
    dockerImage('47928bf67eb6', 'nginx', 'stable-alpine', '93.1MB'),
    dockerImage('0123456789ab', '<none>', '<none>', '12MB'),
  ]
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  return { ...engine, clock }
}

test('the Docker section is off by default and never runs docker', async ($, on) => {
  const { world } = await givenDocker($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /^Docker$/ })).toBeUndefined()
  expect(dockerCalls(world.ran)).toEqual([])
  await ui.unmount()
})

test('folded, Docker shows its title and runs no docker command', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { isOpen: false })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^Docker$/ }))?.text).toBe('Docker')
  expect(await listedContainers(ui)).toEqual([])
  expect(dockerCalls(world.ran)).toEqual([])
  await ui.unmount()
})

test('opening Docker lists the containers, running first, with their state and the running count', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { isOpen: false, usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'docker-toggle' })

  expect(world.store.dockerOpen).toBe(true)
  expect(dockerCalls(world.ran)).toEqual(['ps', 'images'])
  expect(world.ran.find(argv => argv[1] === 'ps')).toEqual([
    'docker',
    'ps',
    '--all',
    '--format',
    '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}',
  ])
  expect(await listedContainers(ui)).toEqual(['api-mailpit-1', 'api-postgres-1'])
  expect((await ui.find({ type: 'Text', text: /^ \(\d+\/\d+ running\)$/ }))?.text).toBe(' (1/2 running)')
  expect((await ui.findAll({ type: 'Text', text: /^(running|exited)$/ })).map(found => found.text)).toEqual([
    'running',
    'exited',
  ])
  await ui.unmount()
})

test('the Images tab lists each image reference with its size, and a dangling image by its ID', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'docker-tab:images' })

  expect(await listedContainers(ui)).toEqual([])
  expect((await ui.findAll({ type: 'Text', text: /^(nginx:|0123456789ab)/ })).map(found => found.text)).toEqual([
    'nginx:1.30-alpine',
    'nginx:stable-alpine',
    '0123456789ab',
  ])
  expect((await ui.findAll({ type: 'Text', text: /^\d+(\.\d+)?MB$/ })).map(found => found.text)).toEqual([
    '93.1MB',
    '93.1MB',
    '12MB',
  ])

  await ui.press({ key: 'docker-tab:containers' })
  expect(await listedContainers(ui)).toEqual(['api-mailpit-1', 'api-postgres-1'])
  await ui.unmount()
})

test('the filter narrows the containers by name or image', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.input({ key: 'docker-filter', text: 'mailpit', kind: 'change' })
  expect(await listedContainers(ui)).toEqual(['api-mailpit-1'])

  await ui.input({ key: 'docker-filter', text: 'postgres:18', kind: 'change' })
  expect(await listedContainers(ui)).toEqual(['api-postgres-1'])

  await ui.input({ key: 'docker-filter', text: 'zzz', kind: 'change' })
  expect((await ui.find({ type: 'Text', text: /^No containers match$/ }))?.text).toBe('No containers match')
  await ui.unmount()
})

test('no containers reads as such', SHOWN, async ($, on) => {
  const { world } = givenEngine(on)
  world.isPaneOpen = true
  world.store.dockerOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^No containers$/ }))?.text).toBe('No containers')
  await ui.unmount()
})

test('a long container name is cut to the row', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on)
  world.docker.containers = [dockerContainer(WEB, `api-${'x'.repeat(80)}`, 'running')]
  await $.tool.call({ tool: 'Bash', command: 'true' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const [name] = await listedContainers(ui)

  expect(name?.endsWith('…')).toBe(true)
  expect((name?.length ?? 0) + ' running'.length + 2).toBeLessThanOrEqual(PANE.props.bodyColumns - 2)
  await ui.unmount()
})

test('a stopped Docker daemon says Docker is not running instead of an empty list', SHOWN, async ($, on) => {
  const { world } = givenEngine(on)
  world.isPaneOpen = true
  world.store.dockerOpen = true
  world.docker.failure = {
    exitCode: 1,
    stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n',
  }
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^Docker is not running$/ }))?.text).toBe('Docker is not running')
  expect(await ui.find({ key: 'docker-tab:images' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^No containers$/ })).toBeUndefined()
  await ui.unmount()
})

test('a missing docker command says the Docker CLI was not found', SHOWN, async ($, on) => {
  const { world } = givenEngine(on)
  world.isPaneOpen = true
  world.store.dockerOpen = true
  world.docker.failure = 'missing'
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^Docker CLI not found$/ }))?.text).toBe('Docker CLI not found')
  await ui.unmount()
})

test('any other docker failure shows the first line docker wrote, cut to the row', SHOWN, async ($, on) => {
  const { world } = givenEngine(on)
  world.isPaneOpen = true
  world.store.dockerOpen = true
  world.docker.failure = {
    exitCode: 1,
    stderr: '\npermission denied while trying to connect to the docker API at unix:///var/run/docker.sock\nmore\n',
  }
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const notice = (await ui.find({ type: 'Text', text: /^permission denied/ }))?.text

  expect(notice?.endsWith('…')).toBe(true)
  expect(notice?.length).toBe(PANE.props.bodyColumns - 2)
  await ui.unmount()
})

test('Docker recovers when the daemon comes back', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on)
  world.docker.failure = { exitCode: 1, stderr: 'Cannot connect to the Docker daemon at unix:///x. Is the docker daemon running?' }
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Docker is not running$/ }))?.text).toBe('Docker is not running')

  world.docker.failure = null
  await $.tool.call({ tool: 'Bash', command: 'docker compose up -d' })

  expect(await ui.find({ type: 'Text', text: /^Docker is not running$/ })).toBeUndefined()
  expect(await listedContainers(ui)).toEqual(['api-mailpit-1', 'api-postgres-1'])
  await ui.unmount()
})

test('a Bash call refreshes Docker while the section is open, and not while it is folded', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  world.docker.containers = [dockerContainer(WEB, 'api-web-1', 'running')]

  await $.tool.call({ tool: 'Bash', command: 'docker compose up -d web' })
  expect(await listedContainers(ui)).toEqual(['api-web-1'])

  await ui.press({ key: 'docker-toggle' })
  world.ran.length = 0
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(dockerCalls(world.ran)).toEqual([])
  await ui.unmount()
})

test('while open and shown, Docker polls every five seconds', SHOWN, async ($, on) => {
  const { world, clock } = await givenDocker($, on, { usesMockClock: true })
  world.ran.length = 0

  await clock?.advance(5_000)

  expect(dockerCalls(world.ran)).toEqual(['ps', 'images'])
})

test('folded, or with the sidebar closed, Docker does not poll', SHOWN, async ($, on) => {
  const { world, clock } = await givenDocker($, on, { isOpen: false, usesMockClock: true })
  world.ran.length = 0
  await clock?.advance(10_000)
  expect(dockerCalls(world.ran)).toEqual([])

  world.isPaneOpen = false
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'docker-toggle' })
  world.ran.length = 0
  await clock?.advance(10_000)
  expect(dockerCalls(world.ran)).toEqual([])
  await ui.unmount()
})

test('more than eight containers scroll in windows of eight', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on)
  world.docker.containers = Array.from({ length: 10 }, (_, index) =>
    dockerContainer(`0000000000${String(index).padStart(2, '0')}`, `api-${index + 1}`, 'exited'),
  )
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await listedContainers(ui)).toHaveLength(8)
  expect((await ui.find({ type: 'Text', text: /^1–8 of 10$/ }))?.text).toBe('1–8 of 10')

  await ui.press({ key: 'docker-down' })
  expect(await listedContainers(ui)).toEqual(['api-3', 'api-4', 'api-5', 'api-6', 'api-7', 'api-8', 'api-9', 'api-10'])
  await ui.unmount()
})
