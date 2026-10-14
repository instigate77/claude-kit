export type Stats = {
  turn: number
  speed: number | null
  total: number
  // Tokens of every response since the band loaded: input, output, cache reads and writes.
  tokens: number
  context: number
}

export type Cache = {
  expiresAt: number | null
  secondsLeft: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-band': { stats: Stats; cache: Cache; isHidden: boolean; isBusy: boolean; warned: number }
  }
}
