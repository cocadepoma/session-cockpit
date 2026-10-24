export const formatModel = (model: string) => {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(model)
  const family = match?.[1]
  if (!match || !family) return model
  const version = match[3] ? `${match[2]}.${match[3]}` : match[2]
  const longContext = model.includes('[1m]') ? ' 1M' : ''

  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}${longContext}`
}

export const formatTokens = (tokens: number) => String(tokens).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const formatUsd = (usd: number) => `$${usd.toFixed(2)}`

export const formatRemaining = (resetsAt: string | null, now: number) => {
  const resetsAtMs = resetsAt === null ? Number.NaN : Date.parse(resetsAt)
  if (Number.isNaN(resetsAtMs)) return null
  const minutes = Math.max(0, Math.round((resetsAtMs - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`

  return `${minutes}m`
}

export const formatAgo = (timestamp: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  return `${Math.floor(hours / 24)}d`
}

export const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${minutes % 60 === 0 ? '' : `${minutes % 60}m`}`
  const days = Math.floor(hours / 24)

  return `${days}d${hours % 24 === 0 ? '' : `${hours % 24}h`}`
}

export const truncate = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1)).trimEnd()}…`

export const truncateStart = (text: string, width: number) =>
  text.length <= width ? text : `…${text.slice(text.length - Math.max(0, width - 1))}`

export const firstLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''

const GIT_MIN_PROJECT_WIDTH = 4

export const fitGitRow = (project: string, branch: string | null, mark: string, tail: string[], width: number) => {
  const tailWidth = tail.reduce((sum, item) => sum + 1 + item.length, 0)
  const branchWidth = branch === null ? 0 : branch.length + mark.length + 1
  const fittedProject = truncate(project, Math.max(GIT_MIN_PROJECT_WIDTH, width - branchWidth - tailWidth))
  if (branch === null) return { project: fittedProject, branch }
  const room = width - fittedProject.length - 1 - tailWidth - mark.length

  return { project: fittedProject, branch: truncate(branch, Math.max(1, room)) }
}
