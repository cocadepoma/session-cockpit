export const storedFlag = (stored: unknown, current: boolean) => (typeof stored === 'boolean' ? stored : current)

export const hasChanged = (current: unknown, next: unknown) => JSON.stringify(current) !== JSON.stringify(next)
