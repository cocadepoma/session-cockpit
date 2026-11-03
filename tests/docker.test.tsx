import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { APP, NOW, PANE, dockerContainer, dockerImage, dockerVolume, givenEngine, holdDocker } from './fixtures'

const SHOWN = { options: { showDocker: true } }
const SECTION_INDENT = 2

const POSTGRES = '1622725f7f74'
const MAILPIT = 'b9839b50e0f3'
const WEB = 'a1b2c3d4e5f6'

const dockerCalls = (ran: string[][]) => ran.filter(argv => argv[0] === 'docker').map(argv => argv[1])

const READS = ['ps', 'images', 'volume', 'volume']

const listedVolumes = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^(pgdata|mailpit_data|build_cache)/ })).map(found => found.text)

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
  engine.world.docker.volumes = [dockerVolume('build_cache'), dockerVolume('mailpit_data'), dockerVolume('pgdata')]
  engine.world.docker.danglingVolumes = ['build_cache']
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
  expect(dockerCalls(world.ran)).toEqual(READS)
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

test('the Volumes tab lists each volume by name, in use or unused', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Volumes/ }))?.text).toBe('Volumes 3')

  await ui.press({ key: 'docker-tab:volumes' })

  expect(await listedContainers(ui)).toEqual([])
  expect(await listedVolumes(ui)).toEqual(['build_cache', 'mailpit_data', 'pgdata'])
  expect((await ui.findAll({ type: 'Text', text: /^(in use|unused)$/ })).map(found => [found.text, found.props.color])).toEqual([
    ['unused', 'inactive'],
    ['in use', 'inactive'],
    ['in use', 'inactive'],
  ])
  expect((await ui.find({ type: 'Text', text: /^(Containers|Images|Volumes) \d+$/ }))?.props.color).toBe('inactive')

  await ui.press({ key: 'docker-tab:containers' })
  expect(await listedContainers(ui)).toEqual(['api-mailpit-1', 'api-postgres-1'])
  await ui.unmount()
})

test('opening Docker reads the volumes, and which of them no container uses, with the containers and images', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { isOpen: false, usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'docker-toggle' })

  expect(dockerCalls(world.ran)).toEqual(READS)
  expect(world.ran.filter(argv => argv[1] === 'volume')).toEqual([
    ['docker', 'volume', 'ls', '--format', '{{.Name}}\t{{.Driver}}'],
    ['docker', 'volume', 'ls', '--filter', 'dangling=true', '--format', '{{.Name}}'],
  ])
  await ui.unmount()
})

test('the filter narrows the volumes by name', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'docker-tab:volumes' })

  await ui.input({ key: 'docker-filter', text: 'data', kind: 'change' })
  expect(await listedVolumes(ui)).toEqual(['mailpit_data', 'pgdata'])

  await ui.input({ key: 'docker-filter', text: 'zzz', kind: 'change' })
  expect((await ui.find({ type: 'Text', text: /^No volumes match$/ }))?.text).toBe('No volumes match')
  await ui.unmount()
})

test('no volumes reads as such', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on)
  world.docker.volumes = []
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'docker-tab:volumes' })

  expect((await ui.find({ type: 'Text', text: /^No volumes$/ }))?.text).toBe('No volumes')
  await ui.unmount()
})

test('a failing docker volume ls shows its reason in the Volumes tab and leaves the containers listed', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on)
  world.docker.volumesFailure = { exitCode: 1, stderr: 'permission denied while listing volumes\n' }
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await listedContainers(ui)).toEqual(['api-mailpit-1', 'api-postgres-1'])
  expect((await ui.find({ type: 'Text', text: /^Volumes/ }))?.text).toBe('Volumes')

  await ui.press({ key: 'docker-tab:volumes' })
  expect((await ui.find({ type: 'Text', text: /^permission denied/ }))?.text).toBe('permission denied while listing vol…')
  expect(await ui.find({ type: 'Text', text: /^No volumes$/ })).toBeUndefined()
  await ui.unmount()
})

test('the three tabs stay on one row in a narrow pane, dropping their counts when they do not fit', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const tabsAt = async (bodyColumns: number) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns } })
    const labels = (await ui.findAll({ type: 'Text', text: /^(Containers|Images|Volumes)/ })).map(found => found.text ?? '')
    const gap = Number((await ui.find({ key: 'docker-tabs' }))?.props.gap)
    await ui.unmount()

    return { labels, width: labels.join('').length + gap * (labels.length - 1) }
  }

  const wide = await tabsAt(40)
  expect(wide.labels).toEqual(['Containers 2', 'Images 3', 'Volumes 3'])
  expect(wide.width).toBeLessThanOrEqual(40 - 2 - SECTION_INDENT)

  const narrow = await tabsAt(30)
  expect(narrow.labels).toEqual(['Containers', 'Images', 'Volumes'])
  expect(narrow.width).toBeLessThanOrEqual(30 - 2 - SECTION_INDENT)
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
  expect((name?.length ?? 0) + ' running'.length + 2).toBeLessThanOrEqual(PANE.props.bodyColumns - 2 - SECTION_INDENT)
  await ui.unmount()
})

test('the Docker list is indented two columns under its title', SHOWN, async ($, on) => {
  await givenDocker($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ key: 'docker-body' }))?.props.paddingLeft).toBe(SECTION_INDENT)
  await ui.unmount()
})

test('the active tab takes the active color and the other tab stays inactive', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const tabColors = async () =>
    (await ui.findAll({ type: 'Text', text: /^(Containers|Images) \d+$/ })).map(found => found.props.color)

  expect(await tabColors()).toEqual(['claude', 'inactive'])

  await ui.press({ key: 'docker-tab:images' })
  expect(await tabColors()).toEqual(['inactive', 'claude'])
  await ui.unmount()
})

test('the selected container is marked with › and the active color, and the others are not', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const labelColors = async () =>
    (await ui.findAll({ type: 'Text', text: /^api-/ })).map(found => [found.text, found.props.color])
  expect(await ui.findAll({ type: 'Text', text: /^›$/ })).toEqual([])

  await ui.press({ key: `docker-container:${POSTGRES}` })

  expect(await labelColors()).toEqual([
    ['api-mailpit-1', undefined],
    ['api-postgres-1', 'claude'],
  ])
  const marks = await ui.findAll({ type: 'Text', text: /^›$/ })
  expect(marks.map(found => found.props.color)).toEqual(['claude'])

  await ui.press({ key: `docker-container:${POSTGRES}` })
  expect(await labelColors()).toEqual([
    ['api-mailpit-1', undefined],
    ['api-postgres-1', undefined],
  ])
  expect(await ui.findAll({ type: 'Text', text: /^›$/ })).toEqual([])
  await ui.unmount()
})

test('the selected image is marked with › and the active color', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'docker-tab:images' })

  await ui.press({ key: 'docker-image:47928bf67eb6/nginx:stable-alpine' })

  const labels = await ui.findAll({ type: 'Text', text: /^nginx:/ })
  expect(labels.map(found => [found.text, found.props.color])).toEqual([
    ['nginx:1.30-alpine', undefined],
    ['nginx:stable-alpine', 'claude'],
  ])
  expect((await ui.findAll({ type: 'Text', text: /^›$/ })).length).toBe(1)
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
  expect(notice?.length).toBe(PANE.props.bodyColumns - 2 - SECTION_INDENT)
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

  expect(dockerCalls(world.ran)).toEqual(READS)
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

const actionCalls = (ran: string[][]) =>
  ran
    .filter(argv => argv[0] === 'docker' && !['ps', 'images'].includes(argv[1] ?? '') && !(argv[1] === 'volume' && argv[2] === 'ls'))
    .map(argv => argv.slice(1))

const actionLabels = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^(Restart|Stop|Start|Delete|Confirm delete)$/ })).map(found => found.text)

test('pressing a running container offers Restart and Stop, a stopped one Start and Delete, and a second press hides them', SHOWN, async ($, on) => {
  await givenDocker($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await actionLabels(ui)).toEqual([])

  await ui.press({ key: `docker-container:${MAILPIT}` })
  expect(await actionLabels(ui)).toEqual(['Restart', 'Stop'])

  await ui.press({ key: `docker-container:${POSTGRES}` })
  expect(await actionLabels(ui)).toEqual(['Start', 'Delete'])

  await ui.press({ key: `docker-container:${POSTGRES}` })
  expect(await actionLabels(ui)).toEqual([])
  await ui.unmount()
})

for (const [action, label, container, after] of [
  ['restart', 'Restart', MAILPIT, ['Restart', 'Stop']],
  ['stop', 'Stop', MAILPIT, ['Start', 'Delete']],
  ['start', 'Start', POSTGRES, ['Restart', 'Stop']],
] as const) {
  test(`${label} runs docker ${action} on that container at once and the list follows`, SHOWN, async ($, on) => {
    const { world, toasts } = await givenDocker($, on, { usesMockClock: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: `docker-container:${container}` })
    world.ran.length = 0

    await ui.press({ key: `docker-${action}` })

    expect(actionCalls(world.ran)).toEqual([[action, '--', container]])
    expect(dockerCalls(world.ran).slice(1)).toEqual(READS)
    expect(await actionLabels(ui)).toEqual([...after])
    expect(toasts).toEqual([])
    await ui.unmount()
  })
}

test('Delete asks for a second press before it removes the container', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${POSTGRES}` })

  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([])
  expect(await actionLabels(ui)).toEqual(['Start', 'Confirm delete'])
  expect((await ui.find({ type: 'Text', text: /^Confirm delete$/ }))?.props.color).toBe('error')

  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([['rm', '--', POSTGRES]])
  expect(await listedContainers(ui)).toEqual(['api-mailpit-1'])
  expect(await actionLabels(ui)).toEqual([])
  await ui.unmount()
})

test('a Delete left unconfirmed for five seconds goes back to Delete and the next press asks again', SHOWN, async ($, on) => {
  const { world, clock } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${POSTGRES}` })
  await ui.press({ key: 'docker-delete' })

  await clock?.advance(5_000)
  expect(await actionLabels(ui)).toEqual(['Start', 'Delete'])

  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([])
  expect(await actionLabels(ui)).toEqual(['Start', 'Confirm delete'])
  await ui.unmount()
})

test('pressing another row or another action drops a pending Delete', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${POSTGRES}` })
  await ui.press({ key: 'docker-delete' })

  await ui.press({ key: `docker-container:${MAILPIT}` })
  await ui.press({ key: `docker-container:${POSTGRES}` })
  expect(await actionLabels(ui)).toEqual(['Start', 'Delete'])

  await ui.press({ key: 'docker-delete' })
  await ui.press({ key: 'docker-tab:images' })
  await ui.press({ key: 'docker-tab:containers' })
  await ui.press({ key: `docker-container:${POSTGRES}` })
  expect(await actionLabels(ui)).toEqual(['Start', 'Delete'])
  expect(actionCalls(world.ran)).toEqual([])
  await ui.unmount()
})

test('deleting an image removes its reference with two presses, and a dangling image by its ID', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'docker-tab:images' })

  await ui.press({ key: 'docker-image:47928bf67eb6/nginx:1.30-alpine' })
  expect(await actionLabels(ui)).toEqual(['Delete'])
  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([])
  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([['rmi', '--', 'nginx:1.30-alpine']])
  expect((await ui.findAll({ type: 'Text', text: /^(nginx:|0123456789ab)/ })).map(found => found.text)).toEqual([
    'nginx:stable-alpine',
    '0123456789ab',
  ])

  await ui.press({ key: 'docker-image:0123456789ab/<none>:<none>' })
  await ui.press({ key: 'docker-delete' })
  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran).at(-1)).toEqual(['rmi', '--', '0123456789ab'])
  await ui.unmount()
})

test('while docker works on a container its row says so and offers nothing to press', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${MAILPIT}` })
  const release = holdDocker(world.docker)

  const pressed = ui.press({ key: 'docker-stop' })
  expect(await actionLabels(ui)).toEqual([])
  expect((await ui.find({ type: 'Text', text: /^stopping…$/ }))?.props.color).toBe('warning')
  expect(await ui.find({ key: 'docker-restart' })).toBeUndefined()

  await ui.press({ key: `docker-container:${POSTGRES}` })
  expect((await ui.find({ type: 'Text', text: /^stopping…$/ }))?.text).toBe('stopping…')
  await ui.press({ key: `docker-container:${MAILPIT}` })

  release()
  await pressed
  expect(await actionLabels(ui)).toEqual(['Start', 'Delete'])
  expect(actionCalls(world.ran)).toEqual([['stop', '--', MAILPIT]])
  await ui.unmount()
})

test('an action docker refuses shows a toast with docker\'s first line and leaves the row usable', SHOWN, async ($, on) => {
  const { world, toasts } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'docker-tab:images' })
  await ui.press({ key: 'docker-image:47928bf67eb6/nginx:1.30-alpine' })
  world.docker.actionFailure = {
    exitCode: 1,
    stderr: 'Error response from daemon: conflict: unable to remove repository reference "nginx:1.30-alpine" (must force)\n',
  }

  await ui.press({ key: 'docker-delete' })
  await ui.press({ key: 'docker-delete' })

  expect(toasts).toEqual([
    'Could not delete nginx:1.30-alpine: Error response from daemon: conflict: unable to remove repository reference "nginx:1.30-alpine" (must force)',
  ])
  expect(await actionLabels(ui)).toEqual(['Delete'])
  expect((await ui.findAll({ type: 'Text', text: /^nginx:/ })).map(found => found.text)).toEqual([
    'nginx:1.30-alpine',
    'nginx:stable-alpine',
  ])
  await ui.unmount()
})

test('an action that cannot start shows a toast saying why', SHOWN, async ($, on) => {
  const { world, toasts } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${MAILPIT}` })
  world.docker.actionFailure = 'missing'

  await ui.press({ key: 'docker-restart' })

  expect(toasts).toEqual(['Could not restart api-mailpit-1: Docker CLI not found'])
  expect(await actionLabels(ui)).toEqual(['Restart', 'Stop'])
  await ui.unmount()
})

test('actions run with a one-minute timeout, never the five-second read timeout', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${MAILPIT}` })

  await ui.press({ key: 'docker-stop' })

  expect(world.docker.actionTimeouts).toEqual([60_000])
  await ui.unmount()
})

test('a Delete whose expiry timer was lost, as a reload loses it, still expires after five seconds', SHOWN, async ($, on) => {
  let now = NOW
  on('clock.now', () => ({ value: now }))
  on('clock.after', () => new Promise<never>(() => {}))
  on('clock.every', () => new Promise<never>(() => {}))
  const { world } = givenEngine(on, { usesMockClock: true })
  world.store.dockerOpen = true
  world.docker.containers = [dockerContainer(POSTGRES, 'api-postgres-1', 'exited')]
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  world.isPaneOpen = true
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${POSTGRES}` })
  await ui.press({ key: 'docker-delete' })

  now += 5_000
  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([])
  expect(await actionLabels(ui)).toEqual(['Start', 'Confirm delete'])

  now += 4_999
  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([['rm', '--', POSTGRES]])
  await ui.unmount()
})

test('an armed Delete reads Delete again once its five seconds are over, even without its timer', SHOWN, async ($, on) => {
  let now = NOW
  on('clock.now', () => ({ value: now }))
  on('clock.after', () => new Promise<never>(() => {}))
  on('clock.every', () => new Promise<never>(() => {}))
  const { world } = givenEngine(on, { usesMockClock: true })
  world.store.dockerOpen = true
  world.docker.containers = [dockerContainer(POSTGRES, 'api-postgres-1', 'exited')]
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  world.isPaneOpen = true
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `docker-container:${POSTGRES}` })
  await ui.press({ key: 'docker-delete' })
  expect(await actionLabels(ui)).toEqual(['Start', 'Confirm delete'])

  now += 5_000
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await actionLabels(ui)).toEqual(['Start', 'Delete'])
  await ui.unmount()
})

const givenVolumeSelected = async ($: Parameters<TestBody>[0], on: On, volume: string) => {
  const engine = await givenDocker($, on, { usesMockClock: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'docker-tab:volumes' })
  await ui.press({ key: `docker-volume:${volume}` })

  return { ...engine, ui }
}

test('pressing a volume offers Delete, and a second press hides it', SHOWN, async ($, on) => {
  const { ui } = await givenVolumeSelected($, on, 'build_cache')
  expect(await actionLabels(ui)).toEqual(['Delete'])
  expect((await ui.find({ type: 'Text', text: /^Delete$/ }))?.props.color).toBe('suggestion')

  await ui.press({ key: 'docker-volume:build_cache' })
  expect(await actionLabels(ui)).toEqual([])
  await ui.unmount()
})

test('Delete removes a volume with docker volume rm, never forced, only on a second press', SHOWN, async ($, on) => {
  const { world, ui } = await givenVolumeSelected($, on, 'build_cache')

  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([])
  expect(await actionLabels(ui)).toEqual(['Confirm delete'])
  expect((await ui.find({ type: 'Text', text: /^Confirm delete$/ }))?.props.color).toBe('error')

  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([['volume', 'rm', '--', 'build_cache']])
  expect(await listedVolumes(ui)).toEqual(['mailpit_data', 'pgdata'])
  expect(await actionLabels(ui)).toEqual([])
  await ui.unmount()
})

test('a volume Delete left unconfirmed for five seconds goes back to Delete and the next press asks again', SHOWN, async ($, on) => {
  const { world, clock, ui } = await givenVolumeSelected($, on, 'build_cache')
  await ui.press({ key: 'docker-delete' })

  await clock?.advance(5_000)
  expect(await actionLabels(ui)).toEqual(['Delete'])

  await ui.press({ key: 'docker-delete' })
  expect(actionCalls(world.ran)).toEqual([])
  expect(await actionLabels(ui)).toEqual(['Confirm delete'])
  await ui.unmount()
})

test('a volume docker refuses to delete shows docker\'s reason in a toast and stays listed', SHOWN, async ($, on) => {
  const { world, toasts, ui } = await givenVolumeSelected($, on, 'pgdata')
  world.docker.actionFailure = { exitCode: 1, stderr: 'Error response from daemon: remove pgdata: volume is in use - [1622725f7f74]\n' }

  await ui.press({ key: 'docker-delete' })
  await ui.press({ key: 'docker-delete' })

  expect(toasts).toEqual(['Could not delete pgdata: Error response from daemon: remove pgdata: volume is in use - [1622725f7f74]'])
  expect(await listedVolumes(ui)).toEqual(['build_cache', 'mailpit_data', 'pgdata'])
  expect(await actionLabels(ui)).toEqual(['Delete'])
  await ui.unmount()
})

test('while docker deletes a volume its row reads deleting… and offers nothing to press', SHOWN, async ($, on) => {
  const { world, ui } = await givenVolumeSelected($, on, 'build_cache')
  await ui.press({ key: 'docker-delete' })
  const release = holdDocker(world.docker)

  const pressed = ui.press({ key: 'docker-delete' })
  expect((await ui.find({ type: 'Text', text: /^deleting…$/ }))?.props.color).toBe('warning')
  expect(await actionLabels(ui)).toEqual([])

  release()
  await pressed
  expect(await listedVolumes(ui)).toEqual(['mailpit_data', 'pgdata'])
  await ui.unmount()
})

test('a failing docker images shows its reason in the Images tab and leaves the containers listed', SHOWN, async ($, on) => {
  const { world } = await givenDocker($, on)
  world.docker.imagesFailure = { exitCode: 1, stderr: 'Error response from daemon: image store unavailable\n' }
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await listedContainers(ui)).toEqual(['api-mailpit-1', 'api-postgres-1'])
  expect((await ui.find({ type: 'Text', text: /^Images$/ }))?.text).toBe('Images')

  await ui.press({ key: 'docker-tab:images' })
  expect((await ui.find({ type: 'Text', text: /^Error response from daemon: image s/ }))?.text).toBe(
    'Error response from daemon: image s…',
  )
  expect(await ui.find({ type: 'Text', text: /^No images$/ })).toBeUndefined()
  await ui.unmount()
})
