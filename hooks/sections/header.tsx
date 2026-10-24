import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { readGit } from '../data/git'
import { readTitles } from '../data/transcripts'
import { shown } from '../lib/lastShown'
import type { Block } from '../lib/layout'
import { currentTranscriptPath } from '../lib/paths'
import { fitGitRow, formatModel, truncate } from '../lib/text'
import { describeError } from '../lib/trace'
import { rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'

const NEW_SESSION_TITLE = 'New session'
const TITLE_MAX_LENGTH = 80

const titleState = atom({ plugin: 'session-cockpit', key: 'title' } as const, null)
const sessionTitleState = atom({ plugin: 'session-cockpit', key: 'sessionTitle' } as const, null)
const modelState = atom({ plugin: 'session-cockpit', key: 'model' } as const, { model: '', effort: null })
const turnActiveState = atom({ plugin: 'session-cockpit', key: 'turnActive' } as const, false)
const pickerOpenState = atom({ plugin: 'session-cockpit', key: 'isModelPickerOpen' } as const, false)

const MODEL_CHOICES = ['sonnet', 'opus', 'haiku', 'fable'] as const
const EFFORT_CHOICES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const PICKER_LOCKED_HINT = 'Unlocks when Claude is idle'
const MODEL_PER_ROW = MODEL_CHOICES.length
const EFFORT_PER_ROW = 3
const MODEL_BUTTON_RESERVED_COLUMNS = 11

const pickerChoiceRows = (choices: readonly string[], perRow: number) =>
  Array.from({ length: Math.ceil(choices.length / perRow) }, (_, row) => choices.slice(row * perRow, (row + 1) * perRow))

const EFFORT_REPLY = /effort level (?:set )?to (auto|low|medium|high|xhigh|max)\b/i

type PickerCommand = 'model' | 'effort'

export async function readCurrentTitle($: EngineInterface) {
  const [sessionTitle, title] = await Promise.all([read($, sessionTitleState), read($, titleState)])

  return sessionTitle ?? title ?? NEW_SESSION_TITLE
}

export async function titleFromPrompt($: EngineInterface, firstLine: string) {
  await update($, titleState, title => title ?? firstLine.slice(0, TITLE_MAX_LENGTH))
}

export async function resetTitles($: EngineInterface, sessionTitle: string | null) {
  await Promise.all([update($, titleState, () => null), update($, sessionTitleState, () => sessionTitle)])
}

export async function refreshSessionTitle($: EngineInterface) {
  const path = await currentTranscriptPath($)
  const title = (await readTitles($, [path])).get(path)
  if (title !== undefined) await update($, sessionTitleState, () => title)
}

export async function refreshModel($: EngineInterface) {
  const model = await $.session.model()
  await update($, modelState, current => ({ ...current, model }))
}

export async function setModel($: EngineInterface, model: string, stepEffort: string | null) {
  await update($, modelState, current => ({
    model,
    effort: current.effort === 'auto' && stepEffort !== null ? 'auto' : stepEffort,
  }))
}

export async function setEffortAfterCommand($: EngineInterface, args: string, reply: string | undefined) {
  const effort = reply
    ? reply.match(EFFORT_REPLY)?.[1]?.toLowerCase()
    : EFFORT_CHOICES.find(level => level === args.trim().toLowerCase())
  if (effort !== undefined) await update($, modelState, current => ({ ...current, effort }))
}

export async function setTurnActive($: EngineInterface, isActive: boolean) {
  await update($, turnActiveState, () => isActive)
}

async function toggleModelPicker($: EngineInterface) {
  await update($, pickerOpenState, isOpen => !isOpen)
}

async function pickModelOption($: EngineInterface, command: PickerCommand, args: string) {
  try {
    const { text } = await $.command.run({ command, args })
    await refreshModel($)
    if (command === 'effort') await setEffortAfterCommand($, args, text)
    if (text) $.ui.toast(text)
  } catch (error) {
    $.ui.toast(describeError(error))
  }
}

function drawPickerRow(
  $: EngineInterface,
  e: PaneInput,
  { label, command, choices, perRow, current, isLocked }: PickerRow,
) {
  const { Box, Button, Text } = $.ui.resolve(e)

  return (
    <Box flexDirection="row">
      <Box width={7} flexShrink={0}>
        <Text bold>{label}</Text>
      </Box>
      <Box flexDirection="column">
        {pickerChoiceRows(choices, perRow).map(row => (
          <Box key={`${command}-pick-row:${row[0]}`} flexDirection="row" gap={1}>
            {row.map(choice => {
              const isCurrent = choice === current
              const text = `${isCurrent ? '● ' : ''}${choice}`
              if (isLocked) return <Text key={`${command}-pick-${choice}`} bold={isCurrent} dimColor>{text}</Text>

              return (
                <Button key={`${command}-pick-${choice}`} plain onPress={() => void pickModelOption($, command, choice)}>
                  {isCurrent ? (
                    <Text color="inverseText" backgroundColor="claude" bold>{` ${text} `}</Text>
                  ) : (
                    <Text color="suggestion">{text}</Text>
                  )}
                </Button>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

type PickerRow = {
  label: string
  command: PickerCommand
  choices: readonly string[]
  perRow: number
  current: string | null
  isLocked: boolean
}

export async function drawHeader($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const [title, model, git, isPickerOpen, isLocked] = await Promise.all([
    readCurrentTitle($),
    read($, modelState).then(shown(modelState)),
    readGit($),
    read($, pickerOpenState),
    read($, turnActiveState),
  ])
  const currentAlias = MODEL_CHOICES.find(alias => model.model.includes(alias)) ?? null
  const width = rowWidth(e)
  const isPicking = model.model !== '' && isPickerOpen
  const gitTail = [...(git.ahead > 0 ? [`↑${git.ahead}`] : []), ...(git.behind > 0 ? [`↓${git.behind}`] : [])]
  const gitMark = git.isDirty ? '*' : ''
  const fitted = fitGitRow(git.project, git.branch, gitMark, gitTail, width)
  const pickerRows = isPicking
    ? pickerChoiceRows(MODEL_CHOICES, MODEL_PER_ROW).length +
      pickerChoiceRows(EFFORT_CHOICES, EFFORT_PER_ROW).length +
      (isLocked ? 1 : 0)
    : 0
  const rows = 1 + (model.model !== '' ? 1 : 0) + pickerRows + (git.project !== '' ? 1 : 0)

  const element = (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        {title}
      </Text>
      {model.model !== '' && (
        <Button key="model-picker-toggle" plain onPress={() => void toggleModelPicker($)}>
          <Text color="inactive">{isPickerOpen ? '▼ ' : '▶ '}</Text>
          <Text color="claude">{truncate(formatModel(model.model), width - MODEL_BUTTON_RESERVED_COLUMNS)}</Text>
          {model.effort !== null && <Text> </Text>}
          {model.effort !== null && <Text color="inactive">{`· ${model.effort}`}</Text>}
        </Button>
      )}
      {isPicking && (
        <Box flexDirection="column">
          {drawPickerRow($, e, { label: 'Model', command: 'model', choices: MODEL_CHOICES, perRow: MODEL_PER_ROW, current: currentAlias, isLocked })}
          {drawPickerRow($, e, { label: 'Effort', command: 'effort', choices: EFFORT_CHOICES, perRow: EFFORT_PER_ROW, current: model.effort, isLocked })}
          {isLocked && (
            <Text color="inactive" wrap="truncate-end">
              {PICKER_LOCKED_HINT}
            </Text>
          )}
        </Box>
      )}
      {git.project !== '' && (
        <Box flexDirection="row" gap={1}>
          <Text bold>{fitted.project}</Text>
          {fitted.branch !== null && <Text color="permission">{`${fitted.branch}${gitMark}`}</Text>}
          {git.ahead > 0 && <Text color="inactive">{`↑${git.ahead}`}</Text>}
          {git.behind > 0 && <Text color="inactive">{`↓${git.behind}`}</Text>}
        </Box>
      )}
    </Box>
  )

  return { element, rows }
}
