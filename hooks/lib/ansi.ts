export type AnsiStyle = {
  color?: string
  backgroundColor?: string
  bold?: true
  dimColor?: true
  italic?: true
  underline?: true
  inverse?: true
  strikethrough?: true
}

export type AnsiSegment = { text: string; style: AnsiStyle }

const SGR = /\u001b?\[([\d;]*)m/g
const BASIC_COLORS = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
]
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255]

const cubeLevel = (step: number) => CUBE_LEVELS[step] ?? 0
const SWITCHES: Record<number, keyof AnsiStyle> = {
  1: 'bold',
  2: 'dimColor',
  3: 'italic',
  4: 'underline',
  7: 'inverse',
  9: 'strikethrough',
}
const CLEARS: Record<number, (keyof AnsiStyle)[]> = {
  22: ['bold', 'dimColor'],
  23: ['italic'],
  24: ['underline'],
  27: ['inverse'],
  29: ['strikethrough'],
  39: ['color'],
  49: ['backgroundColor'],
}

const isByte = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= 255

const hex = (red: number, green: number, blue: number) =>
  `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`

function paletteColor(index: number) {
  if (index < 16) return BASIC_COLORS[index] ?? BASIC_COLORS[0]
  if (index >= 232) {
    const grey = 8 + 10 * (index - 232)

    return hex(grey, grey, grey)
  }
  const cube = index - 16

  return hex(cubeLevel(Math.floor(cube / 36)), cubeLevel(Math.floor(cube / 6) % 6), cubeLevel(cube % 6))
}

function without(style: AnsiStyle, keys: (keyof AnsiStyle)[]) {
  const next = { ...style }
  for (const key of keys) delete next[key]

  return next
}

function applyCodes(style: AnsiStyle, params: string) {
  const codes = params === '' ? [0] : params.split(';').map(code => (code === '' ? 0 : Number(code)))
  let next = style
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index] ?? 0
    const switched = SWITCHES[code]
    const cleared = CLEARS[code]
    if (code === 0) next = {}
    else if (switched) next = { ...next, [switched]: true }
    else if (cleared) next = without(next, cleared)
    else if (code >= 30 && code <= 37) next = { ...next, color: paletteColor(code - 30) }
    else if (code >= 90 && code <= 97) next = { ...next, color: paletteColor(code - 90 + 8) }
    else if (code >= 40 && code <= 47) next = { ...next, backgroundColor: paletteColor(code - 40) }
    else if (code >= 100 && code <= 107) next = { ...next, backgroundColor: paletteColor(code - 100 + 8) }
    else if (code === 38 || code === 48) {
      const target = code === 38 ? 'color' : 'backgroundColor'
      const mode = codes[index + 1]
      if (mode === 5) {
        const paletteIndex = codes[index + 2]
        if (isByte(paletteIndex)) next = { ...next, [target]: paletteColor(paletteIndex) }
        index += 2
      } else if (mode === 2) {
        const [red, green, blue] = codes.slice(index + 2, index + 5)
        if (isByte(red) && isByte(green) && isByte(blue)) next = { ...next, [target]: hex(red, green, blue) }
        index += 4
      }
    }
  }

  return next
}

export const hasAnsiCodes = (text: string) => new RegExp(SGR.source).test(text)

export const stripAnsiCodes = (text: string) => text.replace(SGR, '')

export function parseAnsiLines(text: string) {
  let style: AnsiStyle = {}

  return text.split('\n').map(line => {
    const segments: AnsiSegment[] = []
    let cursor = 0
    for (const match of line.matchAll(SGR)) {
      if (match.index > cursor) segments.push({ text: line.slice(cursor, match.index), style })
      style = applyCodes(style, match[1] ?? '')
      cursor = match.index + match[0].length
    }
    if (cursor < line.length) segments.push({ text: line.slice(cursor), style })

    return segments
  })
}
