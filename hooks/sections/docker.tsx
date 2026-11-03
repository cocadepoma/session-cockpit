import type { EngineInterface } from 'claude-code'

import type { SidebarDocker, SidebarDockerContainer, SidebarDockerImage, SidebarDockerTab } from '../../types'
import {
  imageKey,
  imageLabel,
  isActiveContainer,
  readDocker,
  readDockerTab,
  refreshDocker,
  selectDockerTab,
} from '../data/docker'
import { filterList, listWindow, readListFilter, readListOffset, readSectionOpen, setListFilter } from '../lib/lists'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import { truncate } from '../lib/text'
import { drawFilter, drawFold, drawListScroller, rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'

const TOOLBAR_ROWS = 1
const CHECKING_TEXT = 'Checking Docker…'

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

function drawContainer($: EngineInterface, e: PaneInput, container: SidebarDockerContainer) {
  const { Box, Text } = $.ui.resolve(e)
  const nameWidth = rowWidth(e) - container.state.length - 3

  return (
    <Box key={`docker-container-row:${container.id}`} flexDirection="row" gap={1}>
      <Text color={stateColor(container)}>●</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text>{truncate(container.name, nameWidth)}</Text>
      </Box>
      <Text color="inactive">{container.state}</Text>
    </Box>
  )
}

function drawImage($: EngineInterface, e: PaneInput, image: SidebarDockerImage) {
  const { Box, Text } = $.ui.resolve(e)
  const labelWidth = rowWidth(e) - image.size.length - 1

  return (
    <Box key={`docker-image-row:${imageKey(image)}`} flexDirection="row" gap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text>{truncate(imageLabel(image), labelWidth)}</Text>
      </Box>
      <Text color="inactive">{image.size}</Text>
    </Box>
  )
}

export async function drawDocker($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Text } = $.ui.resolve(e)
  const [docker, tab, filter, offset, isOpen] = await Promise.all([
    readDocker($),
    readDockerTab($),
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
        ? containerWindow.visible.map(container => drawContainer($, e, container))
        : imageWindow.visible.map(image => drawImage($, e, image))}
      {drawListScroller($, e, 'docker', { start, shown: shownCount, total })}
      {total === 0 && <Text color="inactive">{emptyText(tab, hasItems)}</Text>}
    </Box>
  )

  return listBlock({
    id: 'docker',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows: shownCount,
    total,
    hasNotice: total === 0,
    toolbarRows: TOOLBAR_ROWS,
  })
}
