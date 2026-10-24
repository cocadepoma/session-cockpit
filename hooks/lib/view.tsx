import type { EngineInterface, RenderInput } from 'claude-code'

import { LIST_WINDOW_ROWS, lastListOffset, scrollList, setListFilter, toggleSection } from './lists'
import type { ListId, SectionId } from './lists'
import { DEFAULT_THRESHOLDS } from './settings'
import type { Thresholds } from './settings'

const BAR_GLYPH = '━'
const BAR_MIN_WIDTH = 6
const BAR_MAX_WIDTH = 24
const BAR_ROW_LABELS_WIDTH = 18
const PANE_PADDING = 2

export type PaneInput = RenderInput<'Pane'>

export const rowWidth = (e: PaneInput) => e.props.bodyColumns - PANE_PADDING

export const levelColor = (percent: number, thresholds: Thresholds = DEFAULT_THRESHOLDS) =>
  percent >= thresholds.critical ? 'error' : percent >= thresholds.warning ? 'warning' : 'success'

const barCells = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

  return { filled: BAR_GLYPH.repeat(filled), empty: BAR_GLYPH.repeat(width - filled) }
}

const barWidth = (columns: number) => Math.min(BAR_MAX_WIDTH, Math.max(BAR_MIN_WIDTH, columns - BAR_ROW_LABELS_WIDTH))

export function drawBar($: EngineInterface, e: PaneInput, percent: number, color: string, reservedColumns = 0) {
  const { Box, Text } = $.ui.resolve(e)
  const { filled, empty } = barCells(percent, barWidth(e.props.bodyColumns - reservedColumns))

  return (
    <Box flexDirection="row">
      <Text color={color}>{filled}</Text>
      <Text color="subtle">{empty}</Text>
    </Box>
  )
}

type FoldOptions = {
  id: SectionId
  title: string
  isOpen: boolean
  suffix?: JSX.Element | JSX.Element[]
  onOpen?: () => Promise<unknown>
}

async function foldSection($: EngineInterface, id: SectionId, onOpen?: () => Promise<unknown>) {
  if (await toggleSection($, id)) await onOpen?.()
}

export function drawFold($: EngineInterface, e: PaneInput, { id, title, isOpen, suffix, onOpen }: FoldOptions) {
  const { Button, Text } = $.ui.resolve(e)

  return (
    <Button key={`${id}-toggle`} plain onPress={() => void foldSection($, id, onOpen)}>
      {isOpen ? '▼' : '▶'} <Text bold>{title}</Text>
      {suffix}
    </Button>
  )
}

type FilterOptions = {
  id: ListId
  placeholder: string
  submitLabel: string
  value: string
  onSubmit: () => void
}

export function drawFilter($: EngineInterface, e: PaneInput, { id, placeholder, submitLabel, value, onSubmit }: FilterOptions) {
  const elements = $.ui.resolve(e)
  if (!('Input' in elements)) return null
  const { Input } = elements

  return (
    <Input
      key={`${id}-filter`}
      placeholder={placeholder}
      submitLabel={submitLabel}
      value={value}
      onInput={(next: string) => void setListFilter($, id, next)}
      onSubmit={onSubmit}
    />
  )
}

export function drawListScroller(
  $: EngineInterface,
  e: PaneInput,
  id: ListId,
  { start, shown, total }: { start: number; shown: number; total: number },
) {
  const { Box, Button, Text } = $.ui.resolve(e)
  if (total <= LIST_WINDOW_ROWS) return null

  return (
    <Box flexDirection="row" gap={1}>
      <Button key={`${id}-up`} plain onPress={() => void scrollList($, id, -LIST_WINDOW_ROWS, total)}>
        <Text color={start > 0 ? 'text' : 'subtle'}>▲</Text>
      </Button>
      <Button key={`${id}-down`} plain onPress={() => void scrollList($, id, LIST_WINDOW_ROWS, total)}>
        <Text color={start < lastListOffset(total) ? 'text' : 'subtle'}>▼</Text>
      </Button>
      <Text color="inactive">{`${start + 1}–${start + shown} of ${total}`}</Text>
    </Box>
  )
}
