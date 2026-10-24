import type { EngineInterface } from 'claude-code'

export const TRANSCRIPT_EXTENSION = '.jsonl'

export const isInside = (path: string, directory: string) => path.startsWith(`${directory}/`)

export const relativePath = (path: string, directory: string) =>
  directory !== '' && path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : path

export const homePath = (path: string, home: string | null) => {
  if (!home) return path
  if (path === home) return '~'

  return isInside(path, home) ? `~${path.slice(home.length)}` : path
}

export const baseName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

export const transcriptDirectory = (configDirectory: string, projectRoot: string) =>
  `${configDirectory}/projects/${projectRoot.replace(/[^a-zA-Z0-9]/g, '-')}`

export const transcriptPath = (configDirectory: string, projectRoot: string, sessionId: string) =>
  `${transcriptDirectory(configDirectory, projectRoot)}/${sessionId}${TRANSCRIPT_EXTENSION}`

export async function claudeConfigDirectory($: EngineInterface) {
  const [configDirectory, home] = await Promise.all([$.env.get('CLAUDE_CONFIG_DIR'), $.env.get('HOME')])

  return configDirectory ?? `${home ?? ''}/.claude`
}

export async function projectDirectory($: EngineInterface) {
  const [root, configDirectory] = await Promise.all([$.session.root(), claudeConfigDirectory($)])

  return transcriptDirectory(configDirectory, root)
}

export async function currentTranscriptPath($: EngineInterface) {
  const [configDirectory, root, id] = await Promise.all([claudeConfigDirectory($), $.session.root(), $.session.id()])

  return transcriptPath(configDirectory, root, id)
}
