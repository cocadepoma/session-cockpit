import type { EngineInterface } from 'claude-code'

import { DEBUG_ARGUMENT, LOGO_COMMAND, LOGO_FILE_ARGUMENT, NOTE_COMMAND, OWN_COMMAND } from '../lib/commands'
import { readSectionOpen } from '../lib/lists'
import { drawFold } from '../lib/view'
import type { PaneInput } from '../lib/view'

const HELP_ABOUT =
  'Session sidebar: title, model, context, usage, skills, conversations, notes, MCP, todos and keep awake.'
const HELP_COMMANDS = [
  { usage: `/${OWN_COMMAND}`, text: 'show or hide the sidebar' },
  { usage: `/${OWN_COMMAND} ${DEBUG_ARGUMENT}`, text: 'write the trace log' },
  { usage: `/${NOTE_COMMAND} [text]`, text: 'save text, selection or last reply' },
  { usage: `/${LOGO_COMMAND} [art]`, text: 'draw your ASCII art as the logo; bare restores the default' },
  { usage: `/${LOGO_COMMAND} ${LOGO_FILE_ARGUMENT} [path]`, text: 'load the logo from a file; default ~/.claude/session-cockpit/logo.ans' },
]
const HELP_GESTURES = [
  '▶ header: fold or unfold a section',
  'Wheel: list under pointer, then sidebar',
  'Skill: press to fill the prompt with it',
  'Conversation: press to resume it; the current one is listed first',
  '+ new: start a new conversation',
  'Note: press to copy it, ✕ deletes it',
  'Close mark: closes it; /sidebar reopens',
  'ctrl+x tab: focus the sidebar',
  'File: press to open its diff',
  'Esc: return focus, close the diff',
  'Filter box: type to narrow the list, Enter acts on the first match',
  'Model line (▶): press to pick a model or effort while Claude is idle; the highlighted option is the current one',
  '● Keep awake: pick 30m, 1h, 2h, 5h or ∞; press ● to stop',
  'Settings: press a row to show or hide that part; Activity starts hidden',
]
const HELP_LIMIT =
  "Files: repository changes and Claude's edits, then Other (outside the repository); outside git, only Claude's edits."
const HELP_KEEP_AWAKE_LIMIT =
  'Keep awake: idle only; a manual lock or closing the lid still locks. Unverified on some Linux desktops.'

export async function drawHelp($: EngineInterface, e: PaneInput) {
  const { Box, Text } = $.ui.resolve(e)
  const isOpen = await readSectionOpen($, 'help')

  return (
    <Box flexDirection="column">
      {drawFold($, e, { id: 'help', title: 'Help', isOpen })}
      {isOpen && (
        <Box flexDirection="column">
          <Text color="inactive" wrap="truncate-end">
            {HELP_ABOUT}
          </Text>
          <Text bold>Commands</Text>
          {HELP_COMMANDS.map(command => (
            <Box key={`help-command:${command.usage}`} flexDirection="row" gap={1}>
              <Text color="suggestion">{command.usage}</Text>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text color="inactive" wrap="truncate-end">
                  {command.text}
                </Text>
              </Box>
            </Box>
          ))}
          <Text bold>Gestures</Text>
          {HELP_GESTURES.map(gesture => (
            <Text color="inactive" wrap="truncate-end">
              {gesture}
            </Text>
          ))}
          <Text color="inactive" wrap="truncate-end">
            {HELP_LIMIT}
          </Text>
          <Text color="inactive" wrap="truncate-end">
            {HELP_KEEP_AWAKE_LIMIT}
          </Text>
        </Box>
      )}
    </Box>
  )
}
