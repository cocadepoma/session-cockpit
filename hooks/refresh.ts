import type { EngineInterface } from 'claude-code'

import { publishAgents } from './data/agents'
import { forgetFiles, loadFiles } from './data/editedFiles'
import { refreshGit } from './data/git'
import { isMetaLoaded, refreshMeta } from './data/meta'
import { readRawSectionOpen, restoreSections } from './lib/lists'
import { isSidebarShown } from './lib/pane'
import { describeError, record, traced } from './lib/trace'
import { reconcileAgents, resetActivity, tickPane } from './sections/activity'
import { loadCostTotalsOnce, noteCostBaseline, refreshCostTotals, refreshCostTotalsIfShown } from './sections/cost'
import { refreshConversations } from './sections/conversations'
import { refreshBreakdown, resetMeasurement, restoreContextDetails } from './sections/contextDetails'
import { refreshModel, refreshSessionTitle, resetTitles, setTurnActive } from './sections/header'
import { startKeepAwakeTick, syncKeepAwake } from './sections/keepAwake'
import { loadLogo, syncLogo } from './sections/logo'
import { loadNotes, syncNotes } from './sections/notes'
import { forgetSessionReads, refreshOpenSessions } from './sections/sessions'
import { isSkillsLoaded, refreshSkills } from './sections/skills'
import { resetTodos } from './sections/todos'
import { refreshUsage } from './sections/usage'

const LIMITS_REFRESH_MS = 60_000
const SESSION_WATCH_MS = 1_000
const FILES_WATCH_MS = 3_000

let watchedSessionId: string | null = null
let isWatchRunning = false
let isFilesWatchRunning = false

async function restorePreferences($: EngineInterface) {
  await Promise.all([restoreSections($), restoreContextDetails($)])
}

const retryEmpty = async (name: string, run: () => Promise<string>) => {
  const detail = await run()
  if (!detail.startsWith('0 ')) record(`watch: ${name} recovered, ${detail}`)
}

export async function refreshAll($: EngineInterface, reason: string, isNewConversation = false) {
  const startedAt = Date.now()
  watchedSessionId = await $.session.id()
  forgetSessionReads()
  await Promise.all([
    traced('meta', () => refreshMeta($)),
    traced('usage', () => refreshUsage($, isNewConversation)),
    traced('model', () => refreshModel($)),
    traced('git', () => refreshGit($)),
    traced('skills', () => refreshSkills($)),
    traced('session title', () => refreshSessionTitle($)),
    traced('notes', () => loadNotes($)),
    traced('logo', () => loadLogo($)),
    traced('files', () => loadFiles($)),
    traced('sessions', () => refreshOpenSessions($)),
    traced('keep awake', () => syncKeepAwake($)),
    traced('preferences', () => restorePreferences($)),
  ])
  await traced('context breakdown', () => refreshBreakdown($))
  await traced('cost baseline', () => noteCostBaseline($))
  if (await readRawSectionOpen($, 'conversations')) await traced('conversations', () => refreshConversations($))
  record(`refreshAll (${reason}) session ${watchedSessionId} done in ${Date.now() - startedAt}ms`)
}

export async function resetConversation($: EngineInterface, sessionTitle: string | null) {
  await Promise.all([
    resetTitles($, sessionTitle),
    resetTodos($),
    forgetFiles($, watchedSessionId),
    resetMeasurement($),
    resetActivity($),
    setTurnActive($, false),
  ])
}

async function followSessionChange($: EngineInterface) {
  const id = await $.session.id()
  if (id === watchedSessionId) return false
  record(`watch: session changed ${watchedSessionId} -> ${id}`)
  await resetConversation($, null)
  await refreshAll($, 'session watch', true)

  return true
}

export async function watchSession($: EngineInterface, isShown = true) {
  if (isWatchRunning) return
  isWatchRunning = true
  try {
    if (await followSessionChange($)) return
    await publishAgents($)
    await reconcileAgents($)
    if (!isShown) return
    await tickPane($)
    await loadCostTotalsOnce($)
    if (!(await isSkillsLoaded($))) await retryEmpty('skills', () => refreshSkills($))
    if (!(await isMetaLoaded($))) await retryEmpty('meta', () => refreshMeta($))
    await syncNotes($)
    await syncLogo($)
    await refreshOpenSessions($)
    if (await readRawSectionOpen($, 'conversations')) await refreshConversations($)
  } catch (error) {
    record(`watch failed: ${describeError(error)}`)
  } finally {
    isWatchRunning = false
  }
}

export async function watchFiles($: EngineInterface) {
  if (isFilesWatchRunning) return
  isFilesWatchRunning = true
  try {
    await Promise.all([refreshGit($), loadFiles($)])
  } catch (error) {
    record(`files watch failed: ${describeError(error)}`)
  } finally {
    isFilesWatchRunning = false
  }
}

async function pollSession($: EngineInterface) {
  await watchSession($, await isSidebarShown($))
}

async function pollFiles($: EngineInterface) {
  if (await isSidebarShown($)) await watchFiles($)
}

export async function catchUpWatchers($: EngineInterface) {
  await Promise.all([watchSession($), watchFiles($), refreshCostTotals($)])
}

export function startWatchers($: EngineInterface) {
  $.clock.every(LIMITS_REFRESH_MS, () => void Promise.all([refreshUsage($), refreshCostTotalsIfShown($)]))
  $.clock.every(SESSION_WATCH_MS, () => void pollSession($))
  $.clock.every(FILES_WATCH_MS, () => void pollFiles($))
  startKeepAwakeTick($)
}
