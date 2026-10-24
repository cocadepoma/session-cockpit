import type { PluginOptions } from 'claude-code'

export const DEFAULT_CONTEXT_WARNING = 70
export const DEFAULT_CONTEXT_CRITICAL = 85

export type ToggleableSection =
  | 'logo'
  | 'keepAwake'
  | 'context'
  | 'usage'
  | 'skills'
  | 'sessions'
  | 'conversations'
  | 'notes'
  | 'files'
  | 'mcp'
  | 'activity'
  | 'todos'
  | 'help'

export type Thresholds = { warning: number; critical: number }

export type Settings = { isShown: (section: ToggleableSection) => boolean; thresholds: Thresholds }

export const DEFAULT_THRESHOLDS: Thresholds = { warning: DEFAULT_CONTEXT_WARNING, critical: DEFAULT_CONTEXT_CRITICAL }

const isPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100

const thresholdsOf = (options: PluginOptions): Thresholds => {
  const warning = options.contextWarning ?? DEFAULT_CONTEXT_WARNING
  const critical = options.contextCritical ?? DEFAULT_CONTEXT_CRITICAL

  return isPercent(warning) && isPercent(critical) && warning < critical ? { warning, critical } : DEFAULT_THRESHOLDS
}

export const optionOf = (section: ToggleableSection) => `show${section.charAt(0).toUpperCase()}${section.slice(1)}`

export const readSettings = (options: PluginOptions): Settings => ({
  isShown: section => options[optionOf(section)] !== false,
  thresholds: thresholdsOf(options),
})
