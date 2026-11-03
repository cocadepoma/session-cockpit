import type { EngineInterface } from 'claude-code'

import type {
  SidebarDocker,
  SidebarDockerAction,
  SidebarDockerContainer,
  SidebarDockerControl,
  SidebarDockerImage,
  SidebarDockerTab,
} from '../../types'
import {
  containerTarget,
  imageLabel,
  imageTarget,
  isActiveContainer,
  pressDockerAction,
  readDocker,
  readDockerControl,
  readDockerTab,
  refreshDocker,
  selectDockerTab,
  selectDockerTarget,
} from '../data/docker'
import { filterList, listWindow, readListFilter, readListOffset, readSectionOpen, setListFilter } from '../lib/lists'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import { truncate } from '../lib/text'
import { drawFilter, drawFold, drawListScroller, rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'

const TOOLBAR_ROWS = 1
const CHECKING_TEXT = 'Checking Docker…'

const PENDING_TEXT: Record<SidebarDockerAction, string> = {
  restart: 'restarting…',
  stop: 'stopping…',
  start: 'starting…',
  rm: 'deleting…',
  rmi: 'deleting…',
}

type ActionButton = { key: string; label: string; action: SidebarDockerAction }

const RUNNING_ACTIONS: readonly ActionButton[] = [
  { key: 'restart', label: 'Restart', action: 'restart' },
  { key: 'stop', label: 'Stop', action: 'stop' },
]

const STOPPED_ACTIONS: readonly ActionButton[] = [
  { key: 'start', label: 'Start', action: 'start' },
  { key: 'delete', label: 'Delete', action: 'rm' },
]

const IMAGE_ACTIONS: readonly ActionButton[] = [{ key: 'delete', label: 'Delete', action: 'rmi' }]

const TABS: readonly { id: SidebarDockerTab; label: string }[] = [
  { id: 'containers', label: 'Containers' },
  { id: 'images', label: 'Images' },
]

const stateColor = (container: SidebarDockerContainer) =>
  container.state === 'running' ? 'success' : isActiveContainer(container) ? 'warning' : 'inactive'

const matchingContainers = (docker: SidebarDocker, filter: string) =>
  filterList(docker.containers, filter, container => [container.name, container.image])

const matchingImages = (docker: SidebarDocker, filter: string) => filterList(docker.images, filter, image => [imageLabel(image)])

const emptyText = (tab: SidebarDockerTab, hasItems: boolean) =>
  `No ${tab}${hasItems ? ' match' : ''}`

export async function countDocker($: EngineInterface) {
  const [docker, tab, filter] = await Promise.all([readDocker($), readDockerTab($), readListFilter($, 'docker')])
  if (docker.status !== 'ready') return 0

  return tab === 'containers' ? matchingContainers(docker, filter).length : matchingImages(docker, filter).length
}

function drawTabs($: EngineInterface, e: PaneInput, docker: SidebarDocker, tab: SidebarDockerTab) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const counts: Record<SidebarDockerTab, number> = { containers: docker.containers.length, images: docker.images.length }

  return (
    <Box flexDirection="row" gap={2}>
      {TABS.map(({ id, label }) => (
        <Button key={`docker-tab:${id}`} plain onPress={() => void selectDockerTab($, id)}>
          <Text bold={id === tab} color={id === tab ? 'text' : 'inactive'}>{`${label} ${counts[id]}`}</Text>
        </Button>
      ))}
    </Box>
  )
}

const pendingOf = (control: SidebarDockerControl, target: string) =>
  control.pending.find(pending => pending.target === target)?.action ?? null

const hasActionRow = (control: SidebarDockerControl, target: string) =>
  control.selected === target && pendingOf(control, target) === null

function drawActions($: EngineInterface, e: PaneInput, target: string, actions: readonly ActionButton[], control: SidebarDockerControl) {
  const { Box, Button, Text } = $.ui.resolve(e)

  return (
    <Box key={`docker-actions:${target}`} flexDirection="row" gap={2} paddingLeft={2}>
      {actions.map(({ key, label, action }) => {
        const isArmed = control.armed === target && key === 'delete'

        return (
          <Button key={`docker-${key}`} plain onPress={() => void pressDockerAction($, target, action)}>
            <Text color={isArmed ? 'error' : 'suggestion'}>{isArmed ? 'Confirm delete' : label}</Text>
          </Button>
        )
      })}
    </Box>
  )
}

type RowOptions = { target: string; label: string; detail: string; marker?: JSX.Element; control: SidebarDockerControl }

function drawRow($: EngineInterface, e: PaneInput, { target, label, detail, marker, control }: RowOptions) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const pending = pendingOf(control, target)
  const shownDetail = pending === null ? detail : PENDING_TEXT[pending]
  const labelWidth = rowWidth(e) - shownDetail.length - (marker === undefined ? 1 : 3)

  return (
    <Box key={`docker-row:${target}`} flexDirection="row" gap={1}>
      {marker}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Button key={`docker-${target}`} plain onPress={() => void selectDockerTarget($, target)}>
          <Text bold={control.selected === target}>{truncate(label, labelWidth)}</Text>
        </Button>
      </Box>
      <Text color={pending === null ? 'inactive' : 'warning'}>{shownDetail}</Text>
    </Box>
  )
}

function drawContainer($: EngineInterface, e: PaneInput, container: SidebarDockerContainer, control: SidebarDockerControl) {
  const { Text } = $.ui.resolve(e)
  const target = containerTarget(container)
  const marker = <Text color={stateColor(container)}>●</Text>
  const row = drawRow($, e, { target, label: container.name, detail: container.state, marker, control })
  const actions = isActiveContainer(container) ? RUNNING_ACTIONS : STOPPED_ACTIONS

  return hasActionRow(control, target) ? [row, drawActions($, e, target, actions, control)] : [row]
}

function drawImage($: EngineInterface, e: PaneInput, image: SidebarDockerImage, control: SidebarDockerControl) {
  const target = imageTarget(image)
  const row = drawRow($, e, { target, label: imageLabel(image), detail: image.size, control })

  return hasActionRow(control, target) ? [row, drawActions($, e, target, IMAGE_ACTIONS, control)] : [row]
}

export async function drawDocker($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Text } = $.ui.resolve(e)
  const [docker, tab, control, filter, offset, isOpen] = await Promise.all([
    readDocker($),
    readDockerTab($),
    readDockerControl($),
    readListFilter($, 'docker'),
    readListOffset($, 'docker'),
    readSectionOpen($, 'docker'),
  ])
  const isReady = docker.status === 'ready'
  const runningCount = docker.containers.filter(isActiveContainer).length
  const header = drawFold($, e, {
    id: 'docker',
    title: 'Docker',
    isOpen,
    onOpen: () => refreshDocker($),
    ...(isOpen && isReady
      ? { suffix: <Text color="inactive">{` (${runningCount}/${docker.containers.length} running)`}</Text> }
      : {}),
  })
  if (!isOpen || !isReady) {
    const notice = docker.status === 'unknown' ? CHECKING_TEXT : truncate(docker.reason ?? '', rowWidth(e))
    const element = (
      <Box flexDirection="column">
        {header}
        {isOpen && <Text color="inactive">{notice}</Text>}
      </Box>
    )

    return listBlock({ id: 'docker', element, isOpen, hasFilter: false, windowRows: 0, total: 0, hasNotice: true })
  }
  const containers = matchingContainers(docker, filter)
  const images = matchingImages(docker, filter)
  const total = tab === 'containers' ? containers.length : images.length
  const hasItems = tab === 'containers' ? docker.containers.length > 0 : docker.images.length > 0
  const containerWindow = listWindow(containers, offset)
  const imageWindow = listWindow(images, offset)
  const start = tab === 'containers' ? containerWindow.start : imageWindow.start
  const shownCount = tab === 'containers' ? containerWindow.visible.length : imageWindow.visible.length
  const shownTargets =
    tab === 'containers' ? containerWindow.visible.map(containerTarget) : imageWindow.visible.map(imageTarget)
  const actionRows = shownTargets.filter(target => hasActionRow(control, target)).length
  const filterRow = drawFilter($, e, {
    id: 'docker',
    placeholder: tab === 'containers' ? 'Filter containers…' : 'Filter images…',
    submitLabel: 'clear',
    value: filter,
    onSubmit: () => void setListFilter($, 'docker', ''),
  })

  const element = (
    <Box flexDirection="column">
      {header}
      {drawTabs($, e, docker, tab)}
      {filterRow}
      {tab === 'containers'
        ? containerWindow.visible.flatMap(container => drawContainer($, e, container, control))
        : imageWindow.visible.flatMap(image => drawImage($, e, image, control))}
      {drawListScroller($, e, 'docker', { start, shown: shownCount, total })}
      {total === 0 && <Text color="inactive">{emptyText(tab, hasItems)}</Text>}
    </Box>
  )

  return listBlock({
    id: 'docker',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows: shownCount + actionRows,
    total,
    hasNotice: total === 0,
    toolbarRows: TOOLBAR_ROWS,
  })
}
