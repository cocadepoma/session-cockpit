import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface } from 'claude-code'

import type { SidebarNote } from '../../types'
import { NOTE_COMMAND } from '../lib/commands'
import { shown } from '../lib/lastShown'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import {
  filterList,
  listWindow,
  openSection,
  readListFilter,
  readListOffset,
  readSectionOpen,
  resetListOffset,
} from '../lib/lists'
import { firstLine, truncate } from '../lib/text'
import { drawFilter, drawFold, drawListScroller, rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'

const NOTES_KEY = 'notes'
const MAX_NOTES = 200
const NOTE_MAX_LENGTH = 20_000
const NOTE_PREVIEW_LENGTH = 60

const notesState = atom({ plugin: 'session-cockpit', key: 'notes' } as const, [])

const isNote = (value: unknown): value is SidebarNote =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SidebarNote).id === 'string' &&
  typeof (value as SidebarNote).text === 'string' &&
  typeof (value as SidebarNote).createdAt === 'number'

const filterNotes = (notes: SidebarNote[], filter: string) => filterList(notes, filter, note => [note.text])

async function readNotes($: EngineInterface) {
  return read($, notesState).then(shown(notesState))
}

export async function countNotes($: EngineInterface) {
  const [notes, filter] = await Promise.all([readNotes($), readListFilter($, 'notes')])

  return filterNotes(notes, filter).length
}

async function readSavedNotes($: EngineInterface) {
  const saved = await $.store.get(NOTES_KEY)

  return Array.isArray(saved) ? saved.filter(isNote) : []
}

export async function loadNotes($: EngineInterface) {
  const notes = await readSavedNotes($)
  await update($, notesState, () => notes)

  return `${notes.length} notes`
}

export async function syncNotes($: EngineInterface) {
  const [saved, held] = await Promise.all([readSavedNotes($), read($, notesState)])
  const isSame = saved.length === held.length && saved.every((note, index) => note.id === held[index]?.id)
  if (!isSame) await update($, notesState, () => saved)
}

async function saveNotes($: EngineInterface, change: (notes: SidebarNote[]) => SidebarNote[]) {
  const notes = change(await readSavedNotes($))
  await $.store.set(NOTES_KEY, notes)
  await update($, notesState, () => notes)
}

async function lastAssistantReply($: EngineInterface) {
  const messages = await $.session.messages()
  const reply = [...messages].reverse().find(message => message.role === 'assistant' && message.text.trim() !== '')

  return reply?.text.trim() ?? null
}

async function addNote($: EngineInterface, typed: string) {
  const selected = typed === '' ? (await $.ui.selection().catch(() => undefined))?.text.trim() : undefined
  const text = typed || selected || (await lastAssistantReply($))
  if (!text) return null
  const createdAt = await $.clock.now()
  const note: SidebarNote = {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    text: text.slice(0, NOTE_MAX_LENGTH),
    createdAt,
  }
  await saveNotes($, notes => [note, ...notes].slice(0, MAX_NOTES))
  await Promise.all([openSection($, 'notes'), resetListOffset($, 'notes')])

  return note
}

async function deleteNote($: EngineInterface, id: string) {
  await saveNotes($, notes => notes.filter(note => note.id !== id))
}

async function copyNote($: EngineInterface, note: SidebarNote, surface: RenderSurface) {
  const copied = await $.ui.copy({ text: note.text, surface })
  $.ui.toast(copied.isCopied ? 'Note copied' : `Could not copy the note: ${copied.reason}`)
}

async function openNotes($: EngineInterface) {
  await Promise.all([syncNotes($), resetListOffset($, 'notes')])
}

export async function registerNoteCommand($: EngineInterface) {
  await $.command.register({
    name: NOTE_COMMAND,
    description: 'Save the selected text, or the last reply, to the sidebar notes',
    argumentHint: '[text]',
    immediate: true,
  })
}

export async function runNoteCommand($: EngineInterface, args: string) {
  const note = await addNote($, args.trim())
  if (!note) return { text: 'Nothing to save: select some text first.' }

  return { text: `Saved to notes: ${truncate(firstLine(note.text), NOTE_PREVIEW_LENGTH)}` }
}

export async function drawNotes($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const [notes, filter, offset, isOpen] = await Promise.all([
    readNotes($),
    readListFilter($, 'notes'),
    readListOffset($, 'notes'),
    readSectionOpen($, 'notes'),
  ])
  const matching = filterNotes(notes, filter)
  const { start, visible } = listWindow(matching, offset)
  const width = rowWidth(e)
  const filterRow = drawFilter($, e, {
    id: 'notes',
    placeholder: 'Filter notes…',
    submitLabel: 'copy',
    value: filter,
    onSubmit: () => {
      const first = matching[0]
      if (first) void copyNote($, first, e.surface)
    },
  })

  const element = (
    <Box flexDirection="column">
      {drawFold($, e, {
        id: 'notes',
        title: 'Notes',
        isOpen,
        onOpen: () => openNotes($),
        suffix: <Text color="inactive">{notes.length === 0 ? '' : ` (${notes.length})`}</Text>,
      })}
      {isOpen && (
        <Box flexDirection="column">
          {filterRow}
          {visible.map(note => (
            <Box key={`note-row:${note.id}`} flexDirection="row" gap={1}>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Button key={`note:${note.id}`} plain onPress={press => void copyNote($, note, press.surface)}>
                  <Text>{truncate(firstLine(note.text), width - 2)}</Text>
                </Button>
              </Box>
              <Button key={`note-delete:${note.id}`} plain onPress={() => void deleteNote($, note.id)}>
                <Text color="inactive">✕</Text>
              </Button>
            </Box>
          ))}
          {drawListScroller($, e, 'notes', { start, shown: visible.length, total: matching.length })}
          {matching.length === 0 && (
            <Text color="inactive">{notes.length === 0 ? 'Select text, then /note' : 'No notes match'}</Text>
          )}
        </Box>
      )}
    </Box>
  )

  return listBlock({
    id: 'notes',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows: visible.length,
    total: matching.length,
    hasNotice: matching.length === 0,
  })
}
