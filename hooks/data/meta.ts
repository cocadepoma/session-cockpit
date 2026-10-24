import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { shown } from '../lib/lastShown'

const metaState = atom({ plugin: 'session-cockpit', key: 'meta' } as const, {
  cwd: '',
  home: null,
  version: '',
  mcpServers: [],
})

export async function readMeta($: EngineInterface) {
  return read($, metaState).then(shown(metaState))
}

export async function isMetaLoaded($: EngineInterface) {
  const meta = await read($, metaState)

  return meta.version !== '' && meta.mcpServers.length > 0
}

export async function refreshMeta($: EngineInterface) {
  const [cwd, home, { version }, tools] = await Promise.all([
    $.session.cwd(),
    $.env.get('HOME'),
    $.session.version(),
    $.tool.list(),
  ])
  const mcpServers = [
    ...new Set(tools.filter(tool => tool.mcp).map(tool => tool.name.split('__')[1] ?? tool.name)),
  ].sort()
  await update($, metaState, () => ({ cwd, home: home ?? null, version, mcpServers }))

  return `${mcpServers.length} mcp servers`
}
