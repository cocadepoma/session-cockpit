import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarSkill } from '../../types'
import { OWN_COMMAND } from '../lib/commands'
import { shown } from '../lib/lastShown'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import { listWindow, readListFilter, readListOffset, readSectionOpen, setListFilter } from '../lib/lists'
import { truncate } from '../lib/text'
import { drawFilter, drawFold, drawListScroller, rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'

const MIN_HINT_WIDTH = 6
const PICKABLE_COMMAND_SOURCES = new Set(['user', 'plugin'])

const skillsState = atom({ plugin: 'session-cockpit', key: 'skills' } as const, [])

const filterSkills = (skills: SidebarSkill[], filter: string) => {
  const query = filter.trim().toLowerCase()
  if (query === '') return skills
  const isNameMatch = (skill: SidebarSkill) => skill.name.toLowerCase().includes(query)

  return skills
    .filter(skill => isNameMatch(skill) || skill.description.toLowerCase().includes(query))
    .sort((first, second) => Number(!isNameMatch(first)) - Number(!isNameMatch(second)))
}

const skillRow = (skill: SidebarSkill, width: number) => {
  const name = truncate(`/${skill.name}`, width)
  const room = width - name.length - 1
  const hint = room >= MIN_HINT_WIDTH ? truncate(skill.description.replace(/\s+/g, ' ').trim(), room) : ''

  return { name, hint }
}

async function readSkills($: EngineInterface) {
  return read($, skillsState).then(shown(skillsState))
}

export async function countSkills($: EngineInterface) {
  const [skills, filter] = await Promise.all([readSkills($), readListFilter($, 'skills')])

  return filterSkills(skills, filter).length
}

export async function isSkillsLoaded($: EngineInterface) {
  return (await read($, skillsState)).length > 0
}

export async function refreshSkills($: EngineInterface) {
  const commands = await $.command.list()
  const skills = commands
    .filter(command => PICKABLE_COMMAND_SOURCES.has(command.source) && command.name !== OWN_COMMAND)
    .map(command => ({ name: command.name, description: command.description }))
  await update($, skillsState, () => skills)

  return `${skills.length} skills`
}

async function pickSkill($: EngineInterface, name: string) {
  await Promise.all([$.prompt.fill({ text: `/${name} ` }), setListFilter($, 'skills', '')])
}

export async function drawSkills($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const [skills, filter, offset, isOpen] = await Promise.all([
    readSkills($),
    readListFilter($, 'skills'),
    readListOffset($, 'skills'),
    readSectionOpen($, 'skills'),
  ])
  const matching = filterSkills(skills, filter)
  const { start, visible } = listWindow(matching, offset)
  const width = rowWidth(e)
  const filterRow = drawFilter($, e, {
    id: 'skills',
    placeholder: 'Filter skills…',
    submitLabel: 'use',
    value: filter,
    onSubmit: () => {
      const first = visible[0]
      if (first) void pickSkill($, first.name)
    },
  })

  const element = (
    <Box flexDirection="column">
      {drawFold($, e, {
        id: 'skills',
        title: 'Skills',
        isOpen,
        onOpen: () => refreshSkills($),
        suffix: <Text color="inactive">{skills.length === 0 ? '' : ` (${skills.length})`}</Text>,
      })}
      {isOpen && (
        <Box flexDirection="column">
          {filterRow}
          {visible.map(skill => {
            const { name, hint } = skillRow(skill, width)

            return (
              <Button key={`skill:${skill.name}`} plain onPress={() => void pickSkill($, skill.name)}>
                <Text color="suggestion">{name}</Text>
                <Text color="inactive">{hint === '' ? '' : ` ${hint}`}</Text>
              </Button>
            )
          })}
          {drawListScroller($, e, 'skills', { start, shown: visible.length, total: matching.length })}
          {matching.length === 0 && (
            <Text color="inactive">{skills.length === 0 ? 'Loading skills…' : 'No skills match'}</Text>
          )}
        </Box>
      )}
    </Box>
  )

  return listBlock({
    id: 'skills',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows: visible.length,
    total: matching.length,
    hasNotice: matching.length === 0,
  })
}
