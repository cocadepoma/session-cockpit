const TRACE_LIMIT = 200

const trace: string[] = []

export const record = (line: string) => {
  trace.push(`${new Date().toISOString()} ${line}`)
  if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT)
}

export const readTrace = () => [...trace]

export const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const traced = async (name: string, run: () => Promise<unknown>) => {
  const startedAt = Date.now()
  try {
    const detail = await run()
    record(`${name} ${Date.now() - startedAt}ms${typeof detail === 'string' ? ` ${detail}` : ''}`)
  } catch (error) {
    record(`${name} ${Date.now() - startedAt}ms failed: ${describeError(error)}`)
  }
}

export const guarded = async <T,>(name: string, run: () => Promise<T>) => {
  try {
    return await run()
  } catch (error) {
    record(`${name} failed: ${describeError(error)}`)

    return undefined
  }
}
