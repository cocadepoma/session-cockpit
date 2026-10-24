import { LIST_WINDOW_ROWS } from './lists'
import type { ListId } from './lists'

const BLOCK_GAP = 1
const HEADER_ROWS = 1
const FILTER_ROWS = 1
const SCROLLER_ROWS = 1

type ListRows = { id: ListId; first: number; rows: number }

export type Block = { element: JSX.Element; rows: number; list?: ListRows }

type ListSpan = { id: ListId; top: number; rows: number }

type ListBlockOptions = {
  id: ListId
  element: JSX.Element
  isOpen: boolean
  hasFilter: boolean
  windowRows: number
  total: number
  hasNotice: boolean
}

export function listBlock({ id, element, isOpen, hasFilter, windowRows, total, hasNotice }: ListBlockOptions): Block {
  if (!isOpen) return { element, rows: HEADER_ROWS }
  const first = HEADER_ROWS + (hasFilter ? FILTER_ROWS : 0)
  const scroller = total > LIST_WINDOW_ROWS ? SCROLLER_ROWS : 0
  const rows = first + windowRows + scroller + (hasNotice ? 1 : 0)

  return { element, rows, ...(windowRows > 0 ? { list: { id, first, rows: windowRows } } : {}) }
}

export function stackBlocks(blocks: readonly (Block | null)[]): ListSpan[] {
  const spans: ListSpan[] = []
  let top = 0
  for (const block of blocks) {
    if (block === null) continue
    if (block.list) spans.push({ id: block.list.id, top: top + block.list.first, rows: block.list.rows })
    top += block.rows + BLOCK_GAP
  }

  return spans
}

export const listAtRow = (spans: readonly ListSpan[], row: number) =>
  spans.find(span => row >= span.top && row < span.top + span.rows)?.id ?? null
