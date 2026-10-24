import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarFile } from '../../types'
import { shown } from '../lib/lastShown'
import { baseName, isInside } from '../lib/paths'
import { PROCESS_TIMEOUT_MS } from '../lib/process'

const MAX_UNTRACKED_COUNTED = 200
const GIT_OPTIONS = ['--no-optional-locks', '-c', 'core.fsmonitor=false']
const DIFF_OPTIONS = ['--no-ext-diff', '--no-textconv']

const gitState = atom({ plugin: 'session-cockpit', key: 'git' } as const, {
  project: '',
  root: null,
  branch: null,
  isDirty: false,
  ahead: 0,
  behind: 0,
})
const gitFilesState = atom({ plugin: 'session-cockpit', key: 'gitFiles' } as const, [])

const parseGitEntries = (stdout: string) => {
  const [head = '', ...tokens] = stdout.split('\0')
  const entries: { status: string; path: string }[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    if (token.length === 0) continue
    const status = token.slice(0, 2)
    entries.push({ status, path: token.slice(3) })
    if (/[RC]/.test(status)) index++
  }

  return { head, entries }
}

const parseGitStatus = (head: string, changes: number) => {
  const summary = head.replace(/^## /, '').replace(/^No commits yet on /, '')

  return {
    branch: summary.split('...')[0]?.split(' ')[0] || null,
    isDirty: changes > 0,
    ahead: Number(/ahead (\d+)/.exec(summary)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(summary)?.[1] ?? 0),
  }
}

const parseNumstat = (stdout: string) => {
  const counts = new Map<string, { added: number; removed: number }>()
  const tokens = stdout.split('\0')
  for (let index = 0; index < tokens.length; index++) {
    const match = /^(\S+)\t(\S+)\t(.*)$/.exec(tokens[index] ?? '')
    if (match === null) continue
    const [, added = '', removed = '', path = ''] = match
    const target = path === '' ? tokens[index + 2] : path
    if (path === '') index += 2
    if (target !== undefined) counts.set(target, { added: Number(added) || 0, removed: Number(removed) || 0 })
  }

  return counts
}

const countLines = (text: string) =>
  text === '' || text.includes('\0') ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

export const isRepositoryPath = (path: string, root: string | null) => root !== null && isInside(path, root)

function runGit($: EngineInterface, argv: string[]) {
  return $.process.run(['git', ...GIT_OPTIONS, ...argv], { timeoutMs: PROCESS_TIMEOUT_MS }).catch(() => null)
}

async function gitWorkingTree($: EngineInterface, root: string, entries: { status: string; path: string }[]) {
  const numstat = await runGit($, ['diff', ...DIFF_OPTIONS, 'HEAD', '--numstat', '-z'])
  const counts = numstat?.exitCode === 0 ? parseNumstat(numstat.stdout) : new Map()
  const untracked = entries.filter(entry => entry.status === '??').slice(0, MAX_UNTRACKED_COUNTED)
  const lines = new Map(
    await Promise.all(
      untracked.map(async (entry): Promise<[string, number]> => {
        const text = await $.fs.read(`${root}/${entry.path}`).catch(() => '')

        return [entry.path, typeof text === 'string' ? countLines(text) : 0]
      }),
    ),
  )

  return entries.map((entry): SidebarFile => {
    const known = counts.get(entry.path)

    return {
      path: `${root}/${entry.path}`,
      added: entry.status === '??' ? (lines.get(entry.path) ?? 0) : (known?.added ?? 0),
      removed: entry.status === '??' ? 0 : (known?.removed ?? 0),
    }
  })
}

export async function readGit($: EngineInterface) {
  return read($, gitState).then(shown(gitState))
}

export async function readGitFiles($: EngineInterface) {
  return read($, gitFilesState)
}

export async function replaceGitFile($: EngineInterface, file: SidebarFile) {
  await update($, gitFilesState, files => files.map(known => (known.path === file.path ? file : known)))
}

export async function refreshGit($: EngineInterface) {
  const root = await $.session.root()
  const project = baseName(root)
  const status = await runGit($, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'])
  const parsed = status?.exitCode === 0 ? parseGitEntries(status.stdout) : null
  const git =
    parsed === null
      ? { branch: null, isDirty: false, ahead: 0, behind: 0 }
      : parseGitStatus(parsed.head, parsed.entries.length)
  const top = parsed === null ? null : await runGit($, ['rev-parse', '--show-toplevel'])
  const repositoryRoot = top?.exitCode === 0 && top.stdout.trim() !== '' ? top.stdout.trim() : null
  const files =
    parsed === null || repositoryRoot === null
      ? []
      : await gitWorkingTree($, repositoryRoot, parsed.entries).catch(() => [])
  await Promise.all([
    update($, gitState, () => ({ project, root: repositoryRoot, ...git })),
    update($, gitFilesState, () => files),
  ])
}

export async function readGitChanges($: EngineInterface, path: string) {
  const tracked = await runGit($, ['ls-files', '--error-unmatch', '--', path])
  if (tracked === null) return null
  const ran =
    tracked.exitCode === 0
      ? await runGit($, ['diff', ...DIFF_OPTIONS, 'HEAD', '--', path])
      : await runGit($, ['diff', ...DIFF_OPTIONS, '--no-index', '--', '/dev/null', path])
  if (ran === null || ran.exitCode > 1) return null
  const start = ran.stdout.search(/^@@ /m)

  return start < 0 ? '' : ran.stdout.slice(start)
}
