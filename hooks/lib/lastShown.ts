import type { Atom } from 'claude-code'

const lastKnown = new Map<string, unknown>()

const keyOf = (source: Atom<unknown>) => `${source.ref.key}:${source.ref.id ?? ''}`

export const remember = <T,>(source: Atom<T>, value: T) => {
  lastKnown.set(keyOf(source), value)

  return value
}

// The host forgets $.state when the conversation changes, and a forgotten atom reads as its own
// initial; showing the last value instead until the session watch reloads it keeps the pane's
// sections, logo and figures in place across the switch.
export const shown =
  <T,>(source: Atom<T>) =>
  (value: T): T => {
    if (value !== source.initial) return remember(source, value)

    return lastKnown.has(keyOf(source)) ? (lastKnown.get(keyOf(source)) as T) : value
  }

export const flip = (source: Atom<boolean>, value: boolean) => remember(source, !shown(source)(value))
