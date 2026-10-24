import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SidebarTodo, SidebarTodoStatus } from '../../types'
import type { PaneInput } from '../lib/view'

const MAX_TODOS = 12
const TODO_MARKS: Record<SidebarTodoStatus, { mark: string; color: string }> = {
  completed: { mark: '[✓]', color: 'success' },
  in_progress: { mark: '[•]', color: 'warning' },
  pending: { mark: '[ ]', color: 'inactive' },
}

const todosState = atom({ plugin: 'session-cockpit', key: 'todos' } as const, [])

export async function resetTodos($: EngineInterface) {
  await update($, todosState, () => [])
}

export async function replaceTodos($: EngineInterface, todos: { content: string; status: SidebarTodoStatus }[]) {
  await update($, todosState, () =>
    todos.map((todo, index) => ({ id: String(index), content: todo.content, status: todo.status })),
  )
}

export async function appendTodo($: EngineInterface, created: SidebarTodo) {
  await update($, todosState, todos => [...todos, created])
}

export async function changeTodo(
  $: EngineInterface,
  taskId: string,
  subject: string | undefined,
  status: SidebarTodoStatus | 'deleted' | undefined,
) {
  await update($, todosState, todos =>
    status === 'deleted'
      ? todos.filter(todo => todo.id !== taskId)
      : todos.map(todo =>
          todo.id === taskId
            ? { ...todo, content: subject ?? todo.content, status: status ?? todo.status }
            : todo,
        ),
  )
}

export async function drawTodos($: EngineInterface, e: PaneInput) {
  const { Box, Text } = $.ui.resolve(e)
  const todos = await read($, todosState)
  if (todos.length === 0) return null
  const remaining = todos.filter(todo => todo.status !== 'completed').length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold>Todo</Text>
        <Text color="inactive">{`(${remaining} remaining)`}</Text>
      </Box>
      {todos.slice(0, MAX_TODOS).map(todo => (
        <Box key={todo.id} flexDirection="row" gap={1}>
          <Text color={TODO_MARKS[todo.status].color}>{TODO_MARKS[todo.status].mark}</Text>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text
              color={todo.status === 'completed' ? 'inactive' : 'text'}
              strikethrough={todo.status === 'completed'}
              wrap="truncate-end"
            >
              {todo.content}
            </Text>
          </Box>
        </Box>
      ))}
      {todos.length > MAX_TODOS && <Text color="inactive">{`+${todos.length - MAX_TODOS} more`}</Text>}
    </Box>
  )
}
