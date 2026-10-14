export type Stats = {
  turn: number
  speed: number | null
  context: number
}

export type Cache = {
  expiresAt: number | null
  secondsLeft: number | null
}

// A system status mod's states, when one runs (the operator's usage-status): true OK
// (lock: free), false not OK, absent unknown. Drawn as icons on the band's row.
export type Systems = { lock?: boolean; mp?: boolean; gh?: boolean; hub?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-band': { stats: Stats; cache: Cache; isHidden: boolean; isBusy: boolean; warned: number }
    'usage-status': { systems: Systems }
    // The Cache mod's deadline (epoch ms), read to seed the countdown after a reload.
    Cache: { expiresAt: number | null }
  }
}
