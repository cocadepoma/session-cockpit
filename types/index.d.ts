export type SidebarTodoStatus = 'pending' | 'in_progress' | 'completed'

export type SidebarTodo = { id: string; content: string; status: SidebarTodoStatus }

export type SidebarContext = {
  tokens: number | null
  window: number | null
  percent: number | null
  usd: number | null
  isEstimate: boolean
}

export type SidebarRateLimit = { kind: string; percentUsed: number; resetsAt: string | null }

export type SidebarLimits = {
  items: SidebarRateLimit[]
  checkedAt: number
  readAt: number | null
  isStored: boolean
}

export type SidebarModel = { model: string; effort: string | null }

export type SidebarGit = {
  project: string
  root: string | null
  branch: string | null
  isDirty: boolean
  ahead: number
  behind: number
}

export type SidebarMeta = { cwd: string; home: string | null; version: string; mcpServers: string[] }

export type SidebarSkill = { name: string; description: string }

export type SidebarNote = { id: string; text: string; createdAt: number }

export type SidebarFile = { path: string; added: number; removed: number }

export type SidebarDiff = { path: string; source: string; note: string | null }

export type SidebarOpenSession = {
  id: string
  title: string
  project: string
  status: string
  waitingFor: string | null
  isCurrent: boolean
  agents: SidebarSessionAgent[]
}

export type SidebarSessionAgent = { id: string; type: string; description: string; status: string; depth: number }

export type SidebarKeepAwake = { isOn: boolean; isVerified: boolean; minutesLeft: number | null }

export type SidebarConversation = { id: string; title: string | null; updatedAt: number; isCurrent: boolean }

export type SidebarActivityEntry = {
  id: string
  kind: 'tool' | 'agent'
  name: string
  target: string | null
  startedAt: number
  endedAt: number | null
  isError: boolean
  parentId: string | null
}

export type SidebarActivity = { running: SidebarActivityEntry[]; finished: SidebarActivityEntry[]; sequence: number }

export type SidebarCostTotals = { today: number; week: number; isLoaded: boolean }

export type SidebarContextRow = { name: string; tokens: number }

export type SidebarContextDetails = {
  categories: SidebarContextRow[]
  window: number | null
  files: SidebarContextRow[] | null
  servers: SidebarContextRow[] | null
  isMeasuring: boolean
}

export type SidebarLogo = { art: string | null }

declare module 'claude-code' {
  interface PluginState {
    'session-cockpit': {
      title: string | null
      sessionTitle: string | null
      todos: SidebarTodo[]
      context: SidebarContext
      limits: SidebarLimits
      activity: SidebarActivity
      costTotals: SidebarCostTotals
      isContextDetailsOpen: boolean
      contextDetails: SidebarContextDetails
      tick: number
      model: SidebarModel
      turnActive: boolean
      isModelPickerOpen: boolean
      git: SidebarGit
      meta: SidebarMeta
      skills: SidebarSkill[]
      conversations: SidebarConversation[]
      notes: SidebarNote[]
      logo: SidebarLogo
      openSessions: SidebarOpenSession[]
      files: SidebarFile[]
      gitFiles: SidebarFile[]
      diff: SidebarDiff | null
      keepAwake: SidebarKeepAwake
      listFilter: StateFamily<string>
      listOffset: StateFamily<number>
      isSectionOpen: StateFamily<boolean>
    }
  }
}
