import type { EngineInterface } from 'claude-code'

export const PANE = 'sidebar'

export async function isSidebarShown($: EngineInterface) {
  const panes = await $.ui.panes().catch(() => [])

  return panes.some(pane => pane.id === PANE && pane.isShown)
}
