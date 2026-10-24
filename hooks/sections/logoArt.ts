export type BannerTone = 'accent' | 'name'

export const BANNER_WIDTH = 27

export const BANNER: readonly (readonly (readonly [string, BannerTone])[])[] = [
  [
    ['█▀▀ ▀█▀ █▀▄ █▀▀ ', 'accent'],
    ['█▀▄ ▄▀▄ █▀▄', 'name'],
  ],
  [
    ['▀▀█  █  █ █ █▀▀ ', 'accent'],
    ['█▀▄ █▀█ █▀▄', 'name'],
  ],
  [
    ['▀▀▀ ▀▀▀ ▀▀  ▀▀▀ ', 'accent'],
    ['▀▀  ▀ ▀ ▀ ▀', 'name'],
  ],
]
