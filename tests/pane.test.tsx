import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { register } from '../hooks/register'
import { PANE, givenEngine, runSidebar } from './fixtures'

type CloseOrigin = 'person' | 'plugin' | 'unload'

type CloseHook = (
  $: unknown,
  e: { id: string; origin: { kind: CloseOrigin } },
  next: ((e: unknown) => unknown) & { called: boolean },
) => Promise<unknown>

const sidebarCloseHook = () => {
  let hook: CloseHook | undefined
  const capture = (event: string, ...rest: unknown[]) => {
    if (event === 'ui.close') hook = rest.at(-1) as CloseHook

    return { catch: () => undefined }
  }
  register(capture as unknown as On, {} as Parameters<typeof register>[1])
  if (!hook) throw new Error('the sidebar registers no ui.close hook')

  return hook
}

const raiseClose = async (store: Record<string, unknown>, origin: CloseOrigin) => {
  const passed: unknown[] = []
  const next = Object.assign((e: unknown) => passed.push(e), { called: false })
  const engine = {
    store: {
      set: async (key: string, value: unknown) => {
        store[key] = value
      },
    },
  }
  await sidebarCloseHook()(engine, { id: 'sidebar', origin: { kind: origin } }, next)

  return passed
}

const startSession = async ($: Parameters<TestBody>[0]) => {
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.unmount()
}

test('a session starts with the sidebar open when nothing was stored', async ($, on) => {
  const { opens, world } = givenEngine(on)
  await startSession($)

  expect(opens.at(-1)).toEqual({ columns: 42, focus: undefined })
  expect(world.isPaneOpen).toBe(true)
})

test('the close mark closes the sidebar for real, and the next session starts without it', async ($, on) => {
  const { world, opens } = givenEngine(on)
  await startSession($)

  expect(await raiseClose(world.store, 'person')).toHaveLength(1)
  world.isPaneOpen = false
  expect(world.store.open).toBe(false)

  opens.length = 0
  await startSession($)
  expect(opens).toEqual([])
  expect(world.isPaneOpen).toBe(false)
})

test('an engine close does not change whether the next session opens the sidebar', async ($, on) => {
  const { world } = givenEngine(on)
  await startSession($)

  expect(await raiseClose(world.store, 'unload')).toHaveLength(1)
  expect(await raiseClose(world.store, 'plugin')).toHaveLength(1)
  expect(world.store.open).toBeUndefined()
})

test('/sidebar reopens a closed sidebar with focus, and the next session opens it', async ($, on) => {
  const { world, opens } = givenEngine(on)
  await startSession($)
  await raiseClose(world.store, 'person')
  world.isPaneOpen = false

  expect((await $.command.run(runSidebar)).text).toBe('Sidebar shown.')
  expect(opens.at(-1)).toEqual({ columns: 42, focus: true })
  expect(world.isPaneOpen).toBe(true)
  expect(world.store.open).toBe(true)

  world.isPaneOpen = false
  opens.length = 0
  await startSession($)
  expect(opens.at(-1)).toEqual({ columns: 42, focus: undefined })
})

test('/sidebar closes a shown sidebar and remembers it closed', async ($, on) => {
  const { world, opens } = givenEngine(on)
  await startSession($)
  opens.length = 0

  expect((await $.command.run(runSidebar)).text).toBe('Sidebar closed.')
  expect(world.isPaneOpen).toBe(false)
  expect(world.store.open).toBe(false)
  expect(opens).toEqual([])

  await startSession($)
  expect(opens).toEqual([])
})

test('/sidebar brings a sidebar hidden behind another tab to the front', async ($, on) => {
  const { opens, world } = givenEngine(on)
  await startSession($)

  world.isPaneShown = false
  expect((await $.command.run(runSidebar)).text).toBe('Sidebar shown.')
  expect(opens.at(-1)).toEqual({ columns: 42, focus: true })
  expect(world.isPaneOpen).toBe(true)
})

test('/sidebar is registered to run mid-turn, without waiting for the turn to end', async ($, on) => {
  const { registered } = givenEngine(on)
  await startSession($)

  expect(registered.find(command => command.name === 'sidebar')?.immediate).toBe(true)
})
