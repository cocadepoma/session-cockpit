import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarConversation } from '../../types'
import { readTitles } from '../data/transcripts'
import { shown } from '../lib/lastShown'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import {
  filterList,
  listWindow,
  readListFilter,
  readListOffset,
  readSectionOpen,
  resetListOffset,
} from '../lib/lists'
import { TRANSCRIPT_EXTENSION, projectDirectory } from '../lib/paths'
import { formatAgo, truncate } from '../lib/text'
import { hasChanged } from '../lib/values'
import { drawFilter, drawFold, drawListScroller, rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'
import { readCurrentTitle } from './header'
import { readCheckedAt } from './usage'

const MAX_CONVERSATIONS = 50
const SESSION_TITLE_TTL_MS = 60_000

const conversationsState = atom({ plugin: 'session-cockpit', key: 'conversations' } as const, [])

const conversationTitleCache = new Map<string, { title: string | null; updatedAt: number; checkedAt: number }>()

const filterConversations = (conversations: SidebarConversation[], filter: string, currentTitle: string) =>
  filterList(conversations, filter, conversation => [conversation.isCurrent ? currentTitle : (conversation.title ?? '')])

async function readConversations($: EngineInterface) {
  return read($, conversationsState).then(shown(conversationsState))
}

async function readConversationMatches($: EngineInterface) {
  const [conversations, filter, currentTitle] = await Promise.all([
    readConversations($),
    readListFilter($, 'conversations'),
    readCurrentTitle($),
  ])

  return filterConversations(conversations, filter, currentTitle)
}

export async function countConversations($: EngineInterface) {
  return (await readConversationMatches($)).length
}

export async function refreshConversations($: EngineInterface) {
  const now = Date.now()
  const [directory, currentId] = await Promise.all([projectDirectory($), $.session.id()])
  const entries = await $.fs.list(directory).catch(() => [])
  const currentName = `${currentId}${TRANSCRIPT_EXTENSION}`
  const currentEntry = entries.find(entry => entry.kind === 'file' && entry.name === currentName)
  const recent = entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith(TRANSCRIPT_EXTENSION) && entry.name !== currentName)
    .sort((first, second) => second.mtimeMs - first.mtimeMs)
    .slice(0, MAX_CONVERSATIONS - 1)
    .map(entry => ({
      id: entry.name.slice(0, -TRANSCRIPT_EXTENSION.length),
      path: `${directory}/${entry.name}`,
      updatedAt: entry.mtimeMs,
    }))
  const stale = recent.filter(conversation => {
    const cached = conversationTitleCache.get(conversation.path)

    return (
      !cached || cached.updatedAt !== conversation.updatedAt || now - cached.checkedAt > SESSION_TITLE_TTL_MS
    )
  })
  const titles = await readTitles(
    $,
    stale.map(conversation => conversation.path),
  )
  for (const { path, updatedAt } of stale) {
    conversationTitleCache.set(path, { title: titles.get(path) ?? null, updatedAt, checkedAt: now })
  }
  const conversations = [
    { id: currentId, title: null, updatedAt: currentEntry?.mtimeMs ?? now, isCurrent: true },
    ...recent.map(({ id, path, updatedAt }) => ({
      id,
      title: conversationTitleCache.get(path)?.title ?? null,
      updatedAt,
      isCurrent: false,
    })),
  ]
  const current = await read($, conversationsState)
  if (hasChanged(current, conversations)) await update($, conversationsState, () => conversations)
}

async function openConversations($: EngineInterface) {
  await Promise.all([refreshConversations($), resetListOffset($, 'conversations')])
}

async function resumeConversation($: EngineInterface, id: string) {
  try {
    await $.command.run({ command: 'resume', args: id })
  } catch {
    await $.prompt.fill({ text: `/resume ${id}` })
  }
}

async function startConversation($: EngineInterface) {
  try {
    await $.command.run({ command: 'clear' })
  } catch {
    await $.prompt.fill({ text: '/clear' })
  }
}

export async function drawConversations($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const [conversations, filter, offset, isOpen, currentTitle, checkedAt] = await Promise.all([
    readConversations($),
    readListFilter($, 'conversations'),
    readListOffset($, 'conversations'),
    readSectionOpen($, 'conversations'),
    readCurrentTitle($),
    readCheckedAt($),
  ])
  const matching = filterConversations(conversations, filter, currentTitle)
  const { start, visible } = listWindow(matching, offset)
  const width = rowWidth(e)
  const filterRow = drawFilter($, e, {
    id: 'conversations',
    placeholder: 'Filter conversations…',
    submitLabel: 'resume',
    value: filter,
    onSubmit: () => {
      const first = matching.find(conversation => !conversation.isCurrent)
      if (first) void resumeConversation($, first.id)
    },
  })

  const element = (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        {drawFold($, e, { id: 'conversations', title: 'Conversations', isOpen, onOpen: () => openConversations($) })}
        <Button key="conversation-new" plain onPress={() => void startConversation($)}>
          <Text color="claude">+</Text>
          <Text color="text"> new</Text>
        </Button>
      </Box>
      {isOpen && (
        <Box flexDirection="column">
          {filterRow}
          {visible.map(conversation => {
            const ago = formatAgo(conversation.updatedAt, checkedAt)

            if (conversation.isCurrent) {
              return (
                <Box key={`conversation:${conversation.id}`} flexDirection="row">
                  <Text color="inactive">{`${ago.padStart(3)} `}</Text>
                  <Text bold>{truncate(currentTitle, width - 4)}</Text>
                </Box>
              )
            }

            return (
              <Button
                key={`conversation:${conversation.id}`}
                plain
                onPress={() => void resumeConversation($, conversation.id)}
              >
                <Text color="inactive">{`${ago.padStart(3)} `}</Text>
                <Text>{truncate(conversation.title ?? 'Untitled', width - 4)}</Text>
              </Button>
            )
          })}
          {drawListScroller($, e, 'conversations', { start, shown: visible.length, total: matching.length })}
          {matching.length === 0 && (
            <Text color="inactive">
              {conversations.length === 0 ? 'No other conversations' : 'No conversations match'}
            </Text>
          )}
        </Box>
      )}
    </Box>
  )

  return listBlock({
    id: 'conversations',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows: visible.length,
    total: matching.length,
    hasNotice: matching.length === 0,
  })
}
