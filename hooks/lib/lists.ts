import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { flip, remember, shown } from './lastShown'
import { storedFlag } from './values'

export const LIST_WINDOW_ROWS = 8

export type ListId = 'skills' | 'sessions' | 'conversations' | 'notes' | 'files' | 'mcp'

export type SectionId = ListId | 'help' | 'settings'

export const SECTION_IDS: readonly SectionId[] = ['skills', 'sessions', 'conversations', 'notes', 'files', 'mcp', 'help', 'settings']

const OPEN_BY_DEFAULT: ReadonlySet<SectionId> = new Set(['mcp', 'sessions'])

export const filterList = <T,>(items: T[], filter: string, textsOf: (item: T) => string[]) => {
  const query = filter.trim().toLowerCase()
  if (query === '') return items

  return items.filter(item => textsOf(item).some(text => text.toLowerCase().includes(query)))
}

export const lastListOffset = (count: number) => Math.max(0, count - LIST_WINDOW_ROWS)

export const moveListOffset = (offset: number, by: number, count: number) =>
  Math.min(lastListOffset(count), Math.max(0, offset + by))

export const listWindow = <T,>(matches: T[], offset: number) => {
  const start = Math.min(offset, lastListOffset(matches.length))

  return { start, visible: matches.slice(start, start + LIST_WINDOW_ROWS) }
}

export const canMoveWindow = (offset: number, by: number, count: number) =>
  count > LIST_WINDOW_ROWS && (by > 0 ? offset < lastListOffset(count) : offset > 0)

export async function readListFilter($: EngineInterface, id: ListId) {
  return read($, atom({ plugin: 'session-cockpit', key: 'listFilter', id } as const, ''))
}

export async function readListOffset($: EngineInterface, id: ListId) {
  return read($, atom({ plugin: 'session-cockpit', key: 'listOffset', id } as const, 0))
}

export async function resetListOffset($: EngineInterface, id: ListId) {
  await update($, atom({ plugin: 'session-cockpit', key: 'listOffset', id } as const, 0), () => 0)
}

export async function setListFilter($: EngineInterface, id: ListId, filter: string) {
  await Promise.all([
    update($, atom({ plugin: 'session-cockpit', key: 'listFilter', id } as const, ''), () => filter),
    resetListOffset($, id),
  ])
}

export async function scrollList($: EngineInterface, id: ListId, by: number, count: number) {
  await update($, atom({ plugin: 'session-cockpit', key: 'listOffset', id } as const, 0), offset =>
    moveListOffset(offset, by, count),
  )
}

export async function canListMove($: EngineInterface, id: ListId, by: number, count: number) {
  return canMoveWindow(await readListOffset($, id), by, count)
}

export async function readSectionOpen($: EngineInterface, id: SectionId) {
  const open = atom({ plugin: 'session-cockpit', key: 'isSectionOpen', id } as const, OPEN_BY_DEFAULT.has(id))

  return read($, open).then(shown(open))
}

export async function readRawSectionOpen($: EngineInterface, id: SectionId) {
  return read($, atom({ plugin: 'session-cockpit', key: 'isSectionOpen', id } as const, OPEN_BY_DEFAULT.has(id)))
}

export async function toggleSection($: EngineInterface, id: SectionId) {
  const open = atom({ plugin: 'session-cockpit', key: 'isSectionOpen', id } as const, OPEN_BY_DEFAULT.has(id))
  const isOpen = flip(open, await read($, open))
  await Promise.all([update($, open, () => isOpen), $.store.set(`${id}Open`, isOpen)])

  return isOpen
}

export async function openSection($: EngineInterface, id: SectionId) {
  const open = atom({ plugin: 'session-cockpit', key: 'isSectionOpen', id } as const, OPEN_BY_DEFAULT.has(id))
  await Promise.all([update($, open, () => remember(open, true)), $.store.set(`${id}Open`, true)])
}

async function restoreSection($: EngineInterface, id: SectionId, stored: unknown) {
  const open = atom({ plugin: 'session-cockpit', key: 'isSectionOpen', id } as const, OPEN_BY_DEFAULT.has(id))
  await update($, open, current => storedFlag(stored, current))
}

export async function restoreSections($: EngineInterface) {
  const stored = await Promise.all(SECTION_IDS.map(id => $.store.get(`${id}Open`)))
  await Promise.all(SECTION_IDS.map((id, index) => restoreSection($, id, stored[index])))
}
