import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

// Replaces the retired in-chat usage line (hooks/userprompt/inject_usage.sh,
// removed 02OCT26) with the same thresholds and formulas: 5h is a straight
// pace projection; 7d asks ~/.claude/bin/usage-cost.py for the end of week at
// the current (recency-weighted) pace and its burn vs. the rate that lands on
// 100% (10OCT26); older engine forecast, then straight pace, are fallbacks.
// Drawn on screen only; nothing here reaches the model.
// Any machine (02OCT26): programs are found by name on PATH (python3, else
// python on Windows; bash for the repo's shell scripts; curl, date), and files
// sit under the home folder read from HOME, else USERPROFILE.
const PYTHONS = ['python3', 'python']
// AG NEW 03OCT26 - reset label ("MON@08:00") in this machine's local time, Mac and Windows alike.
const LOCAL_HM = 'import datetime, sys; print(datetime.datetime.fromtimestamp(int(sys.argv[1])).strftime("%a@%H:%M"))'
// AG NEW END
const APPEND =
  'import os, sys; os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True); open(sys.argv[1], "a").write(sys.stdin.read())'
// The ledger the 7d estimate reads is folded in from transcripts by `scan`;
// inject_usage.sh used to run it every 2 minutes, so the strip does now.
const SCAN_EVERY_MS = 120_000
const ESTIMATE_7D = `
import sys, json, datetime, importlib.util, os
spec = importlib.util.spec_from_file_location("uc", os.path.expanduser("~/.claude/bin/usage-cost.py"))
UC = importlib.util.module_from_spec(spec); spec.loader.exec_module(UC)
p7, r7, p5, r5 = float(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
now = datetime.datetime.now(datetime.timezone.utc)
five = None
if p5 and r5:
    f5r = UC.parse_iso(r5)  # AG UPDATE 03OCT26 - app sends "...Z"; Python 3.9 rejects it
    five = (float(p5), UC.window_cost(UC.snap_hour(f5r.timestamp()) - 5 * 3600, now.timestamp()))
print(json.dumps(UC.estimate(p7, r7, 168, five=five)))
`

// Work status (02OCT26): whether a deploy holds the lock (and whose), whether
// MemPalace answers, what GitHub's own status page reports, and whether the
// hub's website answers. Desktop: its own row above the usage row. Terminal:
// its own line above the prompt (the terminal's usage stays in its statusline).
const CURL = 'curl'
const GH_STATUS_URL = 'https://www.githubstatus.com/api/v2/status.json'
// The hub's address comes from the roster (hosts.agHUB.public_domain), never typed here.
const HUB_HOST = 'agHUB'
const GH_EVERY_MS = 300_000
const HUB_EVERY_MS = 60_000
const MP_URL = 'http://127.0.0.1:8787/mcp'
const MP_INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'usage-status', version: '0' } },
})
const MP_EVERY_MS = 60_000
// The lock lives on the hub. Real-time (operator 02OCT26): `deploy-lock.sh
// watch` keeps one SSH connection open and the hub's `ag-deploy-lock watch`
// sends a fresh list the instant a lock is taken or released (and every 60 s).
// While no watch is live (hub without `watch`, link down) the old checks run:
// the hub every 15 s, and this Mac's lock token files every 2 s. A 5 min check
// runs regardless, as a backstop.
const LOCK_EVERY_MS = 15_000
const LOCAL_WATCH_MS = 2_000
const LOCK_BACKSTOP_MS = 300_000
// A watch that ended after working reconnects after 5 s, doubling to 60 s; one
// that never sent a list (hub without `watch`) is retried after 5 min.
const WATCH_RETRY_MIN_MS = 5_000
const WATCH_RETRY_MAX_MS = 60_000
const WATCH_UNSUPPORTED_RETRY_MS = 300_000

// One held lock as the hub's `ag-deploy-lock list` prints it: a `---` block
// of key=value lines per lock; no locks prints only `state=FREE`.
type Held = { live: boolean; repo: string; who: string; branch: string; target: string }
type Lock = { free: true } | { free: false; held: Held[] }
// gh: GitHub's own verdict; ok when its indicator is "none", else its description.
// minor (AG NEW 14OCT26): GitHub's own "minor" indicator, the one level short of an outage.
type Gh = { ok: boolean; text: string; minor?: boolean }
type Work = { lock?: Lock; mpUp?: boolean; gh?: Gh; hubUp?: boolean }

// AG NEW 14OCT26 - the session band draws the lock/MemPalace/GitHub/hub icons on its
// own row (operator 14OCT26) from this state: true OK (lock: free), false not OK,
// absent unknown. The words for a system that is not OK stay in this band.
// AG UPDATE 14OCT26 - gh 'minor': GitHub's own minor level, drawn amber; false is red.
type Systems = { lock?: boolean; mp?: boolean; gh?: boolean | 'minor'; hub?: boolean }
// AG NEW 14OCT26 - one grid (operator 14OCT26, fourth pass): on the desktop the session
// band draws this band's row too, under its own, from `view`: 5h/7d rings with their
// texts, the cache hit, and the words for a system that is not OK. Colours are final.
type ViewText = { text: string; color?: string; dim?: boolean }
type View = {
  quotas: { label: string; pct: number; color: string; texts: ViewText[]; final?: number }[] // AG UPDATE 14OCT26 - final: end estimate %, for the ring's second arc
  hit?: { pct: number; color: string }
  issues: { key: string; text: string; color: string }[]
}
declare module 'claude-code' {
  interface PluginState {
    'usage-status': { systems: Systems; view: View }
    'session-band': { stats: { turn: number }; isHidden: boolean }
  }
}
const systems = atom({ plugin: 'usage-status', key: 'systems' } as const, {} as Systems)
const view = atom({ plugin: 'usage-status', key: 'view' } as const, { quotas: [], issues: [] } as View)
// The session band's own state: while it shows (a turn answered, not closed) it draws this band.
const sessionBandStats = atom({ plugin: 'session-band', key: 'stats' } as const, { turn: 0 })
const sessionBandHidden = atom({ plugin: 'session-band', key: 'isHidden' } as const, false)
// AG NEW 14OCT26 - quota warning levels (operator 14OCT26): a % yellow from 80 and
// red from 90; a burn or pace yellow from 0.80x and red from 1.10x ("cap" is red);
// below, no colour (white, as the session band's texts). The ring is the session
// band's context blue until a level shows.
const LEVEL_AMBER = '#e2a94e'
const LEVEL_RED = '#ef4444'
const QUOTA_BLUE = '#5fa8d3'
const pctLevel = (p: number): string | undefined => (p >= 90 ? LEVEL_RED : p >= 80 ? LEVEL_AMBER : undefined)
const rateLevel = (x: number | null): string | undefined =>
  x === null || x >= 1.1 ? LEVEL_RED : x >= 0.8 ? LEVEL_AMBER : undefined
// AG NEW END
// Every change: hand the session band the new view, and redraw this band.
const show = async ($: EngineInterface, v: View) => {
  await update($, view, () => v)
  $.ui.invalidate('ui.render')
}
// AG NEW END

function parseGh(out: string): Gh | undefined {
  try {
    const s = JSON.parse(out)?.status
    if (!s || typeof s.indicator !== 'string') return undefined
    return s.indicator === 'none'
      ? { ok: true, text: 'up' }
      : { ok: false, text: String(s.description ?? s.indicator), minor: s.indicator === 'minor' }
  } catch {
    return undefined
  }
}

function parseLocks(out: string): Lock | undefined {
  const blocks = out.split(/^---$/m).slice(1)
  if (!blocks.length) return /^state=FREE$/im.test(out) ? { free: true } : undefined
  const held = blocks.map(b => {
    const kv: Record<string, string> = {}
    for (const line of b.split('\n')) {
      const i = line.indexOf('=')
      if (i > 0) kv[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    // owner = host:user:session — the host and a short session id say who.
    const [host = '', , session = ''] = (kv.owner ?? '').split(':')
    return {
      live: (kv.state ?? '').toUpperCase() !== 'STALE',
      repo: kv.repo ?? '',
      who: [host, session.slice(0, 8)].filter(Boolean).join(' '),
      branch: kv.branch ?? '',
      target: kv.target ?? '',
    }
  })
  return { free: false, held }
}

const describeHeld = (h: Held): string =>
  `${h.live ? 'taken' : 'expired, not released'}: ${h.repo || '?'}` +
  (h.branch ? ` (${h.branch})` : '') +
  (h.target ? ` → ${h.target}` : '') +
  (h.who ? ` by ${h.who}` : '')

const GREEN = '#22c55e'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const OK_MARK = '✅'
const DOWN_MARK = '❗'
const WARN_MARK = '⚠️'

const colorFor = (pct: number): string => (pct >= 90 ? RED : pct >= 80 ? AMBER : GREEN)
const hitColor = (pct: number): string => (pct >= 80 ? GREEN : pct >= 50 ? AMBER : RED)

// AG NEW 14OCT26 - desktop icon rings in the session band's style (operator 14OCT26):
// its softer palette, one ring per item coloured by state, quota rings filled to the
// used %. Context % is left to the session band's ring. The terminal stays text.
const SOFT: Record<string, string> = { [GREEN]: '#4caf6e', [AMBER]: '#e2a94e', [RED]: RED }
const soft = (c: string): string => SOFT[c] ?? c
const MUTED = '#8a8f8c'
const ICON = 22
const FONT = 'font-family="-apple-system,sans-serif"'

const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${inner}</svg>`
const ring = (c: string, glyph: string) =>
  svg(`<circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-width="2"/>${glyph}`)
// The ring fills clockwise from the top to pct, over a faint full track.
// AG NEW 14OCT26 - end estimate as a second arc (operator 14OCT26, option B): from the
// used % on to the estimate in ESTIMATE purple, over a grey track so the arc stands out.
const ESTIMATE = '#a78bdb'
const fillRing = (c: string, pct: number, glyph: string, final?: number) => {
  const len = 2 * Math.PI * 10
  const filled = (Math.min(100, Math.max(0, pct)) / 100) * len
  const ahead = final === undefined ? 0 : (Math.min(100, Math.max(0, final)) / 100) * len - filled
  if (ahead > 0) {
    return svg(
      `<circle cx="12" cy="12" r="10" fill="none" stroke="${MUTED}" stroke-opacity="0.25" stroke-width="2"/>
     <circle cx="12" cy="12" r="10" fill="none" stroke="${ESTIMATE}" stroke-width="3"
       stroke-dasharray="${ahead.toFixed(1)} ${len.toFixed(1)}" stroke-dashoffset="${(-filled).toFixed(1)}" transform="rotate(-90 12 12)"/>
     <circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"
       stroke-dasharray="${filled.toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 12 12)"/>${glyph}`,
    )
  }
  // AG NEW END
  return svg(
    // Full outline in the state colour, as the other icons have, so the ring reads
    // the same size however little is filled (operator 14OCT26); the fill is bolder.
    `<circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-opacity="0.45" stroke-width="2"/>
     <circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"
       stroke-dasharray="${filled.toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 12 12)"/>${glyph}`,
  )
}
// The lock/MemPalace/GitHub/hub icons are drawn by the session band (14OCT26).
const labelGlyph = (c: string, text: string) =>
  `<text x="12" y="15.4" text-anchor="middle" ${FONT} font-size="9.5" font-weight="700" fill="${c}">${text}</text>`
// Cache hit: a target.
const hitGlyph = (c: string) =>
  `<circle cx="12" cy="12" r="3.4" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="12" cy="12" r="1" fill="${c}"/>`
// AG NEW 14OCT26 - cache hit bar, drawn like the session band's context bar (operator 14OCT26).
const hitBar = (c: string, pct: number) => {
  const w = Math.round((Math.min(100, Math.max(0, pct)) / 100) * 80)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 6" width="80" height="6">
    <rect width="80" height="6" rx="3" fill="${MUTED}" fill-opacity="0.3"/>
    <rect width="${w}" height="6" rx="3" fill="${c}"/></svg>`
}
// The session band shows its context bar from this width with the system icons on
// its row (its TIER_MIN[0] plus their room); the cache bar follows it.
const CACHE_BAR_MIN_COLUMNS = 92
// AG NEW END
// AG NEW END

const fmtDelta = (secs: number): string => {
  const s = Math.max(0, Math.floor(secs))
  const hTotal = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return hTotal >= 24 ? `${Math.floor(hTotal / 24)}d${hTotal % 24}h` : `${hTotal}h${String(m).padStart(2, '0')}m`
}

const fmtPace = (pace: number): string => (Math.abs(pace - 1) > 0.1 ? `${pace.toFixed(1)}x` : '~1x')

// AG UPDATE 03OCT26 - 7d source marks (operator 03OCT26): a ruler for the
// straight line (with calibration progress n/min_n while the engine warms up),
// a crystal ball for the shared-week forecast. The 5h window carries none.
const LINE_MARK = '📏'
const CAST_MARK = '🔮'
type Est7d = {
  ready: boolean; final?: number; hi?: number; naive?: number; f?: number; n?: number; min_n?: number
  final_now?: number; pace_now?: number | null // AG NEW 10OCT26
  early?: boolean // AG NEW 12OCT26 - first hours of the week: no reliable forecast yet
} | null
type Window = {
  label: string; pct: number; final?: number; colorOn: number; pace?: number; left?: number
  mark?: string; cal?: string
  burn?: number | null; finalColor?: string // AG NEW 10OCT26 - 7d at current pace
  early?: boolean // AG NEW 12OCT26
}
// AG UPDATE END

// AG NEW 14OCT26 - time left to the reset (operator 14OCT26): whole hours for the 5h
// window, whole days for the 7d, to the nearest unit and up from the halfway point
// (3d18h = 4d, 3d11h = 3d).
const fmtLeft = (label: string, remainingS: number) =>
  label === '5h' ? `${Math.round(remainingS / 3600)}h` : `${Math.round(remainingS / 86400)}d`
// AG NEW END

const linear = (pct: number, windowH: number, remainingS: number) => {
  const elapsedS = windowH * 3600 - remainingS
  if (elapsedS <= 300) return {}
  const pace = pct / (elapsedS / 3600) / (100 / windowH)
  const final = Math.min((pct * windowH * 3600) / elapsedS, 100)
  return { final, pace }
}

// AG NEW 05OCT26 - 7d pace warm-up (operator 05OCT26): naive = pct / f, where f
// is the share of a normal week's spend expected by now. Early in the window f
// is tiny and magnifies a busy first few hours (5% at f 0.034 read 1.5x), so
// until f reaches PACE_RAMP_F the shown pace is blended toward a neutral 1.0x,
// weighted by f / PACE_RAMP_F. Neutral, not the forecast, so it does not lean
// on the dollars-to-percent fit. No f reported -> the raw pace, as before.
const PACE_RAMP_F = 0.1
const blendPace = (naive: number, f?: number): number => {
  const w = f === undefined ? 1 : Math.min(Math.max(f / PACE_RAMP_F, 0), 1)
  return w * (naive / 100) + (1 - w)
}
// AG NEW END

// AG NEW 10OCT26 - 7d at current pace (operator 10OCT26: "if I do more it goes
// up, if I do less it goes down"). burn = recent rate ÷ the rate that lands
// exactly on 100% at reset; null = at or past the cap. Same thresholds as
// fmt_burn in statusline-usage.sh; keep the two in step. No deadband.
const burnColor = (b: number | null): string => (b === null || b > 1 ? RED : b >= 0.9 ? AMBER : GREEN)
const fmtBurn = (b: number | null): string => (b === null ? 'cap' : `${b.toFixed(2)}x`)
const endColor = (pct: number): string => (pct >= 100 ? RED : pct >= 90 ? AMBER : GREEN)
// The rate decays while idle without the used % moving, so re-ask this often.
const BURN_EVERY_MS = 300_000
// AG NEW END

export const register: Register = on => {
  let limits: SessionRateLimit[] = []
  let est7d: Est7d = null
  let est7dKey = ''
  // Share of the last main-loop turn's input the prompt cache served.
  let cacheHit: number | undefined
  // AG NEW 14OCT26 - session.start's trace, so turn.complete can record why cache % is missing.
  let traceOut: ((event: Record<string, unknown>) => Promise<void>) | undefined
  // session.start's refresh, so a fresh reading can re-run the 7d estimate and
  // the reset labels at once instead of waiting up to a minute for the timer
  // (a new session has no rate limits until its first response lands).
  let refreshNow: (() => Promise<void>) | undefined
  let now = 0
  let work: Work = {}
  // resetsAt -> "MON@08:00", in this Mac's local time as the old line showed
  // it (the module has no time zone of its own, so the host's `date` formats it).
  const resetLabels: Record<string, string> = {}

  const windowFor = (l: SessionRateLimit): Window | null => {
    const windowH = l.kind === 'five_hour' ? 5 : l.kind === 'seven_day' ? 168 : 0
    if (!windowH) return null
    const label = windowH === 5 ? '5h' : '7d'
    const remainingS = l.resetsAt ? (Date.parse(l.resetsAt) - now) / 1000 : undefined
    if (remainingS === undefined || remainingS <= 0) return { label, pct: l.percentUsed, colorOn: l.percentUsed }
    // AG UPDATE 03OCT26 - warm-up (not ready) falls through to the straight line
    // below, never a blank (operator 03OCT26); it uses only the account-wide
    // used % and reset, so every machine shows the same until the engine is ready.
    // AG NEW 12OCT26 - first hours of the week: every forecast missed by 15-40 points (backtest), say so
    if (windowH === 168 && est7d?.early) return { label, pct: l.percentUsed, colorOn: l.percentUsed, left: remainingS, early: true }
    // AG NEW END
    // AG NEW 10OCT26 - at-current-pace reading wins whenever the engine has it.
    if (windowH === 168 && est7d && typeof est7d.final_now === 'number') {
      const burn = typeof est7d.pace_now === 'number' ? est7d.pace_now : null
      return {
        label, pct: l.percentUsed, final: est7d.final_now, finalColor: endColor(est7d.final_now),
        colorOn: l.percentUsed, burn, left: remainingS,
      }
    }
    // AG NEW END
    if (windowH === 168 && est7d?.ready && est7d.final !== undefined) {
      return {
        label,
        pct: l.percentUsed,
        final: est7d.final,
        colorOn: Math.max(l.percentUsed, est7d.hi ?? est7d.final),
        pace: blendPace(est7d.naive ?? 100, est7d.f), // AG UPDATE 05OCT26 - was (naive ?? 100) / 100
        left: remainingS,
        mark: CAST_MARK,
      }
    }
    // AG NEW 10OCT26 - 5h reads like 7d (operator 10OCT26): uncapped straight-line end,
    // burn = end ÷ 100 to 2 decimals, red above 1.00x; no "~1x" hiding 0.9-1.1.
    if (windowH === 5) {
      const elapsedS = windowH * 3600 - remainingS
      if (elapsedS > 300) {
        const end = (l.percentUsed * windowH * 3600) / elapsedS
        return { label, pct: l.percentUsed, final: end, finalColor: endColor(end), colorOn: l.percentUsed, burn: end / 100, left: remainingS }
      }
    }
    // AG NEW END
    const { final, pace } = linear(l.percentUsed, windowH, remainingS)
    // AG NEW 03OCT26 - 7d straight line: ruler, plus progress when the engine reported it.
    const line = windowH === 168 && final !== undefined
    const cal = line && est7d?.n !== undefined && est7d.min_n ? `${est7d.n}/${est7d.min_n}` : undefined
    // AG NEW END
    return {
      label, pct: l.percentUsed, final, pace, colorOn: Math.max(l.percentUsed, final ?? 0), left: remainingS,
      mark: line ? LINE_MARK : undefined, cal,
    }
  }

  // AG NEW 14OCT26 - what the desktop row shows, worked out once for both drawers:
  // this band (when the session band is not showing) and the session band's grid.
  const buildView = (): View => {
    const quotas = limits
      .map(windowFor)
      .filter((w): w is Window => w !== null)
      .map(w => {
        // Used % is the ring's fill; beside it the end-of-window forecast and the
        // burn (or the pace where no burn is known). No forecast yet: the used % itself.
        // AG UPDATE 14OCT26 - the session band's style (operator 14OCT26): texts white,
        // yellow from 80% or 0.80x, red from 90% or 1.10x; the ring in the context
        // ring's blue, or the worst colour of its item.
        const texts: ViewText[] = []
        if (w.early) texts.push({ text: 'too early', dim: true })
        else if (w.final !== undefined) texts.push({ text: `→${Math.round(w.final)}%`, color: pctLevel(w.final) })
        else texts.push({ text: `${Math.round(w.pct)}%`, color: pctLevel(w.pct) })
        if (w.burn !== undefined) texts.push({ text: fmtBurn(w.burn), color: rateLevel(w.burn) })
        else if (w.pace !== undefined) texts.push({ text: fmtPace(w.pace), color: rateLevel(w.pace) })
        // AG NEW 14OCT26 - time left, dim, last
        if (w.left !== undefined) texts.push({ text: fmtLeft(w.label, w.left), dim: true })
        // AG NEW END
        const levels = [pctLevel(w.pct), ...texts.map(t => t.color)]
        const color = levels.includes(LEVEL_RED) ? LEVEL_RED : levels.includes(LEVEL_AMBER) ? LEVEL_AMBER : QUOTA_BLUE
        return { label: w.label, pct: w.pct, color, texts, final: w.early ? undefined : w.final } // AG UPDATE 14OCT26 - was without final
        // AG UPDATE END
      })
    // Only a system that is not OK gets words, on a line of their own under the
    // row (operator 14OCT26: a long lock holder pushed 7d and cache off the row).
    const issues: View['issues'] = []
    const lock = work.lock
    if (lock !== undefined && !lock.free) issues.push({ key: 'lock', color: LEVEL_RED, text: `Lock ${lock.held.map(describeHeld).join('; ')}` })
    if (work.mpUp === false) issues.push({ key: 'mp', color: LEVEL_RED, text: 'MemPalace DOWN' })
    if (work.gh !== undefined && !work.gh.ok) issues.push({ key: 'gh', color: work.gh.minor ? LEVEL_AMBER : LEVEL_RED, text: `GitHub: ${work.gh.text}` })
    if (work.hubUp === false) issues.push({ key: 'hub', color: LEVEL_RED, text: 'Hub DOWN' })
    const hit = cacheHit === undefined ? undefined : { pct: Math.round(cacheHit), color: soft(hitColor(cacheHit)) }
    return { quotas, hit, issues }
  }
  // AG NEW END

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined)

    const h = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    const claude = h ? `${h.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude` : undefined
    // AG NEW 03OCT26 - Windows: bare `bash` on PATH is the WSL launcher, which
    // cannot open C:/ paths (dual16 trace: every lock check exit 127). Use Git
    // Bash there (scoop, then the standard install); first one that starts wins.
    let bashExe: string | undefined
    const bash = async () => {
      if (bashExe) return bashExe
      const win = !!claude && /^[A-Za-z]:\//.test(claude)
      const home = claude?.replace(/\/\.claude$/, '')
      const tries = win ? [`${home}/scoop/apps/git/current/bin/bash.exe`, 'C:/Program Files/Git/bin/bash.exe'] : []
      for (const b of tries) {
        try {
          if ((await $.process.run([b, '-c', 'exit 0'], { timeoutMs: 5_000 })).exitCode === 0) return (bashExe = b)
        } catch {
          // not installed here; try the next
        }
      }
      return (bashExe = 'bash')
    }
    // AG NEW END
    // python3, else python (Windows); rejects only when neither can start.
    const py = async (args: string[], timeoutMs: number) => {
      let last: unknown
      for (const p of PYTHONS) {
        try {
          return await $.process.run([p, ...args], { timeoutMs })
        } catch (err) {
          last = err
        }
      }
      throw last
    }

    // Diagnostic trace (02OCT26, lock line not updating live): one JSON line per
    // load, lock answer change or failure, and watch connect/disconnect.
    // ~/.claude/cache/usage-status/trace.jsonl. Losing a line never matters.
    const trace = async (event: Record<string, unknown>) => {
      if (!claude) return
      const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n'
      for (const p of PYTHONS) {
        try {
          await $.process.run([p, '-c', APPEND, `${claude}/cache/usage-status/trace.jsonl`], { stdin: line, timeoutMs: 5_000 })
          return
        } catch {
          // try the next python; a lost line never matters
        }
      }
    }
    void trace({ event: 'loaded', claude: claude ?? null })

    const refreshEstimate = async () => {
      const seven = limits.find(l => l.kind === 'seven_day')
      const five = limits.find(l => l.kind === 'five_hour')
      if (!seven?.resetsAt) return
      // AG UPDATE 10OCT26 - plus a 5-minute tick: the at-current-pace rate moves with time alone
      const key = `${seven.percentUsed}|${seven.resetsAt}|${five?.percentUsed}|${five?.resetsAt}|${Math.floor(now / BURN_EVERY_MS)}`
      if (key === est7dKey) return
      try {
        const r = await py(
          ['-c', ESTIMATE_7D, String(seven.percentUsed), seven.resetsAt, String(five?.percentUsed ?? ''), five?.resetsAt ?? ''],
          15_000,
        )
        est7d = r.exitCode === 0 ? (JSON.parse(r.stdout.trim() || 'null') as Est7d) : null
        // AG NEW 03OCT26 - a failed estimate drops the strip to the straight-line
        // forecast, so say why (the Macs did this unseen after the shared week).
        if (r.exitCode !== 0) void trace({ event: 'estimate-failed', exit: r.exitCode, reset: seven.resetsAt, err: r.stderr.slice(-300) })
        // AG NEW END
      } catch (err) {
        est7d = null
        void trace({ event: 'estimate-error', reset: seven.resetsAt, err: String(err).slice(0, 300) }) // AG UPDATE 03OCT26 - was silent
      }
      est7dKey = key
    }

    const labelResets = async () => {
      for (const l of limits) {
        if (!l.resetsAt || resetLabels[l.resetsAt]) continue
        try {
          const epoch = String(Math.round(Date.parse(l.resetsAt) / 1000))
          // AG UPDATE 03OCT26 - python, not BSD `date -r` (Windows' GNU date reads -r as a file: no label on dual16).
          const r = await py(['-c', LOCAL_HM, epoch], 5_000)
          // AG UPDATE END
          if (r.exitCode === 0) resetLabels[l.resetsAt] = r.stdout.trim().toUpperCase()
        } catch {
          // No label: the countdown still shows.
        }
      }
    }

    const refresh = async () => {
      const u = await $.session.usage()
      limits = u.rateLimits
      now = await $.clock.now()
      await refreshEstimate()
      await labelResets()
      await show($, buildView())
    }

    const scan = async () => {
      if (!claude) return
      try {
        await py([`${claude}/bin/usage-cost.py`, 'scan'], 110_000)
      } catch {
        // A slow or failed scan only leaves the 7d estimate a little older.
      }
    }

    // A probe that cannot run leaves its field unknown, never a guess. The
    // HTTP code is curl's last output line (no /dev/null: Windows has none).
    const lastLine = (s: string) => s.trim().split('\n').pop()?.trim() ?? ''
    // AG NEW 14OCT26 - every change to the work state also goes to the session band's icons.
    const setWork = async (patch: Partial<Work>) => {
      work = { ...work, ...patch }
      const w = work
      await update($, systems, () => ({ lock: w.lock?.free, mp: w.mpUp, gh: w.gh === undefined ? undefined : w.gh.ok ? true : w.gh.minor ? 'minor' : false, hub: w.hubUp }))
      await show($, buildView())
    }
    // AG NEW END
    const probeMp = async () => {
      let up: boolean | undefined
      try {
        const r = await $.process.run(
          [CURL, '-s', '-m', '3', '-w', '\n%{http_code}', '-X', 'POST',
            '-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream',
            '-d', MP_INIT, MP_URL],
          { timeoutMs: 8_000 },
        )
        up = lastLine(r.stdout) === '200'
      } catch {
        up = undefined
      }
      await setWork({ mpUp: up })
    }

    const probeGh = async () => {
      let gh: Gh | undefined
      try {
        const r = await $.process.run([CURL, '-s', '-m', '5', GH_STATUS_URL], { timeoutMs: 10_000 })
        gh = r.exitCode === 0 ? parseGh(r.stdout) : undefined
      } catch {
        gh = undefined
      }
      await setWork({ gh })
    }

    // The roster names the hub's public address; read once per load.
    let hubUrl: string | undefined
    const probeHub = async () => {
      let hubUp: boolean | undefined
      try {
        if (!hubUrl && claude) {
          const q = await $.process.run([await bash(), `${claude}/bin/servers-query`, 'host', HUB_HOST], { timeoutMs: 15_000 })
          const domain = q.exitCode === 0 ? JSON.parse(q.stdout)?.public_domain : undefined
          if (typeof domain === 'string' && domain) hubUrl = `https://${domain}/`
        }
        if (hubUrl) {
          const r = await $.process.run([CURL, '-s', '-m', '5', '-w', '\n%{http_code}', hubUrl], { timeoutMs: 10_000 })
          const code = Number(lastLine(r.stdout))
          hubUp = code >= 200 && code < 400
        }
      } catch {
        hubUp = undefined
      }
      await setWork({ hubUp })
    }

    // One hub call at a time; a change seen meanwhile asks again right after.
    let lockBusy = false
    let lockAgain = false
    let lastSaid = ''
    const probeLock = async () => {
      if (lockBusy) {
        lockAgain = true
        return
      }
      lockBusy = true
      try {
        do {
          lockAgain = false
          let lock: Lock | undefined
          try {
            if (claude) {
              const r = await $.process.run([await bash(), `${claude}/bin/deploy-lock.sh`, 'list'], { timeoutMs: 20_000 })
              lock = r.exitCode === 0 ? parseLocks(r.stdout) : undefined
              if (r.exitCode !== 0) void trace({ event: 'lock-list-failed', exit: r.exitCode, err: r.stderr.slice(0, 200) })
            }
          } catch (err) {
            lock = undefined
            void trace({ event: 'lock-list-error', err: String(err).slice(0, 200) })
          }
          const said = lock === undefined ? 'unknown' : lock.free ? 'OFF' : 'ON'
          if (said !== lastSaid) void trace({ event: 'lock', via: 'list', said })
          lastSaid = said
          await setWork({ lock })
        } while (lockAgain)
      } finally {
        lockBusy = false
      }
    }

    // This Mac's lock token files: a session here taking or releasing a lock
    // changes the listing, which re-asks the hub immediately.
    let localSeen: string | undefined
    const watchLocal = async () => {
      if (!claude) return
      let listing: string
      try {
        const entries = await $.fs.list(`${claude}/locks`)
        listing = entries.map((x: { name: string }) => x.name).sort().join('\n')
      } catch {
        // No folder yet: no lock has been taken on this machine.
        listing = ''
      }
      if (localSeen !== undefined && listing !== localSeen && !watchLive) void probeLock()
      localSeen = listing
    }

    // The live watch: each `WATCH-SNAPSHOT` line is followed by a `list`
    // block ending `RESULT=...`; every complete block replaces the lock state.
    let watchLive = false
    let watchRetry = WATCH_RETRY_MIN_MS
    const runWatch = async () => {
      if (!claude) return
      let sawList = false
      let pending = ''
      let block: string[] | undefined
      let why = 'ended'
      void trace({ event: 'watch-start' })
      try {
        const child = $.process.spawn({ argv: [await bash(), `${claude}/bin/deploy-lock.sh`, 'watch'] })
        for await (const piece of child) {
          if (piece.stream !== 'stdout') continue
          pending += piece.text
          let cut: number
          while ((cut = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, cut).replace(/\r$/, '')
            pending = pending.slice(cut + 1)
            if (line === 'WATCH-SNAPSHOT') {
              block = []
            } else if (block) {
              block.push(line)
              if (line.startsWith('RESULT=')) {
                const lock = parseLocks(block.join('\n'))
                block = undefined
                if (lock) {
                  await setWork({ lock })
                  const said = lock.free ? 'OFF' : 'ON'
                  if (said !== lastSaid) void trace({ event: 'lock', via: 'watch', said })
                  lastSaid = said
                }
                sawList = true
                watchLive = true
                watchRetry = WATCH_RETRY_MIN_MS
              }
            }
          }
        }
      } catch (err) {
        // Could not start or the link broke: fall through to the retry.
        why = String(err).slice(0, 200)
      }
      void trace({ event: 'watch-end', sawList, why })
      watchLive = false
      const wait = sawList ? watchRetry : WATCH_UNSUPPORTED_RETRY_MS
      if (sawList) watchRetry = Math.min(watchRetry * 2, WATCH_RETRY_MAX_MS)
      if (!sawList) void probeLock()
      $.clock.after(wait, () => void runWatch())
    }

    refreshNow = refresh
    traceOut = trace // AG NEW 14OCT26
    // A failing usage read must not stop the work-line probes below.
    try {
      await refresh()
    } catch (err) {
      void trace({ event: 'refresh-error', err: String(err).slice(0, 200) })
    }
    void scan()
    void probeMp()
    void probeLock()
    void probeGh()
    void probeHub()
    $.clock.every(60_000, () => void refresh())
    $.clock.every(SCAN_EVERY_MS, () => void scan())
    $.clock.every(MP_EVERY_MS, () => void probeMp())
    $.clock.every(LOCK_EVERY_MS, () => {
      if (!watchLive) void probeLock()
    })
    $.clock.every(LOCK_BACKSTOP_MS, () => void probeLock())
    void runWatch()
    void watchLocal()
    $.clock.every(LOCAL_WATCH_MS, () => void watchLocal())
    $.clock.every(GH_EVERY_MS, () => void probeGh())
    $.clock.every(HUB_EVERY_MS, () => void probeHub())
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    const u = e.usage
    if (!e.agentId && u) {
      const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      if (input > 0) {
        cacheHit = (u.cache_read_input_tokens / input) * 100
        void show($, buildView())
      }
    }
    // AG NEW 14OCT26 - cache % did not show on the desktop (operator 14OCT26): record a main turn with no usable counts.
    if (!e.agentId && cacheHit === undefined) void traceOut?.({ event: 'cache-hit-missing', hasUsage: !!u, keys: u ? Object.keys(u) : [] })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    limits = e.rateLimits
    now = await $.clock.now()
    await show($, buildView())
    if (e.changed.includes('rateLimits')) void refreshNow?.()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null // AG NEW 14OCT26 - desktop icons; null where SVG cannot draw
    const sep = <Text dimColor> · </Text>
    const hasWork = work.lock !== undefined || work.mpUp !== undefined || work.gh !== undefined || work.hubUp !== undefined
    // LOCK: OFF = no deploy holds the lock; ON = held, with what and by whom.
    const lock = work.lock
    const workLine = () => (
      <Text>
        <Text bold>LOCK: </Text>
        {lock === undefined ? <Text dimColor>unknown</Text>
          : lock.free ? <Text bold color={GREEN}>OFF</Text>
          : (
            <Text>
              <Text bold color={AMBER}>ON</Text>
              <Text> {lock.held.map(describeHeld).join('; ')}</Text>
            </Text>
          )}
        {sep}
        {/* Healthy = ✅; down = red ❗ DOWN; GitHub's own partial verdict = yellow ⚠️ (operator 03OCT26). */}
        <Text bold>MP: </Text>
        {work.mpUp === undefined ? <Text dimColor>unknown</Text>
          : work.mpUp ? <Text>{OK_MARK}</Text> : <Text bold color={RED}>{DOWN_MARK} DOWN</Text>}
        {sep}
        <Text bold>GH: </Text>
        {work.gh === undefined ? <Text dimColor>unknown</Text>
          : work.gh.ok ? <Text>{OK_MARK}</Text> : <Text bold color={AMBER}>{WARN_MARK} {work.gh.text}</Text>}
        {sep}
        <Text bold>HUB: </Text>
        {work.hubUp === undefined ? <Text dimColor>unknown</Text>
          : work.hubUp ? <Text>{OK_MARK}</Text> : <Text bold color={RED}>{DOWN_MARK} DOWN</Text>}
      </Text>
    )

    // The terminal shows quota in its own statusline (statusline-usage.sh), so
    // its band carries the work line alone.
    if (e.surface === 'terminal') return hasWork ? <Box>{workLine()}</Box> : next(e)
    if (e.surface !== 'desktop') return next(e)
    // AG UPDATE 14OCT26 - one grid (operator 14OCT26, fourth pass): while the session
    // band shows, it draws this row under its own from `view`, so draw nothing here.
    if (Svg && (await read($, sessionBandStats)).turn > 0 && !(await read($, sessionBandHidden))) return next(e)

    const v = buildView()
    if (v.quotas.length === 0 && v.hit === undefined && v.issues.length === 0) return next(e)

    // Alone, the same row in the session band's style: each item an icon with flat
    // bold text beside it; 5h/7d rings filled to the used %, the cache hit as an
    // icon, a bar and its %; the issue words on a line below. Where SVG cannot
    // draw, a coloured text label stands in for the icon.
    const icon = (source: string, label: string, c: string) =>
      Svg ? <Svg source={source} alt={label} width={ICON} height={ICON} /> : <Text bold color={c}>{label}</Text>
    const item = (key: string, glyph: unknown, texts: unknown[] = []) => (
      <Box key={key} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
        {glyph as never}
        {texts as never}
      </Box>
    )
    const texts = (ts: ViewText[]) =>
      ts.map((t, i) => <Text key={String(i)} bold={!t.dim} dimColor={t.dim} color={t.color}>{t.text}</Text>)

    const items: unknown[] = v.quotas.map(q => item(q.label, icon(fillRing(q.color, q.pct, labelGlyph(q.color, q.label), q.final), q.label, q.color), texts(q.texts)))
    if (v.hit !== undefined) {
      const { pct, color } = v.hit
      items.push(<Box key="gap" flexGrow={1} flexShrink={1} />)
      items.push(item('hit', icon(ring(color, hitGlyph(color)), 'cache', color), [
        Svg && e.props.bodyColumns >= CACHE_BAR_MIN_COLUMNS
          ? <Svg key="bar" source={hitBar(color, pct)} alt={`cache ${pct}%`} width={80} height={6} />
          : null,
        <Text key="h" bold color={color}>{`${pct}%`}</Text>,
      ]))
    }

    return (
      <Box flexDirection="column" paddingTop={1}>
        {items.length > 0 ? (
          <Box flexDirection="row" alignItems="center" columnGap={3} flexWrap="nowrap" overflow="hidden" paddingX={1}>
            {items as never}
          </Box>
        ) : null}
        {v.issues.length > 0 ? (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap" paddingX={1}>
            {v.issues.map((i, n) => (
              <Box key={i.key} flexDirection="row" columnGap={1}>
                {n > 0 ? <Text dimColor>·</Text> : null}
                <Text bold color={i.color}>{i.text}</Text>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    )
    // AG UPDATE END
  })
}
