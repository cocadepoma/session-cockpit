import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarCostTotals } from '../../types'
import { SESSION_ID_PATTERN } from '../data/snapshots'
import { isSidebarShown } from '../lib/pane'
import { claudeConfigDirectory } from '../lib/paths'
import { PROCESS_TIMEOUT_MS } from '../lib/process'
import { describeError, record } from '../lib/trace'

const COST_DIRECTORY = 'session-cockpit/cost'
const JSON_EXTENSION = '.json'
const WEEK_DAYS = 7
const KEEP_DAYS = 8

const INITIAL_TOTALS = { today: 0, week: 0, isLoaded: false }

const totalsState = atom({ plugin: 'session-cockpit', key: 'costTotals' } as const, INITIAL_TOTALS)

type Ledger = { days: Record<string, number>; lastUsd: number | null; seenAt: number | null }

let queue: Promise<unknown> = Promise.resolve()

const costPath = (configDirectory: string, sessionId: string) =>
  `${configDirectory}/${COST_DIRECTORY}/${sessionId}${JSON_EXTENSION}`

const pad = (value: number) => String(value).padStart(2, '0')

const dayKey = (now: number, daysBefore = 0) => {
  const today = new Date(now)
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBefore)

  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

const parseLedger = (text: string): Ledger | null => {
  const parsed = JSON.parse(text) as { days?: unknown; lastUsd?: unknown; seenAt?: unknown }
  if (typeof parsed.days !== 'object' || parsed.days === null) return null
  const days: Record<string, number> = {}
  for (const [key, usd] of Object.entries(parsed.days)) {
    const value = amount(usd)
    if (value !== null) days[key] = value
  }

  return { days, lastUsd: amount(parsed.lastUsd), seenAt: amount(parsed.seenAt) }
}

async function readLedger($: EngineInterface, path: string) {
  if (!(await $.fs.exists(path))) return null

  return $.fs.read(path).then(parseLedger).catch(() => null)
}

async function readLedgers($: EngineInterface, configDirectory: string) {
  const directory = `${configDirectory}/${COST_DIRECTORY}`
  const entries = await $.fs.list(directory).catch(() => [])
  const ledgers = await Promise.all(
    entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith(JSON_EXTENSION))
      .map(async entry => {
        try {
          const ledger = parseLedger(await $.fs.read(`${directory}/${entry.name}`))

          return ledger === null ? null : { sessionId: entry.name.slice(0, -JSON_EXTENSION.length), ...ledger }
        } catch {
          return null
        }
      }),
  )

  return ledgers.filter(ledger => ledger !== null)
}

export async function refreshCostTotals($: EngineInterface) {
  try {
    const [configDirectory, now] = await Promise.all([claudeConfigDirectory($), $.clock.now()])
    const ledgers = await readLedgers($, configDirectory)
    const week = Array.from({ length: WEEK_DAYS }, (_, daysBefore) => dayKey(now, daysBefore))
    const today = dayKey(now)
    const totals = { today: 0, week: 0, isLoaded: true }
    for (const { days } of ledgers) {
      totals.today += days[today] ?? 0
      totals.week += week.reduce((sum, key) => sum + (days[key] ?? 0), 0)
    }
    await update($, totalsState, current =>
      current.isLoaded && current.today === totals.today && current.week === totals.week ? current : totals,
    )
  } catch (error) {
    record(`cost totals not read: ${describeError(error)}`)
  }
}

export async function loadCostTotalsOnce($: EngineInterface) {
  if (!(await read($, totalsState)).isLoaded) await refreshCostTotals($)
}

export async function refreshCostTotalsIfShown($: EngineInterface) {
  if (await isSidebarShown($)) await refreshCostTotals($)
}

function serialised(run: () => Promise<void>) {
  const next = queue.then(run, run).catch((error: unknown) => {
    record(`cost not recorded: ${describeError(error)}`)
  })
  queue = next

  return next
}

async function writeLedger($: EngineInterface, path: string, sessionId: string, ledger: Ledger, now: number) {
  await $.fs.write(path, JSON.stringify({ sessionId, days: ledger.days, lastUsd: ledger.lastUsd, seenAt: now }))
}

export function noteCostBaseline($: EngineInterface) {
  return serialised(async () => {
    const [usage, configDirectory, sessionId, now] = await Promise.all([
      $.session.usage(),
      claudeConfigDirectory($),
      $.session.id(),
      $.clock.now(),
    ])
    const usd = usage.cost?.usd
    if (usd === undefined || !SESSION_ID_PATTERN.test(sessionId)) return
    const path = costPath(configDirectory, sessionId)
    if ((await readLedger($, path)) !== null) return
    await writeLedger($, path, sessionId, { days: {}, lastUsd: usd, seenAt: null }, now)
  })
}

export function recordCost($: EngineInterface, isMainLoop: boolean) {
  return serialised(async () => {
    const [usage, configDirectory, sessionId, now] = await Promise.all([
      $.session.usage(),
      claudeConfigDirectory($),
      $.session.id(),
      $.clock.now(),
    ])
    const usd = usage.cost?.usd
    if (usd === undefined || !SESSION_ID_PATTERN.test(sessionId)) return
    const path = costPath(configDirectory, sessionId)
    const known = await readLedger($, path)
    const lastUsd = known?.lastUsd ?? null
    const days = known?.days ?? {}
    const delta = lastUsd === null ? 0 : usd < lastUsd ? usd : usd - lastUsd
    if (delta > 0) {
      const today = dayKey(now)
      days[today] = (days[today] ?? 0) + delta
    }
    if (known === null || lastUsd !== usd) await writeLedger($, path, sessionId, { days, lastUsd: usd, seenAt: null }, now)
    if (isMainLoop) await refreshCostTotalsIfShown($)
  })
}

export async function pruneCost($: EngineInterface) {
  try {
    const [configDirectory, now] = await Promise.all([claudeConfigDirectory($), $.clock.now()])
    const oldest = dayKey(now, KEEP_DAYS)
    const expired = (await readLedgers($, configDirectory)).filter(({ sessionId, days, seenAt }) => {
      const newest = Object.keys(days).sort().at(-1) ?? (seenAt === null ? undefined : dayKey(seenAt))

      return SESSION_ID_PATTERN.test(sessionId) && newest !== undefined && newest < oldest
    })
    await Promise.all(
      expired.map(({ sessionId }) =>
        $.process
          .run(['rm', '-f', '--', costPath(configDirectory, sessionId)], { timeoutMs: PROCESS_TIMEOUT_MS })
          .catch(() => null),
      ),
    )
    record(`pruned ${expired.length} cost files`)
  } catch (error) {
    record(`cost files not pruned: ${describeError(error)}`)
  }
}

export async function readCostTotals($: EngineInterface): Promise<SidebarCostTotals> {
  return read($, totalsState)
}
