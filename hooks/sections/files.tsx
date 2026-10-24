import type { EngineInterface } from 'claude-code'

import type { SidebarFile, SidebarGit, SidebarMeta } from '../../types'
import { readEditedFiles } from '../data/editedFiles'
import { isRepositoryPath, readGit, readGitFiles } from '../data/git'
import { readMeta } from '../data/meta'
import {
  filterList,
  listWindow,
  readListFilter,
  readListOffset,
  readSectionOpen,
  resetListOffset,
} from '../lib/lists'
import { baseName, homePath, isInside, relativePath } from '../lib/paths'
import { truncate, truncateStart } from '../lib/text'
import { listBlock } from '../lib/layout'
import type { Block } from '../lib/layout'
import { drawFilter, drawFold, drawListScroller, rowWidth } from '../lib/view'
import type { PaneInput } from '../lib/view'
import { openDiff } from './diff'

const mergeFiles = (session: SidebarFile[], git: SidebarFile[]) => [
  ...session,
  ...git.filter(file => !session.some(known => known.path === file.path)),
]

const groupFiles = (files: SidebarFile[], root: string | null) => {
  if (root === null) return { ordered: files, repositoryCount: 0 }
  const repository = files.filter(file => isInside(file.path, root))
  const other = files.filter(file => !isInside(file.path, root))

  return { ordered: [...repository, ...other], repositoryCount: repository.length }
}

const shownFilePath = (file: SidebarFile, git: SidebarGit, meta: SidebarMeta) =>
  git.root === null
    ? relativePath(file.path, meta.cwd)
    : isRepositoryPath(file.path, git.root)
      ? relativePath(file.path, git.root)
      : homePath(file.path, meta.home)

const filterFiles = (files: SidebarFile[], filter: string, git: SidebarGit, meta: SidebarMeta) =>
  groupFiles(
    filterList(files, filter, file => [shownFilePath(file, git, meta)]),
    git.root,
  )

async function readFileMatches($: EngineInterface) {
  const [session, gitFiles, git, meta, filter] = await Promise.all([
    readEditedFiles($),
    readGitFiles($),
    readGit($),
    readMeta($),
    readListFilter($, 'files'),
  ])

  return filterFiles(mergeFiles(session, gitFiles), filter, git, meta)
}

export async function countFiles($: EngineInterface) {
  return (await readFileMatches($)).ordered.length
}

export async function drawFiles($: EngineInterface, e: PaneInput): Promise<Block> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const [session, gitFiles, git, meta, filter, offset, isOpen] = await Promise.all([
    readEditedFiles($),
    readGitFiles($),
    readGit($),
    readMeta($),
    readListFilter($, 'files'),
    readListOffset($, 'files'),
    readSectionOpen($, 'files'),
  ])
  const allFiles = mergeFiles(session, gitFiles)
  const { ordered: files, repositoryCount } = filterFiles(allFiles, filter, git, meta)
  const { start, visible } = listWindow(files, offset)
  const width = rowWidth(e)
  const totalAdded = allFiles.reduce((sum, file) => sum + file.added, 0)
  const totalRemoved = allFiles.reduce((sum, file) => sum + file.removed, 0)
  const isGroupStartAt = (index: number) =>
    git.root !== null &&
    (index === 0 ||
      isRepositoryPath(visible[index - 1]?.path ?? '', git.root) !== isRepositoryPath(visible[index]?.path ?? '', git.root))
  const windowRows = visible.length + visible.filter((_, index) => isGroupStartAt(index)).length
  const filterRow = drawFilter($, e, {
    id: 'files',
    placeholder: 'Filter files…',
    submitLabel: 'open',
    value: filter,
    onSubmit: () => {
      const first = files[0]
      if (first) void openDiff($, first.path)
    },
  })

  const element = (
    <Box flexDirection="column">
      {drawFold($, e, {
        id: 'files',
        title: 'Files',
        isOpen,
        onOpen: () => resetListOffset($, 'files'),
        suffix:
          allFiles.length === 0
            ? [<Text key="files-count" color="inactive" />]
            : [
                <Text key="files-count" color="inactive">{` (${allFiles.length})`}</Text>,
                <Text key="files-added" color="success">{` +${totalAdded}`}</Text>,
                <Text key="files-removed" color="error">{` -${totalRemoved}`}</Text>,
              ],
      })}
      {isOpen && (
        <Box flexDirection="column">
          {filterRow}
          {visible.flatMap((file, index) => {
            const counts = `+${file.added} -${file.removed}`
            const isRepositoryFile = isRepositoryPath(file.path, git.root)
            const isGroupStart = isGroupStartAt(index)

            return [
              isGroupStart && git.root !== null && (
                <Text key={`files-group:${isRepositoryFile ? 'repo' : 'other'}`} color="inactive">
                  {truncate(
                    isRepositoryFile
                      ? `${baseName(git.root)} (${repositoryCount})`
                      : `Other (${files.length - repositoryCount})`,
                    width,
                  )}
                </Text>
              ),
              <Box key={`file-row:${file.path}`} flexDirection="row" gap={1}>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Button key={`file:${file.path}`} plain onPress={() => void openDiff($, file.path)}>
                    <Text>{truncateStart(shownFilePath(file, git, meta), width - counts.length - 1)}</Text>
                  </Button>
                </Box>
                <Text color="success">{`+${file.added}`}</Text>
                <Text color="error">{`-${file.removed}`}</Text>
              </Box>,
            ]
          })}
          {drawListScroller($, e, 'files', { start, shown: visible.length, total: files.length })}
          {files.length === 0 && (
            <Text color="inactive">{allFiles.length === 0 ? 'No files changed yet' : 'No files match'}</Text>
          )}
        </Box>
      )}
    </Box>
  )

  return listBlock({
    id: 'files',
    element,
    isOpen,
    hasFilter: filterRow !== null,
    windowRows,
    total: files.length,
    hasNotice: files.length === 0,
  })
}
