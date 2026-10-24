import type { EngineInterface } from 'claude-code'

import { readSectionOpen } from '../lib/lists'
import { optionOf } from '../lib/settings'
import type { Settings, ToggleableSection } from '../lib/settings'
import { describeError, record } from '../lib/trace'
import { drawFold } from '../lib/view'
import type { PaneInput } from '../lib/view'

const PLUGIN = 'session-cockpit'

const SETTING_ROWS: readonly { id: ToggleableSection; label: string }[] = [
  { id: 'logo', label: 'Logo' },
  { id: 'keepAwake', label: 'Keep awake' },
  { id: 'context', label: 'Context' },
  { id: 'usage', label: 'Usage' },
  { id: 'skills', label: 'Skills' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' },
  { id: 'mcp', label: 'MCP' },
  { id: 'activity', label: 'Activity' },
  { id: 'todos', label: 'Todos' },
  { id: 'help', label: 'Help' },
]

async function changeSetting($: EngineInterface, id: ToggleableSection, label: string, isShown: boolean) {
  const field = optionOf(id)
  try {
    const rows = await $.config.list()
    const row = rows.find(
      candidate => candidate.provider.plugin.startsWith(PLUGIN) && (candidate.key === field || candidate.key.endsWith(`.${field}`)),
    )
    if (row === undefined) return $.ui.toast(`Could not change ${label}: no ${field} setting`)
    const { deny } = await $.config.set({ key: row.key, value: !isShown })
    if (deny !== undefined) $.ui.toast(`Could not change ${label}: ${deny}`)
  } catch (error) {
    record(`setting ${field} not changed: ${describeError(error)}`)
    $.ui.toast(`Could not change ${label}: ${describeError(error)}`)
  }
}

export async function drawSettings($: EngineInterface, e: PaneInput, settings: Settings) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const isOpen = await readSectionOpen($, 'settings')

  return (
    <Box flexDirection="column">
      {drawFold($, e, { id: 'settings', title: 'Settings', isOpen })}
      {isOpen && (
        <Box flexDirection="column">
          {SETTING_ROWS.map(({ id, label }) => {
            const isShown = settings.isShown(id)

            return (
              <Button key={`setting:${id}`} plain onPress={() => void changeSetting($, id, label, isShown)}>
                <Text>{label}</Text>
                <Text color={isShown ? 'success' : 'inactive'}>{isShown ? ' shown' : ' hidden'}</Text>
              </Button>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
