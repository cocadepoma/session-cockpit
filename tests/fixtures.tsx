import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

export const PANE = {
  plugin: 'session-cockpit',
  component: 'Pane',
  requestId: 'sidebar',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

export const SETTINGS_PLUGIN = 'session-cockpit@local-mods'

export const SETTING_FIELDS = [
  'showLogo',
  'showKeepAwake',
  'showContext',
  'showUsage',
  'showSkills',
  'showSessions',
  'showConversations',
  'showNotes',
  'showFiles',
  'showMcp',
  'showActivity',
  'showTodos',
  'showHelp',
]

export const NOW = Date.parse('2026-10-21T10:00:00Z')

export const HOUR_MS = 3_600_000

export const TRANSCRIPTS = '/home/dev/.claude/projects/-home-dev-app'

const TRANSCRIPT_TITLES: Record<string, string[]> = {
  [`${TRANSCRIPTS}/current.jsonl`]: ['"aiTitle":"Sidebar for Claude Code"'],
  [`${TRANSCRIPTS}/newer.jsonl`]: ['"aiTitle":"Draft title"', '"customTitle":"Renamed \\"quoted\\" title"'],
  [`${TRANSCRIPTS}/older.jsonl`]: [],
  [`${TRANSCRIPTS}/fresh.jsonl`]: ['"aiTitle":"Opened in another tab"'],
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `${TRANSCRIPTS}/conversation-${index + 1}.jsonl`,
      [`"aiTitle":"Batch ${index + 1}"`],
    ]),
  ),
}

const TRANSCRIPT_USAGES: Record<string, string[]> = {
  [`${TRANSCRIPTS}/other.jsonl`]: [
    '"usage":{"input_tokens":3,"cache_creation_input_tokens":500,"cache_read_input_tokens":90000',
    '"usage":{"input_tokens":2,"cache_creation_input_tokens":1287,"cache_read_input_tokens":165152',
  ],
}

const contentStamp = (text: string) => [...text].reduce((stamp, char) => (stamp * 31 + char.charCodeAt(0)) >>> 0, 7)

export const transcriptEntry = (name: string, mtimeMs: number) => ({
  name,
  kind: 'file' as const,
  size: 10,
  mtimeMs,
  isLink: false,
})

const DEFAULT_TRANSCRIPTS = [
  transcriptEntry('current.jsonl', NOW),
  transcriptEntry('older.jsonl', NOW - 72 * HOUR_MS),
  transcriptEntry('newer.jsonl', NOW - 2 * HOUR_MS),
  transcriptEntry('notes.txt', NOW),
]

export const hourlyTranscripts = Array.from({ length: 12 }, (_, index) =>
  transcriptEntry(`conversation-${index + 1}.jsonl`, NOW - (index + 1) * HOUR_MS),
)

export const SNAPSHOT_ROOT = '/home/dev/.claude/session-cockpit/diffs'

export const COST_ROOT = '/home/dev/.claude/session-cockpit/cost'

export const AGENTS_ROOT = '/home/dev/.claude/session-cockpit/agents'

const SESSION_REGISTRY = '/home/dev/.claude/sessions'

export const SRC_FILE = '/home/dev/app/src/index.ts'

const unifiedHunks = (before: string, after: string) => {
  const old = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const next = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  let head = 0
  while (head < old.length && head < next.length && old[head] === next[head]) head++
  let tail = 0
  while (tail < old.length - head && tail < next.length - head && old.at(-1 - tail) === next.at(-1 - tail)) tail++
  const removed = old.slice(head, old.length - tail)
  const added = next.slice(head, next.length - tail)
  if (removed.length === 0 && added.length === 0) return ''

  return [
    '--- a/x',
    '+++ b/x',
    `@@ -${head + 1},${removed.length} +${head + 1},${added.length} @@`,
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
    '',
  ].join('\n')
}

export const wheelTick = (by: number) =>
  ({
    component: 'Pane',
    requestId: 'sidebar',
    offset: 0,
    by,
    bodyRows: 40,
    contentRows: 40,
    origin: { kind: 'person' },
  }) as const

export const paneAt = (offset: number) =>
  ({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset, bodyRows: 40 } } }) as const

export const givenTenFilesWithEmptyNotes = async ($: Parameters<TestBody>[0], on: On) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.store.notesOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  for (const number of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
    await $.tool.call({ tool: 'Write', file_path: `/home/dev/notes/n${number}.md`, content: 'x\n' })
  }
}

export type AgentStandIn = {
  id: string
  description: string
  type: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  parentId?: string
}

export type CommandStandIn = { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp' }

export const DEFAULT_COMMANDS: CommandStandIn[] = [
  { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
  { name: 'sidebar', description: 'Show or hide the sidebar', source: 'plugin' },
  { name: 'frontend-review-checklist', description: 'Review frontend changes', source: 'user' },
  { name: 'gitlab-mr', description: 'Create a merge request', source: 'user' },
  { name: 'figma:figma-use', description: 'Use Figma', source: 'plugin' },
]

export const DEFAULT_TOOLS = [
  { name: 'Read', description: 'Reads a file', mcp: false },
  { name: 'mcp__context7__query-docs', description: 'Docs', mcp: true },
  { name: 'mcp__codegraph__codegraph_explore', description: 'Graph', mcp: true },
  { name: 'mcp__engram__mem_save', description: 'Memory', mcp: true },
]

type EngineOptions = {
  commands?: CommandStandIn[]
  transcripts?: ReturnType<typeof transcriptEntry>[]
  usesMockClock?: boolean
}

export const givenEngine = (
  on: On,
  { commands = DEFAULT_COMMANDS, transcripts = DEFAULT_TRANSCRIPTS, usesMockClock = false }: EngineOptions = {},
) => {
  const filled: string[] = []
  const resumed: string[] = []
  const cleared: string[] = []
  const titleReads: string[][] = []
  const copied: string[] = []
  const toasts: string[] = []
  const registered: { name: string; immediate?: true }[] = []
  const opens: { columns?: number; focus?: true }[] = []
  const panes: { id: string; title?: string; focus?: true; closeOnEscape?: true }[] = []
  const world: {
    sessionId: string
    cwd: string
    root: string
    home: string
    ran: string[][]
    snapshotDirectories: { name: string; mtimeMs: number }[]
    model: string
    tokens: number | undefined
    percent: number | undefined
    rateLimits: { kind: string; percentUsed: number; resetsAt: string }[]
    breakdownTokens: number | 'throws' | undefined
    startedAt: number
    cacheCreations: string[]
    breakdownCalls: string[]
    breakdownRows: { categories: unknown[]; memoryFiles: unknown[]; mcpTools: unknown[] } | undefined
    commands: CommandStandIn[]
    transcripts: ReturnType<typeof transcriptEntry>[]
    tools: typeof DEFAULT_TOOLS
    isPaneShown: boolean
    isPaneOpen: boolean
    store: Record<string, unknown>
    selection: string | undefined
    messages: { role: 'user' | 'assistant'; text: string }[]
    files: Record<string, string>
    written: string[]
    isWriteFailing: boolean
    costUsd: number | undefined
    listed: string[]
    read: string[]
    mtimes: Record<string, number>
    agents: AgentStandIn[] | 'throws'
    diffOutput: string | undefined
    deadPids: number[]
    isPsFailing: boolean
    env: Record<string, string>
    platform: string
    spawn: {
      plans: Record<string, 'run' | 'exit' | 'fail'>
      started: string[][]
      killed: string[]
      endings: Record<string, () => void>
    }
    editOutcome: 'done' | 'deny' | 'error'
    config: {
      hasPluginRows: boolean
      outcome: 'done' | 'deny' | 'reject'
      sets: { key: string; value: unknown }[]
    }
    git: {
      top: string | undefined
      status: string
      numstat: string
      diffs: Record<string, string>
      untracked: string[]
      isFailing: boolean
    }
  } = {
    sessionId: 'current',
    cwd: '/home/dev/app',
    root: '/home/dev/app',
    home: '/home/dev',
    ran: [],
    snapshotDirectories: [],
    model: 'claude-opus-5-5',
    tokens: 45210,
    percent: 23,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 41.4, resetsAt: '2026-10-21T12:13:00Z' },
      { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-25T13:00:00Z' },
    ],
    breakdownTokens: undefined,
    startedAt: NOW - 4_320_000,
    cacheCreations: [],
    breakdownCalls: [],
    breakdownRows: undefined,
    commands,
    transcripts,
    tools: DEFAULT_TOOLS,
    isPaneShown: true,
    isPaneOpen: false,
    store: {},
    selection: undefined,
    messages: [],
    files: {},
    written: [],
    isWriteFailing: false,
    costUsd: 1.5,
    listed: [],
    read: [],
    mtimes: {},
    agents: [],
    diffOutput: undefined,
    deadPids: [],
    isPsFailing: false,
    env: {},
    platform: 'Darwin',
    spawn: { plans: {}, started: [], killed: [], endings: {} },
    editOutcome: 'done',
    config: { hasPluginRows: true, outcome: 'done', sets: [] },
    git: {
      top: undefined,
      status: '## testing...origin/testing [ahead 1]\0 M src/index.ts\0',
      numstat: '',
      diffs: {},
      untracked: [],
      isFailing: false,
    },
  }

  on('command.register', (_, e) => {
    registered.push({ name: e.name, immediate: e.immediate })

    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    opens.push({ columns: e.columns, focus: e.focus })
    if (e.id === 'sidebar') world.isPaneOpen = true
    panes.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape })

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    if (e.id === 'sidebar') world.isPaneOpen = false

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: world.isPaneOpen
      ? [{ id: 'sidebar', title: 'Session', isShown: world.isPaneShown, isFocused: false, isPlaced: true }]
      : [],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: world.cwd }))
  on('session.root', () => ({ value: world.root }))
  on('session.id', () => ({ value: world.sessionId }))
  on('session.model', () => ({ value: world.model }))
  on('session.version', () => ({ value: { version: '2.1.306' } }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? world.home : world.env[e.name] }))
  on('store.get', (_, e) => ({ value: world.store[e.key] }))
  on('store.set', (_, e) => {
    world.store[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete world.store[e.key]

    return { value: undefined }
  })
  if (!usesMockClock) {
    on('clock.now', () => ({ value: NOW }))
    on('clock.every', () => ({ value: undefined }))
  }
  on('config.list', () => ({
    value: [
      ...(world.config.hasPluginRows ? SETTING_FIELDS : []).map(field => ({
        key: `${SETTINGS_PLUGIN}.${field}`,
        label: field,
        kind: 'boolean' as const,
        value: true,
        provider: { plugin: SETTINGS_PLUGIN, tier: 'user' as const },
        isLocked: false,
      })),
    ],
  }))
  on('config.set', (_, e) => {
    world.config.sets.push({ key: e.key, value: e.value })
    if (world.config.outcome === 'reject') throw new Error('settings are read only')

    return world.config.outcome === 'deny' ? { deny: 'a policy owns it' } : { value: e.value }
  })
  on('process.run', (_, e) => {
    const [command, ...args] = e.argv
    world.ran.push([...e.argv])
    if (command === 'diff') {
      const stdout =
        world.diffOutput ?? unifiedHunks(world.files[args[5] ?? ''] ?? '', world.files[args[6] ?? ''] ?? '')

      return {
        value: { exitCode: stdout === '' ? 0 : 1, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
      }
    }
    if (command === 'ps') {
      if (world.isPsFailing) throw new Error('ps unavailable')
      const stdout = (args[1] ?? '')
        .split(',')
        .filter(pid => !world.deadPids.includes(Number(pid)))
        .join('\n')

      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'uname') {
      return { value: { exitCode: 0, stdout: `${world.platform}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'rm') {
      for (const path of Object.keys(world.files)) if (path.startsWith(`${args[2] ?? ''}/`)) delete world.files[path]
      if (args[0] === '-f') delete world.files[args[2] ?? '']

      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'git') {
      const { git } = world
      const args = withoutGitOptions(e.argv.slice(1))
      const ran = (exitCode: number, stdout: string) => ({
        value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
      })
      if (git.isFailing) return ran(128, '')
      if (args[0] === 'status') return ran(0, git.status)
      if (args[0] === 'rev-parse') return git.top === undefined ? ran(128, '') : ran(0, `${git.top}\n`)
      if (args[0] === 'ls-files') return ran(git.untracked.includes(args.at(-1) ?? '') ? 1 : 0, '')
      if (args[0] === 'diff' && args.includes('--numstat')) return ran(0, git.numstat)
      if (args[0] === 'diff') {
        const output = git.diffs[args.at(-1) ?? ''] ?? ''

        return ran(args.includes('--no-index') && output !== '' ? 1 : 0, output)
      }

      return ran(0, '')
    }
    if (args[0] === '-HoE') titleReads.push(args.slice(2))
    const stdout =
      args[0] === '-oE'
          ? (args[1]?.startsWith('"cache_creation":') ? world.cacheCreations : (TRANSCRIPT_USAGES[args[2] ?? ''] ?? [])).join('\n')
          : args
              .flatMap(path => (TRANSCRIPT_TITLES[path] ?? []).map(match => `${path}:${match}`))
              .join('\n')

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.list', (_, e) => ({
    value: (world.listed.push(e.path), e.path) === SNAPSHOT_ROOT
      ? world.snapshotDirectories.map(({ name, mtimeMs }) => ({ name, kind: 'dir' as const, size: 0, mtimeMs, isLink: false }))
      : e.path === SESSION_REGISTRY || e.path === AGENTS_ROOT
      ? Object.keys(world.files)
          .filter(path => path.startsWith(`${e.path}/`))
          .map(path => ({
            name: path.slice(e.path.length + 1),
            kind: 'file' as const,
            size: world.files[path]?.length ?? 0,
            mtimeMs: world.mtimes[path] ?? contentStamp(world.files[path] ?? ''),
            isLink: false,
          }))
      : e.path.startsWith(SNAPSHOT_ROOT) || e.path === COST_ROOT
      ? Object.keys(world.files)
          .filter(path => path.startsWith(`${e.path}/`))
          .map((path, index) => transcriptEntry(path.slice(e.path.length + 1), index + 1))
      : world.transcripts,
  }))
  on('fs.exists', (_, e) => ({ value: e.path in world.files }))
  on('fs.read', (_, e) => {
    world.read.push(e.path)
    const text = world.files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: text }
  })
  on('fs.write', (_, e) => {
    if (world.isWriteFailing) throw new Error('disk full')
    world.files[e.path] = e.text
    world.written.push(e.path)

    return { value: undefined }
  })
  on('agent.list', () => {
    if (world.agents === 'throws') throw new Error('agent list unavailable')

    return { value: world.agents }
  })
  on('command.list', () => ({ value: world.commands }))
  on('tool.list', () => ({ value: world.tools }))
  on('session.usage', (_, e) => {
    const isBreakdown = e?.breakdown !== undefined
    if (isBreakdown && world.breakdownTokens === 'throws') throw new Error('breakdown unavailable')
    if (isBreakdown) world.breakdownCalls.push(e.breakdown as string)
    const rows = world.breakdownRows
    const breakdown = !isBreakdown
      ? undefined
      : rows !== undefined
        ? {
            totalTokens: 1,
            rawMaxTokens: 200000,
            categories: rows.categories,
            memoryFiles: e.breakdown === 'full' ? rows.memoryFiles : [],
            mcpTools: e.breakdown === 'full' ? rows.mcpTools : [],
          }
        : typeof world.breakdownTokens === 'number'
          ? { totalTokens: world.breakdownTokens }
          : undefined

    return {
      value: {
        startedAt: world.startedAt,
        context: { tokens: world.tokens, window: 200000, percent: world.percent, breakdown } as never,
        rateLimits: world.rateLimits,
        cost: world.costUsd === undefined ? undefined : { usd: world.costUsd },
      },
    }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.selection', () => ({
    value: world.selection === undefined ? undefined : { text: world.selection, element: 'row' },
  }))
  on('session.messages', () => ({ value: world.messages.map(message => ({ ...message, toolUses: [] })) }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('process.spawn', async function* (_, e, next) {
    const command = e.argv[0] ?? ''
    world.spawn.started.push([...e.argv])
    const plan = world.spawn.plans[command] ?? 'fail'
    if (plan === 'fail') return { deny: 'cannot start' }
    if (plan === 'exit') return { value: { code: 1, signal: null } }
    await new Promise<void>(resolve => {
      world.spawn.endings[command] = resolve
      next.signal.addEventListener('abort', () => {
        world.spawn.killed.push(command)
        resolve()
      })
    })

    return { value: { code: 0, signal: null } }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('command.run', { command: 'resume' }, (_, e) => {
    resumed.push(e.args)

    return { text: '' }
  })
  on('command.run', { command: 'clear' }, (_, e) => {
    cleared.push(e.args)

    return { text: '' }
  })
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  on('classic.SessionStart', () => ({}))
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, isImage: false },
  }))
  on('tool.call', { tool: 'Edit' }, (_, e) => {
    if (world.editOutcome === 'deny') return { deny: 'Edits are not allowed' }
    if (world.editOutcome === 'error') return { isError: true as const, result: 'String not found' }
    const before = world.files[e.file_path] ?? ''
    world.files[e.file_path] = before.replace(e.old_string, e.new_string)

    return {
      result: {
        filePath: e.file_path,
        oldString: e.old_string,
        newString: e.new_string,
        originalFile: before,
        structuredPatch: [],
        userModified: false,
        replaceAll: false,
      },
    }
  })
  on('tool.call', { tool: 'Write' }, (_, e) => {
    const before = world.files[e.file_path]
    world.files[e.file_path] = e.content

    return {
      result: {
        type: before === undefined ? ('create' as const) : ('update' as const),
        filePath: e.file_path,
        content: e.content,
        structuredPatch: [],
        originalFile: before ?? null,
      },
    }
  })
  on('tool.call', { tool: 'NotebookEdit' }, (_, e) => {
    const before = world.files[e.notebook_path] ?? ''
    world.files[e.notebook_path] = e.new_source

    return {
      result: {
        new_source: e.new_source,
        cell_type: 'code' as const,
        language: 'python',
        edit_mode: 'replace',
        notebook_path: e.notebook_path,
        original_file: before,
        updated_file: e.new_source,
      },
    }
  })

  return { filled, resumed, cleared, titleReads, world, opens, panes, copied, registered, toasts }
}

export const runSidebar = {
  command: 'sidebar',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

export const editFile = (path: string, oldText: string, newText: string) =>
  ({ tool: 'Edit', file_path: path, old_string: oldText, new_string: newText }) as const

export const registerSession = (
  files: Record<string, string>,
  entry: { pid: number; sessionId: string; cwd: string; name: string; status: string; waitingFor?: unknown },
) => {
  files[`${SESSION_REGISTRY}/${entry.pid}.json`] = JSON.stringify(entry)
}

const withoutGitOptions = (argv: string[]): string[] => {
  if (argv[0] === '-c') return withoutGitOptions(argv.slice(2))

  return argv[0]?.startsWith('--') ? withoutGitOptions(argv.slice(1)) : argv
}

export const APP = '/home/dev/app'

const GIT_HEAD = '## testing...origin/testing\0'

export const givenGitRepository = (world: { git: { top: string | undefined; status: string; numstat: string } }, status: string, numstat = '') => {
  world.git.top = APP
  world.git.status = `${GIT_HEAD}${status}`
  world.git.numstat = numstat
}

export const listedGroupRows = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^(…)?((app|Other) \(\d+\)|src\/|~\/notes\/)/ })).map(found => found.text)
