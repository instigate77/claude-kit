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
// (lock: free), false not OK (lock taken, system down), 'minor' a level short of down
// (GitHub's own), absent unknown. Drawn as icons on the band's row.
export type Systems = { lock?: boolean; mp?: boolean; gh?: boolean | 'minor'; hub?: boolean }

// Its usage row, which this band draws under its own as one grid on the desktop:
// 5h/7d quota rings and their texts, the cache hit, and the words for a system that
// is not OK. Colours come final from that mod.
export type UsageText = { text: string; color?: string; dim?: boolean }
export type UsageView = {
  quotas: { label: string; pct: number; color: string; texts: UsageText[] }[]
  hit?: { pct: number; color: string }
  issues: { key: string; text: string; color: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-band': { stats: Stats; cache: Cache; isHidden: boolean; isBusy: boolean; warned: number }
    'usage-status': { systems: Systems; view: UsageView }
    // The Cache mod's deadline (epoch ms), read to seed the countdown after a reload.
    Cache: { expiresAt: number | null }
  }
}
