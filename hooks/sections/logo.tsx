import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarLogo } from '../../types'
import { hasAnsiCodes, parseAnsiLines, stripAnsiCodes } from '../lib/ansi'
import { LOGO_COMMAND, LOGO_FILE_ARGUMENT } from '../lib/commands'
import type { Block } from '../lib/layout'
import { claudeConfigDirectory } from '../lib/paths'
import { shown } from '../lib/lastShown'
import { guarded } from '../lib/trace'
import { rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'
import { BANNER, BANNER_WIDTH } from './logoArt'
import type { BannerTone } from './logoArt'

const OLD_BANNER_KEY = 'banner'
const LOGO_KEY = 'logo'
const LOGO_MAX_LINES = 40
const LOGO_DEFAULT_FILE = 'session-cockpit/logo.ans'
const NON_COLOUR_ESCAPE = /\u001b(?!\[[\d;]*m)/
const FILE_ARGUMENT = new RegExp(`^${LOGO_FILE_ARGUMENT}(?:\\s+(.*))?$`, 's')
const BANNER_COLORS: Record<BannerTone, string> = { accent: 'claude', name: 'permission' }
const ART_COLOR = 'claude'
const ANSI_DEFAULT_COLOR = 'text'

const logoState = atom({ plugin: 'session-cockpit', key: 'logo' } as const, { art: null } as SidebarLogo)

const columnsOf = (line: string) => [...stripAnsiCodes(line)].length

const artWidth = (lines: string[]) => Math.max(0, ...lines.map(columnsOf))

function normalizeArt(pasted: string) {
  const lines = pasted.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd())
  const first = lines.findIndex(line => line !== '')
  if (first === -1) return []
  const last = lines.findLastIndex(line => line !== '')
  const kept = lines.slice(first, last + 1)
  const indent = Math.min(...kept.filter(line => line !== '').map(line => columnsOf(line) - columnsOf(line.trimStart())))

  return kept.map(line => line.slice(indent))
}

export async function forgetStoredLogo($: EngineInterface) {
  await guarded('old logo flag', () => $.store.delete(OLD_BANNER_KEY))
}

async function readSavedArt($: EngineInterface) {
  const saved = await $.store.get(LOGO_KEY)

  return typeof saved === 'string' && saved !== '' ? saved : null
}

export async function loadLogo($: EngineInterface) {
  const art = await readSavedArt($)
  await update($, logoState, () => ({ art }))

  return art === null ? 'default logo' : 'custom logo'
}

export async function syncLogo($: EngineInterface) {
  const [art, held] = await Promise.all([readSavedArt($), read($, logoState)])
  if (art !== held.art) await update($, logoState, () => ({ art }))
}

export async function registerLogoCommand($: EngineInterface) {
  await $.command.register({
    name: LOGO_COMMAND,
    description: 'Draw your own ASCII art as the sidebar logo; bare /logo restores the default',
    argumentHint: `[art | ${LOGO_FILE_ARGUMENT} [path]]`,
    immediate: true,
  })
}

function fileArgument(args: string) {
  const match = FILE_ARGUMENT.exec(args.trim())

  return match ? (match[1] ?? '').trim() : null
}

async function logoFilePath($: EngineInterface, requested: string) {
  if (requested === '') return `${await claudeConfigDirectory($)}/${LOGO_DEFAULT_FILE}`
  if (requested === '~' || requested.startsWith('~/')) return `${(await $.env.get('HOME')) ?? ''}${requested.slice(1)}`

  return requested
}

async function loadLogoFile($: EngineInterface, requested: string) {
  const path = await logoFilePath($, requested)
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return { text: `Logo not loaded: cannot read ${path}.` }
  }
  if (NON_COLOUR_ESCAPE.test(text)) {
    return { text: `Logo not loaded: ${path} has escape codes other than colours.` }
  }
  const lines = normalizeArt(text)
  if (lines.length === 0) return { text: `Logo not loaded: ${path} is empty.` }
  if (lines.length > LOGO_MAX_LINES) {
    return { text: `Logo not loaded: it has ${lines.length} lines, at most ${LOGO_MAX_LINES} fit.` }
  }

  return saveLogo($, lines)
}

async function saveLogo($: EngineInterface, lines: string[]) {
  const art = lines.join('\n')
  await $.store.set(LOGO_KEY, art)
  await update($, logoState, () => ({ art }))

  return { text: `Logo saved: ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}, ${artWidth(lines)} columns wide.` }
}

export async function runLogoCommand($: EngineInterface, args: string) {
  const requested = fileArgument(args)
  if (requested !== null) return loadLogoFile($, requested)

  const lines = normalizeArt(args)
  if (lines.length > LOGO_MAX_LINES) {
    return { text: `Logo not saved: it has ${lines.length} lines, at most ${LOGO_MAX_LINES} fit.` }
  }
  if (lines.length === 0) {
    await $.store.delete(LOGO_KEY)
    await update($, logoState, () => ({ art: null }))

    return { text: 'Logo reset to the default.' }
  }

  return saveLogo($, lines)
}

export async function drawLogo($: EngineInterface, e: PaneInput): Promise<Block | null> {
  const { Box, Text } = $.ui.resolve(e)
  const { art } = await read($, logoState).then(shown(logoState))

  if (art === null) {
    if (rowWidth(e) < BANNER_WIDTH) return null

    const element = (
      <Box flexDirection="column" alignItems="center">
        <Box flexDirection="column">
          {BANNER.map((segments, row) => (
            <Box key={`banner:${row}`} flexDirection="row">
              {segments.map(([text, tone]) => (
                <Text color={BANNER_COLORS[tone]}>{text}</Text>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    )

    return { element, rows: BANNER.length }
  }

  if (rowWidth(e) < artWidth(art.split('\n'))) return null
  const defaultColor = hasAnsiCodes(art) ? ANSI_DEFAULT_COLOR : ART_COLOR
  const lines = parseAnsiLines(art)

  const element = (
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column">
        {lines.map((segments, row) => (
          <Box key={`logo:${row}`} flexDirection="row">
            {segments.length === 0 ? (
              <Text color={defaultColor}> </Text>
            ) : (
              segments.map(({ text, style }) => (
                <Text {...style} color={style.color ?? defaultColor}>
                  {text}
                </Text>
              ))
            )}
          </Box>
        ))}
      </Box>
    </Box>
  )

  return { element, rows: lines.length }
}
