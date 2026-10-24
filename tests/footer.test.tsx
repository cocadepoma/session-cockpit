import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { PANE, givenEngine } from './fixtures'

const shownDirectory = async ($: Parameters<TestBody>[0], cwd: string) => {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = await ui.find({ type: 'Text', text: /^(~|\/home\/dev2).*/ })
  await ui.unmount()

  return found?.text
}

test('the footer shortens the home directory to a tilde', async ($, on) => {
  const { world } = givenEngine(on)
  world.cwd = '/home/dev/app'

  expect(await shownDirectory($, world.cwd)).toBe('~/app')
})

test('the footer shows a tilde alone when the directory is the home directory', async ($, on) => {
  const { world } = givenEngine(on)
  world.cwd = '/home/dev'

  expect(await shownDirectory($, world.cwd)).toBe('~')
})

test('the footer does not shorten a sibling directory that only shares the home prefix', async ($, on) => {
  const { world } = givenEngine(on)
  world.cwd = '/home/dev2/x'

  expect(await shownDirectory($, world.cwd)).toBe('/home/dev2/x')
})
