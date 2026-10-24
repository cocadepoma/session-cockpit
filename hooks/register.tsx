import type { Register } from 'claude-code'

import type { SidebarTodo } from '../types'
import { forgetAgents, pruneAgents, publishAgents } from './data/agents'
import { recordEdit } from './data/editedFiles'
import { refreshGit } from './data/git'
import { refreshMeta } from './data/meta'
import { captureBaseline, pruneSnapshots } from './data/snapshots'
import { LOGO_COMMAND, NOTE_COMMAND, OWN_COMMAND } from './lib/commands'
import { isSidebarShown, PANE } from './lib/pane'
import { readSettings } from './lib/settings'
import { describeError, guarded, record } from './lib/trace'
import { refreshAll, resetConversation, startWatchers } from './refresh'
import { refreshSessionTitle, setEffortAfterCommand, setModel, setTurnActive, titleFromPrompt } from './sections/header'
import { forgetStoredLogo, registerLogoCommand, runLogoCommand } from './sections/logo'
import { registerNoteCommand, runNoteCommand } from './sections/notes'
import { appendTodo, changeTodo, replaceTodos } from './sections/todos'
import { pruneCost, recordCost } from './sections/cost'
import { dropEndedToolRows, finishActivity, startAgentActivity, startToolActivity } from './sections/activity'
import { refreshBreakdown } from './sections/contextDetails'
import { forgetContext, refreshUsage, setContextTokens } from './sections/usage'
import {
  canPaneMove,
  drawPane,
  isInVsCode,
  isSidebarWanted,
  openSidebar,
  registerSidebarCommand,
  rememberPaneOffset,
  rememberSidebarClosed,
  runSidebarCommand,
  scrollFirstMovableList,
  scrollListUnderPointer,
} from './sidebar'

export const register: Register = (on, options) => {
  const settings = readSettings(options)
  const isActivityOn = settings.isShown('activity')

  on('session.start', async ($, e, next) => {
    record('session.start')
    await registerSidebarCommand($)
    await registerNoteCommand($)
    await registerLogoCommand($)
    await forgetStoredLogo($)
    await refreshAll($, 'session.start')
    startWatchers($)
    await pruneSnapshots($)
    await pruneAgents($)
    await pruneCost($)
    if ((await isSidebarWanted($)) && !(await isInVsCode($, e.surface))) void openSidebar($, false)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await forgetAgents($, e.sessionId)

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'startup') return next(e)
    record(`classic.SessionStart ${e.source}${e.context_tokens === undefined ? '' : ` ${e.context_tokens} tokens`}`)
    await Promise.all([
      e.source === 'compact' ? undefined : resetConversation($, e.session_title ?? null),
      forgetContext($),
    ])
    await refreshAll($, `classic.SessionStart ${e.source}`)
    const contextTokens = e.context_tokens
    if (contextTokens !== undefined) await setContextTokens($, contextTokens)

    return next(e)
  })

  on('command.run', { command: OWN_COMMAND }, ($, e) => runSidebarCommand($, e.args.trim()))

  on('command.run', { command: NOTE_COMMAND }, ($, e) => runNoteCommand($, e.args))

  on('command.run', { command: LOGO_COMMAND }, ($, e) => runLogoCommand($, e.args))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await rememberSidebarClosed($)

    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { value: undefined }))

  on('prompt.submit', async ($, e, next) => {
    const firstLine = e.text.trim().split('\n')[0]?.trim()
    if (firstLine && !e.isMeta && !e.command) await titleFromPrompt($, firstLine)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await setTurnActive($, true)

    return started
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    await setEffortAfterCommand($, e.args, result.text)

    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    await setModel($, e.model, e.effort === undefined ? null : String(e.effort))

    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const agentId = spawned.agentId
    if (isActivityOn && agentId !== undefined) {
      await guarded('agent activity', () => startAgentActivity($, agentId, e.subagentType, e.description))
    }
    await publishAgents($)

    return spawned
  })

  on('tool.call', async ($, e, next) => {
    const activityId = isActivityOn ? ((await guarded('tool activity start', () => startToolActivity($, e))) ?? null) : null
    const ran = await next(e).catch(async (error: unknown) => {
      if (activityId !== null) await guarded('tool activity finish', () => finishActivity($, activityId, true))
      throw error
    })
    await Promise.all([
      refreshUsage($),
      activityId === null
        ? undefined
        : guarded('tool activity finish', () =>
            finishActivity($, activityId, ran.deny !== undefined || ran.isError === true),
          ),
    ])

    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) await replaceTodos($, e.todos)

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const { id, subject } = ran.result.task
      const created: SidebarTodo = { id, content: subject, status: 'pending' }
      await appendTodo($, created)
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && ran.result.success) {
      await changeTodo($, e.taskId, e.subject, e.status)
    }

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const baseline = await captureBaseline($, e.file_path)
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && !ran.result.staged) await recordEdit($, e.file_path, baseline)

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const baseline = await captureBaseline($, e.file_path)
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) await recordEdit($, e.file_path, baseline)

    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const baseline = await captureBaseline($, e.notebook_path)
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && ran.result.error === undefined) {
      await recordEdit($, e.notebook_path, baseline)
    }

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (await isSidebarShown($)) {
      await refreshGit($).catch(error => record(`git refresh after Bash failed: ${describeError(error)}`))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const isFailure = e.isAborted || e.reason === 'error' || e.reason === 'refusal'
    await Promise.all([
      refreshUsage($),
      refreshMeta($),
      refreshGit($),
      refreshSessionTitle($),
      publishAgents($),
      recordCost($, agentId === undefined),
      !isActivityOn
        ? undefined
        : agentId === undefined
          ? guarded('ended tool rows', () => dropEndedToolRows($))
          : guarded('agent activity finish', () => finishActivity($, agentId, isFailure)),
      agentId === undefined ? guarded('context breakdown', () => refreshBreakdown($)) : undefined,
      agentId === undefined ? setTurnActive($, false) : undefined,
    ])

    return next(e)
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.pointer === undefined) {
      if (!canPaneMove(e.by, e.contentRows, e.bodyRows) && (await scrollFirstMovableList($, e.by, settings))) return {}
    } else if (await scrollListUnderPointer($, e.pointer.row, e.by)) {
      return {}
    }
    const result = await next(e)
    if (result.deny === undefined) rememberPaneOffset(e.offset)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e, settings))
}
