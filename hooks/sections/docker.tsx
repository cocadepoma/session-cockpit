import type { EngineInterface } from 'claude-code'

import type {
  SidebarDocker,
  SidebarDockerAction,
  SidebarDockerContainer,
  SidebarDockerControl,
  SidebarDockerImage,
  SidebarDockerTab,
  SidebarDockerVolume,
} from '../../types'
import {
  containerTarget,
  imageLabel,
  imageTarget,
  isActiveContainer,
  isArmed,
  pressDockerAction,
  readDocker,
  readDockerControl,
  readDockerTab,
  refreshDocker,
  selectDockerTab,
  selectDockerTarget,
  volumeTarget,
} from '../data/docker'
import { filterList, listWindow, readListFilter, readListOffset, readSectionOpen, setListFilter } from '../lib/lists'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import { truncate } from '../lib/text'
import { ACTIVE_COLOR, SELECTED_MARK } from '../lib/theme'
import { SECTION_INDENT, drawFilter, drawFold, drawListScroller, rowWidth } from '../lib/view'
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
  { id: 'volumes', label: 'Volumes' },
]
const TAB_GAP = 2

const stateColor = (container: SidebarDockerContainer) =>
  container.state === 'running' ? 'success' : isActiveContainer(container) ? 'warning' : 'inactive'

const matchingContainers = (docker: SidebarDocker, filter: string) =>
  filterList(docker.containers, filter, container => [container.name, container.image])

const matchingImages = (docker: SidebarDocker, filter: string) => filterList(docker.images, filter, image => [imageLabel(image)])

const matchingVolumes = (docker: SidebarDocker, filter: string) => filterList(docker.volumes, filter, volume => [volume.name])

const matchingCount = (docker: SidebarDocker, tab: SidebarDockerTab, filter: string) =>
  tab === 'containers'
    ? matchingContainers(docker, filter).length
    : tab === 'images'
      ? matchingImages(docker, filter).length
      : matchingVolumes(docker, filter).length

const emptyText = (tab: SidebarDockerTab, hasItems: boolean) =>
  `No ${tab}${hasItems ? ' match' : ''}`

export async function countDocker($: EngineInterface) {
  const [docker, tab, filter] = await Promise.all([readDocker($), readDockerTab($), readListFilter($, 'docker')])
  if (docker.status !== 'ready') return 0

  return matchingCount(docker, tab, filter)
}

const tabsWidth = (labels: readonly string[], gap: number) => labels.join('').length + gap * (labels.length - 1)

// The tabs are counted as one row, so they tighten, then drop their counts, rather than wrap.
const fitTabs = (docker: SidebarDocker, width: number) => {
  const counts: Record<SidebarDockerTab, number | null> = {
    containers: docker.containers.length,
    images: docker.imagesReason === null ? docker.images.length : null,
    volumes: docker.volumesReason === null ? docker.volumes.length : null,
  }
  const counted = TABS.map(({ id, label }) => (counts[id] === null ? label : `${label} ${counts[id]}`))
  const plain = TABS.map(({ label }) => label)
  for (const [labels, gap] of [[counted, TAB_GAP], [counted, 1], [plain, TAB_GAP]] as const) {
    if (tabsWidth(labels, gap) <= width) return { labels, gap }
  }

  return { labels: plain, gap: 1 }
}

function drawTabs($: EngineInterface, e: PaneInput, docker: SidebarDocker, tab: SidebarDockerTab) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const { labels, gap } = fitTabs(docker, rowWidth(e))

  return (
    <Box key="docker-tabs" flexDirection="row" gap={gap}>
      {TABS.map(({ id }, index) => (
        <Button key={`docker-tab:${id}`} plain onPress={() => void selectDockerTab($, id)}>
          <Text bold={id === tab} color={id === tab ? ACTIVE_COLOR : 'inactive'}>{labels[index]}</Text>
        </Button>
      ))}
    </Box>
  )
}

const pendingOf = (control: SidebarDockerControl, target: string) =>
  control.pending.find(pending => pending.target === target)?.action ?? null

const hasActionRow = (control: SidebarDockerControl, target: string) =>
  control.selected === target && pendingOf(control, target) === null

type ActionsOptions = { target: string; actions: readonly ActionButton[]; control: SidebarDockerControl; now: number }

function drawActions($: EngineInterface, e: PaneInput, { target, actions, control, now }: ActionsOptions) {
  const { Box, Button, Text } = $.ui.resolve(e)

  return (
    <Box key={`docker-actions:${target}`} flexDirection="row" gap={2} paddingLeft={2}>
      {actions.map(({ key, label, action }) => {
        const isConfirming = key === 'delete' && isArmed(control, target, now)

        return (
          <Button key={`docker-${key}`} plain onPress={() => void pressDockerAction($, target, action)}>
            <Text color={isConfirming ? 'error' : 'suggestion'}>{isConfirming ? 'Confirm delete' : label}</Text>
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
  const isSelected = control.selected === target
  const shownDetail = pending === null ? detail : PENDING_TEXT[pending]
  const labelWidth = rowWidth(e) - shownDetail.length - (marker === undefined ? 1 : 3) - (isSelected ? 2 : 0)

  return (
    <Box key={`docker-row:${target}`} flexDirection="row" gap={1}>
      {isSelected && <Text color={ACTIVE_COLOR}>{SELECTED_MARK}</Text>}
      {marker}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Button key={`docker-${target}`} plain onPress={() => void selectDockerTarget($, target)}>
          <Text bold={isSelected} color={isSelected ? ACTIVE_COLOR : undefined}>
            {truncate(label, labelWidth)}
          </Text>
        </Button>
      </Box>
      <Text color={pending === null ? 'inactive' : 'warning'}>{shownDetail}</Text>
    </Box>
  )
}

function drawContainer($: EngineInterface, e: PaneInput, container: SidebarDockerContainer, control: SidebarDockerControl, now: number) {
  const { Text } = $.ui.resolve(e)
  const target = containerTarget(container)
  const marker = <Text color={stateColor(container)}>●</Text>
  const row = drawRow($, e, { target, label: container.name, detail: container.state, marker, control })
  const actions = isActiveContainer(container) ? RUNNING_ACTIONS : STOPPED_ACTIONS

  return hasActionRow(control, target) ? [row, drawActions($, e, { target, actions, control, now })] : [row]
}

function drawImage($: EngineInterface, e: PaneInput, image: SidebarDockerImage, control: SidebarDockerControl, now: number) {
  const target = imageTarget(image)
  const row = drawRow($, e, { target, label: imageLabel(image), detail: image.size, control })

  return hasActionRow(control, target) ? [row, drawActions($, e, { target, actions: IMAGE_ACTIONS, control, now })] : [row]
}

function drawVolume($: EngineInterface, e: PaneInput, volume: SidebarDockerVolume, control: SidebarDockerControl) {
  const target = volumeTarget(volume)

  return [drawRow($, e, { target, label: volume.name, detail: volume.isInUse ? 'in use' : 'unused', control })]
}

type TabList = { total: number; start: number; shown: number; actionRows: number; rows: JSX.Element[]; hasItems: boolean; reason: string | null }

type TabSource<T> = {
  matching: T[]
  all: readonly T[]
  reason: string | null
  targetOf: (item: T) => string
  draw: (item: T) => JSX.Element[]
}

function tabWindow<T>({ matching, all, reason, targetOf, draw }: TabSource<T>, offset: number, control: SidebarDockerControl): TabList {
  const { start, visible } = listWindow(matching, offset)

  return {
    total: matching.length,
    start,
    shown: visible.length,
    actionRows: visible.map(targetOf).filter(target => hasActionRow(control, target)).length,
    rows: visible.flatMap(draw),
    hasItems: all.length > 0,
    reason,
  }
}

type ListOptions = { filter: string; offset: number; control: SidebarDockerControl; now: number }

function drawTabList($: EngineInterface, e: PaneInput, docker: SidebarDocker, tab: SidebarDockerTab, options: ListOptions): TabList {
  const { filter, offset, control, now } = options
  if (tab === 'images') {
    const draw = (image: SidebarDockerImage) => drawImage($, e, image, control, now)
    const source = { matching: matchingImages(docker, filter), all: docker.images, reason: docker.imagesReason, targetOf: imageTarget, draw }

    return tabWindow(source, offset, control)
  }
  if (tab === 'volumes') {
    const draw = (volume: SidebarDockerVolume) => drawVolume($, e, volume, control)
    const source = { matching: matchingVolumes(docker, filter), all: docker.volumes, reason: docker.volumesReason, targetOf: volumeTarget, draw }

    return tabWindow(source, offset, control)
  }
  const draw = (container: SidebarDockerContainer) => drawContainer($, e, container, control, now)

  return tabWindow({ matching: matchingContainers(docker, filter), all: docker.containers, reason: null, targetOf: containerTarget, draw }, offset, control)
}

export async function drawDocker($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Text } = $.ui.resolve(e)
  const [docker, tab, control, filter, offset, isOpen, now] = await Promise.all([
    readDocker($),
    readDockerTab($),
    readDockerControl($),
    readListFilter($, 'docker'),
    readListOffset($, 'docker'),
    readSectionOpen($, 'docker'),
    $.clock.now(),
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
        {isOpen && (
          <Box key="docker-body" flexDirection="column" paddingLeft={SECTION_INDENT}>
            <Text color="inactive">{notice}</Text>
          </Box>
        )}
      </Box>
    )

    return listBlock({ id: 'docker', element, isOpen, hasFilter: false, windowRows: 0, total: 0, hasNotice: true })
  }
  const list = drawTabList($, e, docker, tab, { filter, offset, control, now })
  const { total } = list
  const emptyNotice = list.reason === null ? emptyText(tab, list.hasItems) : truncate(list.reason, rowWidth(e))
  const filterRow = drawFilter($, e, {
    id: 'docker',
    placeholder: `Filter ${tab}…`,
    submitLabel: 'clear',
    value: filter,
    onSubmit: () => void setListFilter($, 'docker', ''),
  })

  const element = (
    <Box flexDirection="column">
      {header}
      <Box key="docker-body" flexDirection="column" paddingLeft={SECTION_INDENT}>
        {drawTabs($, e, docker, tab)}
        {filterRow}
        {list.rows}
        {drawListScroller($, e, 'docker', { start: list.start, shown: list.shown, total })}
        {total === 0 && <Text color="inactive">{emptyNotice}</Text>}
      </Box>
    </Box>
  )

  return listBlock({
    id: 'docker',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows: list.shown + list.actionRows,
    total,
    hasNotice: total === 0,
    toolbarRows: TOOLBAR_ROWS,
  })
}
