import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionRateLimit } from 'claude-code'

import type { SidebarRateLimit } from '../../types'
import { shown } from '../lib/lastShown'
import type { Block } from '../lib/layout'
import { currentTranscriptPath } from '../lib/paths'
import { PROCESS_TIMEOUT_MS } from '../lib/process'
import { formatAgo, formatRemaining, formatTokens, formatUsd, truncate } from '../lib/text'
import type { Thresholds } from '../lib/settings'
import { drawBar, levelColor } from '../lib/view'
import type { PaneInput } from '../lib/view'
import { drawContextDetails } from './contextDetails'
import { readCostTotals } from './cost'

const LIMITS_KEY = 'lastLimits'
const USAGE_PATTERN =
  '"usage":\\{"input_tokens":[0-9]+,"cache_creation_input_tokens":[0-9]+,"cache_read_input_tokens":[0-9]+'
const RATE_LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
const RATE_LIMIT_COLORS: Record<string, string> = {
  five_hour: 'claude',
  seven_day: 'permission',
  spend_limit: 'autoAccept',
}
const RATE_LIMIT_FALLBACK_COLOR = 'suggestion'
const RATE_LIMIT_WINDOWS_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
const PACE_MIN_PERCENT = 10
const PACE_MIN_PROJECTED = 90
const PACE_MARK_COLUMNS = 8
const RATE_LIMIT_LABEL_MAX = 4

const contextState = atom({ plugin: 'session-cockpit', key: 'context' } as const, {
  tokens: null,
  window: null,
  percent: null,
  usd: null,
  isEstimate: false,
})
const limitsState = atom(
  { plugin: 'session-cockpit', key: 'limits' } as const,
  { items: [], checkedAt: 0, readAt: null, isStored: false },
)

const isRateLimit = (value: unknown): value is SidebarRateLimit =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SidebarRateLimit).kind === 'string' &&
  typeof (value as SidebarRateLimit).percentUsed === 'number' &&
  (typeof (value as SidebarRateLimit).resetsAt === 'string' || (value as SidebarRateLimit).resetsAt === null)

async function readLastContextTokens($: EngineInterface) {
  const found = await $.process
    .run(['grep', '-oE', USAGE_PATTERN, await currentTranscriptPath($)], { timeoutMs: PROCESS_TIMEOUT_MS })
    .catch(() => null)
  const counts = found?.stdout.trim().split('\n').at(-1)?.match(/\d+/g)?.map(Number)
  const tokens = counts?.length === 3 ? counts.reduce((sum, count) => sum + count, 0) : 0

  return tokens > 0 ? tokens : null
}

const projectedPercent = (limit: SidebarRateLimit, now: number) => {
  const windowMs = RATE_LIMIT_WINDOWS_MS[limit.kind]
  const resetsAtMs = limit.resetsAt === null ? Number.NaN : Date.parse(limit.resetsAt)
  if (windowMs === undefined || Number.isNaN(resetsAtMs) || limit.percentUsed < PACE_MIN_PERCENT) return null
  const elapsed = 1 - (resetsAtMs - now) / windowMs
  if (elapsed <= 0) return null
  const projected = limit.percentUsed / elapsed

  return projected >= PACE_MIN_PROJECTED ? Math.round(projected) : null
}

async function readStoredLimits($: EngineInterface, now: number) {
  const saved = await $.store.get(LIMITS_KEY).catch(() => undefined)
  const readAt = (saved as { readAt?: unknown } | null | undefined)?.readAt
  const items = (saved as { items?: unknown } | null | undefined)?.items
  if (typeof readAt !== 'number' || !Array.isArray(items)) return null

  return {
    readAt,
    items: items.filter(isRateLimit).filter(limit => {
      const resetsAtMs = limit.resetsAt === null ? Number.NaN : Date.parse(limit.resetsAt)

      return Number.isNaN(resetsAtMs) || resetsAtMs > now
    }),
  }
}

async function readEstimatedTokens($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const total = usage?.context.breakdown?.totalTokens

  return typeof total === 'number' && total > 0 ? total : null
}

async function refreshLimits($: EngineInterface, rateLimits: SessionRateLimit[], now: number) {
  const current = await read($, limitsState)
  if (rateLimits.length > 0) {
    const items = rateLimits.map(limit => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
      resetsAt: limit.resetsAt ?? null,
    }))
    await $.store.set(LIMITS_KEY, { items, readAt: now })
    await update($, limitsState, () => ({ items, checkedAt: now, readAt: now, isStored: false }))

    return
  }

  if (!current.isStored && current.items.length > 0) {
    await update($, limitsState, held => ({ ...held, checkedAt: now }))

    return
  }

  const stored = await readStoredLimits($, now)
  await update($, limitsState, () => ({
    items: stored?.items ?? [],
    checkedAt: now,
    readAt: stored === null || stored.items.length === 0 ? null : stored.readAt,
    isStored: stored !== null && stored.items.length > 0,
  }))
}

export async function refreshUsage($: EngineInterface, isNewConversation = false) {
  const [{ context, rateLimits, cost }, now, known] = await Promise.all([
    $.session.usage(),
    $.clock.now(),
    read($, contextState),
  ])
  const heldTokens = isNewConversation || known.isEstimate ? null : known.tokens
  const transcriptTokens =
    context.tokens === undefined && heldTokens === null ? await readLastContextTokens($) : null
  const transcriptPercent =
    transcriptTokens === null || context.window <= 0 ? null : Math.round((transcriptTokens / context.window) * 100)
  const estimatedTokens =
    context.tokens === undefined && heldTokens === null && transcriptTokens === null
      ? await readEstimatedTokens($)
      : null
  const estimatedPercent =
    estimatedTokens === null || context.window <= 0 ? null : Math.round((estimatedTokens / context.window) * 100)
  await Promise.all([
    update($, contextState, current => {
      const isHeld = !isNewConversation && !current.isEstimate
      const tokens = context.tokens ?? (isHeld ? current.tokens : null) ?? transcriptTokens
      const isEstimate = tokens === null && estimatedTokens !== null

      return {
        tokens: tokens ?? estimatedTokens,
        window: context.window,
        percent:
          context.percent ??
          (isHeld ? current.percent : null) ??
          transcriptPercent ??
          (isEstimate ? estimatedPercent : null),
        usd: cost?.usd ?? null,
        isEstimate,
      }
    }),
    refreshLimits($, rateLimits, now),
  ])
}

export async function forgetContext($: EngineInterface) {
  await update($, contextState, current => ({ ...current, tokens: null, percent: null, isEstimate: false }))
}

export async function setContextTokens($: EngineInterface, contextTokens: number) {
  await update($, contextState, current => ({
    ...current,
    tokens: contextTokens,
    isEstimate: false,
    percent: current.window ? Math.round((contextTokens / current.window) * 100) : current.percent,
  }))
}

export async function readCheckedAt($: EngineInterface) {
  const limits = await read($, limitsState).then(shown(limitsState))

  return limits.checkedAt
}

export async function drawContext($: EngineInterface, e: PaneInput, thresholds: Thresholds): Promise<Block> {
  const { Box, Text } = $.ui.resolve(e)
  const context = await read($, contextState).then(shown(contextState))
  const details = await drawContextDetails($, e)
  const rows = 2 + (context.tokens !== null ? 1 : 0) + (context.usd !== null ? 1 : 0) + details.rows

  const element = (
    <Box flexDirection="column">
      <Text bold>Context</Text>
      {context.percent === null ? (
        <Text color="inactive">No usage yet</Text>
      ) : (
        <Box flexDirection="row" gap={1}>
          {drawBar($, e, context.percent, levelColor(context.percent, thresholds))}
          <Text color={levelColor(context.percent, thresholds)}>{`${context.isEstimate ? '~' : ''}${context.percent}%`}</Text>
        </Box>
      )}
      {context.tokens !== null && (
        <Text color="inactive">
          {`${context.isEstimate ? '~' : ''}${formatTokens(context.tokens)}${context.window === null ? '' : ` / ${formatTokens(context.window)}`} tokens`}
        </Text>
      )}
      {context.usd !== null && <Text color="inactive">{`${formatUsd(context.usd)} spent`}</Text>}
      {details.element}
    </Box>
  )

  return { element, rows }
}

export async function drawLimits($: EngineInterface, e: PaneInput): Promise<Block | null> {
  const { Box, Text } = $.ui.resolve(e)
  const [limits, cost] = await Promise.all([read($, limitsState).then(shown(limitsState)), readCostTotals($)])
  if (limits.items.length === 0 && cost.week <= 0) return null
  const rows = 1 + (cost.week > 0 ? 1 : 0) + limits.items.length

  const element = (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold>Usage</Text>
        {limits.isStored && limits.readAt !== null && (
          <Text color="inactive">{` · ${formatAgo(limits.readAt, limits.checkedAt)} ago`}</Text>
        )}
      </Box>
      {cost.week > 0 && (
        <Box key="cost-totals">
          <Text color="inactive">{`today ${formatUsd(cost.today)} · 7d ${formatUsd(cost.week)}`}</Text>
        </Box>
      )}
      {limits.items.map(limit => {
        const remaining = formatRemaining(limit.resetsAt, limits.checkedAt)
        const projected = projectedPercent(limit, limits.checkedAt)

        return (
          <Box key={limit.kind} flexDirection="row" gap={1}>
            <Text color="inactive">{RATE_LIMIT_LABELS[limit.kind] ?? truncate(limit.kind, RATE_LIMIT_LABEL_MAX)}</Text>
            {drawBar(
              $,
              e,
              limit.percentUsed,
              RATE_LIMIT_COLORS[limit.kind] ?? RATE_LIMIT_FALLBACK_COLOR,
              projected === null ? 0 : PACE_MARK_COLUMNS,
            )}
            <Text color={levelColor(limit.percentUsed)}>{`${Math.round(limit.percentUsed)}%`}</Text>
            {remaining !== null && <Text color="inactive">{remaining}</Text>}
            {projected !== null && <Text color={projected >= 100 ? 'error' : 'warning'}>{`▲ ${projected}%`}</Text>}
          </Box>
        )
      })}
    </Box>
  )

  return { element, rows }
}
