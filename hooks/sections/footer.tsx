import type { EngineInterface } from 'claude-code'

import { readMeta } from '../data/meta'
import { homePath } from '../lib/paths'
import type { PaneInput } from '../lib/view'

export async function drawFooter($: EngineInterface, e: PaneInput) {
  const { Box, Text } = $.ui.resolve(e)
  const meta = await readMeta($)

  return (
    <Box flexDirection="column">
      <Text color="inactive" wrap="truncate-start">
        {homePath(meta.cwd, meta.home)}
      </Text>
      <Box flexDirection="row" gap={1}>
        <Text color="success">•</Text>
        <Text bold>Claude Code</Text>
        <Text color="inactive">{meta.version}</Text>
      </Box>
    </Box>
  )
}
