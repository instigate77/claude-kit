import { test, expect, mock } from 'claude-code/testing'

// AG NEW 14OCT26 - the system states this mod hands the session band, which draws
// their icons: the last value written, seen on its way to the kit's state.
function watchSystems(on: any) {
  const seen: { value?: Record<string, boolean | undefined> } = {}
  on('state.set', { plugin: 'usage-status', key: 'systems' }, (_: any, e: any, next: any) => {
    seen.value = e.value
    return next(e)
  })
  return seen
}
// AG NEW END

// Runs with `claude plugin test plugins/usage-status`.
const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as any
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const fail = { ...ok(''), exitCode: 1 }

const FREE = 'state=FREE\nRESULT=LISTED'
const HELD = '---\nstate=LIVE\nrepo=tetra-distributed\nowner=homestudio:dave:abcdef1234567\nbranch=feat/x\ntarget=TETRA-HUB\nstarted=1\nheartbeat=1\nexpires_epoch=9\nRESULT=LISTED'
const GH_OK = '{"status":{"indicator":"none","description":"All Systems Operational"}}'
const GH_BAD = '{"status":{"indicator":"minor","description":"Minor Service Outage"}}'
const ROSTER = '{"status":"active","public_domain":"aghub.example.net"}'

// want/not: the terminal's text line. desk/deskNot (AG NEW 14OCT26): the desktop's
// issue words. sys (AG UPDATE 14OCT26): the states handed to the session band for
// its icons: true OK (lock free), false not OK, absent unknown.
type Case = {
  name: string; lock: string | null; mp: string; gh: string | null; hub: string; roster?: string | null
  want: string[]; not: string[]; desk: string[]; deskNot: string[]; sys: Record<string, boolean | undefined>
}
const base = { gh: GH_OK, hub: '200', roster: ROSTER }
// Desktop palette: soft green, amber, red; muted grey for unknown.
const G = '#4caf6e', A = '#e2a94e', R = '#ef4444', M = '#8a8f8c'
const cases: Case[] = [
  // The hub prints lower-case state=FREE: the 02OCT26 false "RUNNING" came from a case-sensitive match.
  { ...base, name: 'all up', lock: FREE, mp: '200',
    want: ['LOCK: ', 'OFF', 'MP: ', 'GH: ', 'HUB: ', '"children":["✅"]'], not: ['ON', 'unknown', 'DOWN', '❗', '⚠️', '"up"', 'MemPalace', 'open'],
    desk: [], deskNot: ['unknown', 'DOWN', 'Lock', '"alt"', '✅', 'OFF', A, R, M],
    sys: { lock: true, mp: true, gh: true, hub: true } },
  { ...base, name: 'lock on with who and what, MP down', lock: HELD, mp: '000',
    want: ['ON', 'taken: tetra-distributed (feat/x) → TETRA-HUB by homestudio abcdef12', '"color":"#ef4444"},"children":["❗"," DOWN"]'], not: ['OFF'],
    desk: ['Lock taken: tetra-distributed (feat/x) → TETRA-HUB by homestudio abcdef12', `"color":"${R}"`, '["MemPalace DOWN"]'],
    deskNot: ['free', '"alt"', A],
    sys: { lock: false, mp: false, gh: true, hub: true } },
  { ...base, name: 'expired lock not released', lock: HELD.replace('state=LIVE', 'state=STALE'), mp: '200',
    want: ['ON', 'expired, not released: tetra-distributed'], not: ['OFF'],
    desk: ['expired, not released: tetra-distributed', `"color":"${R}"`], deskNot: ['free', A],
    sys: { lock: false, mp: true, gh: true, hub: true } },
  { ...base, name: 'lock check fails', lock: null, mp: '200', want: ['LOCK: ', 'unknown'], not: ['OFF', 'ON'],
    desk: [], deskNot: ['free', 'taken', 'unknown'],
    sys: { lock: undefined, mp: true, gh: true, hub: true } },
  { ...base, name: 'GitHub degraded, hub down', lock: FREE, mp: '200', gh: GH_BAD, hub: '000',
    want: ['"color":"#f59e0b"},"children":["⚠️"," ","Minor Service Outage"]', '"children":["❗"," DOWN"]'], not: ['unknown'],
    desk: [`"color":"${A}","weight":"semibold"},"children":["GitHub: Minor Service Outage"]`, `"color":"${R}","weight":"semibold"},"children":["Hub DOWN"]`],
    deskNot: ['unknown', '⚠️', '❗'],
    sys: { lock: true, mp: true, gh: 'minor', hub: false } },
  { ...base, name: 'GitHub page unreachable, hub 502', lock: FREE, mp: '200', gh: null, hub: '502',
    want: ['GH: ', 'unknown', '"children":["❗"," DOWN"]'], not: [],
    desk: ['["Hub DOWN"]'], deskNot: ['unknown', A],
    sys: { lock: true, mp: true, gh: undefined, hub: false } },
  // AG NEW 14OCT26 - worse than GitHub's "minor": red, as a system down.
  { ...base, name: 'GitHub major outage', lock: FREE, mp: '200', gh: '{"status":{"indicator":"major","description":"Major Service Outage"}}',
    want: ['Major Service Outage'], not: [],
    desk: [`"color":"${R}","weight":"semibold"},"children":["GitHub: Major Service Outage"]`], deskNot: [A],
    sys: { lock: true, mp: true, gh: false, hub: true } },
  { ...base, name: 'roster unreadable: hub unknown, never guessed', lock: FREE, mp: '200', roster: null,
    want: ['HUB: ', 'unknown'], not: ['DOWN'], desk: [], deskNot: ['DOWN', 'unknown'],
    sys: { lock: true, mp: true, gh: true, hub: undefined } },
]

function stub(on: any, c: Pick<Case, 'lock' | 'mp' | 'gh' | 'hub' | 'roster'>, context: object = {}, rateLimits: object[] = []) {
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [] }))
  // A clock that moves only when a test moves it: no timer (retry, poll) fires.
  mock.clock(on, { now: 0 })
  // No watch in these tests: it ends at once, as on a hub without `watch`.
  on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.usage', () => ({ value: { rateLimits, context } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    const last = argv[argv.length - 1]
    if (argv.join(' ').includes('deploy-lock.sh')) return { value: c.lock === null ? { ...ok(''), exitCode: 255 } : ok(c.lock) }
    if (argv.join(' ').includes('servers-query')) return { value: c.roster == null ? fail : ok(c.roster) }
    if (argv[0].endsWith('curl') && last.includes('githubstatus')) return { value: c.gh === null ? { ...ok(''), exitCode: 28 } : ok(c.gh) }
    if (argv[0].endsWith('curl') && last === 'https://aghub.example.net/') return { value: ok(c.hub) }
    if (argv[0].endsWith('curl')) return { value: ok(c.mp) }
    return { value: fail }
  })
}

// Near-real-time lock (operator 02OCT26): a local token file change re-asks the
// hub within one 2 s watch; a lock taken elsewhere shows on the 15 s poll.
test('lock line follows local lock files within 2 s, remote locks within 15 s', async ($: any, on: any) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { USERPROFILE: 'C:\\Users\\dave' })
  on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })
  let files = ''
  let held = false
  let hubCalls = 0
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.usage', () => ({ value: { rateLimits: [], context: {} } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
  // Windows-style home: the lock folder must be found under it.
  on('fs.list', (_: any, e: any) => {
    // AG UPDATE 03OCT26 - the Windows engine hands back C:\ paths; either slash style is the same folder.
    expect(String(e.path ?? e).replace(/\\/g, '/')).toContain('C:/Users/dave/.claude/locks')
    return { value: files ? [{ name: files.trim(), kind: 'file', size: 1, mtimeMs: 0, isLink: false }] : [] }
  })
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    if (argv.join(' ').includes('deploy-lock.sh')) {
      hubCalls++
      return { value: ok(held ? HELD : FREE) }
    }
    if (argv.join(' ').includes('servers-query')) return { value: ok(ROSTER) }
    if (argv[0].endsWith('curl') && argv[argv.length - 1].includes('githubstatus')) return { value: ok(GH_OK) }
    if (argv[0].endsWith('curl')) return { value: ok('200') }
    return { value: fail }
  })
  const line = async () => {
    const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'terminal', component: 'AbovePrompt', props })
    const text = JSON.stringify(await ui.drawn())
    await ui.unmount()
    return text
  }
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await clock.advance(1)
  expect(await line()).toContain('OFF')

  // A session on this Mac takes a lock: its token file appears.
  held = true
  files = 'remote-deploy-strip-test.abc.token\n'
  const before = hubCalls
  await clock.advance(2_000)
  expect(hubCalls).toBeGreaterThan(before)
  expect(await line()).toContain('taken: tetra-distributed')

  // It releases: the file goes, the line is OFF again within 2 s.
  held = false
  files = ''
  await clock.advance(2_000)
  expect(await line()).toContain('OFF')

  // A lock taken on another machine: no local file change, shown on the 15 s poll.
  held = true
  await clock.advance(2_000)
  expect(await line()).toContain('OFF')
  await clock.advance(15_000)
  expect(await line()).toContain('ON')
})

// ── live watch (hub `ag-deploy-lock watch`) ──
// A stand-in for the watch's SSH stream that the test feeds line by line.
function stream() {
  const queue: string[] = []
  let wake: (() => void) | undefined
  let ended = false
  return {
    push(text: string) { queue.push(text); wake?.() },
    end() { ended = true; wake?.() },
    async *pieces() {
      for (;;) {
        if (queue.length) { yield { stream: 'stdout', text: queue.shift()! }; continue }
        if (ended) return { value: { code: 0, signal: null } }
        await new Promise<void>(r => (wake = r))
        wake = undefined
      }
    },
  }
}
const SNAP_FREE = 'WATCH-SNAPSHOT\nstate=FREE\nRESULT=LISTED\n'
const SNAP_HELD = `WATCH-SNAPSHOT\n${HELD}\n`

function watchWorld(on: any, s: ReturnType<typeof stream>, counter: { hub: number }) {
  mock.env(on, { HOME: '/h' })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.usage', () => ({ value: { rateLimits: [], context: {} } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
  on('process.spawn', async function* (_: any, e: any) {
    expect(e.argv.join(' ')).toContain('deploy-lock.sh watch')
    return yield* s.pieces()
  })
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    if (argv.join(' ').includes('deploy-lock.sh')) { counter.hub++; return { value: ok(FREE) } }
    if (argv.join(' ').includes('servers-query')) return { value: ok(ROSTER) }
    if (argv[0].endsWith('curl') && argv[argv.length - 1].includes('githubstatus')) return { value: ok(GH_OK) }
    if (argv[0].endsWith('curl')) return { value: ok('200') }
    return { value: fail }
  })
}
async function lockLine($: any) {
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'terminal', component: 'AbovePrompt', props })
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return text
}

test('watch: each pushed list flips the line at once, with no extra hub checks', async ($: any, on: any) => {
  const clock = mock.clock(on, { now: 0 })
  const s = stream()
  const counter = { hub: 0 }
  watchWorld(on, s, counter)
  // session.start leaves the watch running: feed it before waiting on the start.
  s.push('WATCH-MODE=inotify\n' + SNAP_FREE)
  const started = $.session.start({ source: 'startup', cwd: '/tmp' })
  await clock.advance(1)
  expect(await lockLine($)).toContain('OFF')
  const afterStart = counter.hub

  s.push(SNAP_HELD)
  await clock.advance(1)
  expect(await lockLine($)).toContain('taken: tetra-distributed')
  s.push(SNAP_FREE)
  await clock.advance(1)
  expect(await lockLine($)).toContain('OFF')

  // While the watch is live the 15 s check stays quiet.
  await clock.advance(16_000)
  expect(counter.hub).toBe(afterStart)
  s.end()
  await started
})

test('watch: a hub without watch keeps the 15 s checks running', async ($: any, on: any) => {
  const clock = mock.clock(on, { now: 0 })
  const s = stream()
  const counter = { hub: 0 }
  watchWorld(on, s, counter)
  s.end() // the hub answered "unknown command" and the watch ended with no list
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await clock.advance(1)
  const before = counter.hub
  await clock.advance(15_000)
  expect(counter.hub).toBeGreaterThan(before)
  expect(await lockLine($)).toContain('OFF')
})

// AG UPDATE 14OCT26 - context % moved to the session band's ring: never on this band.
// AG UPDATE 14OCT26 - one row like the session band's (operator 14OCT26, second pass):
// 5h and 7d, each an icon with its text beside it; never wraps. AG UPDATE 14OCT26 (third
// pass): the system icons moved to the session band's row.
test('desktop: one row of quota rings, no system icons, no context %', async ($: any, on: any) => {
  stub(on, { lock: FREE, mp: '200', ...base }, { percent: 42 }, [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2099-01-01T00:00:00Z' }])
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
  const tree: any = await ui.drawn()
  // All OK: the icon row alone, no issue line under it.
  expect(tree.children).toHaveLength(1)
  // A line of space above, off the session band's row (operator 14OCT26).
  expect(tree.props).toMatchObject({ flexDirection: 'column', paddingTop: 1 })
  const row = tree.children[0]
  expect(row.props).toMatchObject({ flexDirection: 'row', flexWrap: 'nowrap', columnGap: 3, paddingX: 1 })
  // Quota rings only, the session band's icon size (operator 14OCT26: one size throughout).
  const alts = (row.children ?? []).map((c: any) => c.children?.[0]?.props?.alt)
  expect(alts).toEqual(['5h'])
  const sizes = (row.children ?? []).map((c: any) => c.children?.[0]?.props?.width)
  expect(sizes).toEqual([22])
  // Each quota item is the ring and its text side by side, not split across rows.
  const five = row.children[0]
  expect(five.props.flexDirection).toBe('row')
  expect(five.children[0].type).toBe('Svg')
  expect(five.children.slice(1).every((t: any) => t.type === 'Text')).toBe(true)
  expect(JSON.stringify(tree)).not.toMatch(/ctx|42%/)
})

// Context alone, all systems OK: nothing for this band to draw (their icons are on the session band's row).
test('desktop: context alone draws nothing', async ($: any, on: any) => {
  stub(on, { lock: FREE, mp: '200', ...base }, { percent: 42 })
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
  const text = JSON.stringify(await ui.drawn())
  expect(text).not.toContain('usage-status')
  expect(text).not.toMatch(/ctx|42%/)
})

// Cache hit (operator 14OCT26, third pass): after a main turn, at the right end of the
// row, under the session band's context: a plain icon (not a filling ring), a bar like
// the context bar, the %, then a cell standing in for the session band's ×.
// 900 of 1000 input tokens from cache -> 90%, green, 72 of 80 filled.
async function cacheRow($: any, on: any, bodyColumns: number) {
  stub(on, { lock: FREE, mp: '200', ...base }, {}, [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2099-01-01T00:00:00Z' }])
  on('turn.complete', () => ({ text: 'ok' }))
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  await $.turn.complete({ answer: 'ok', usage: { input_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 1 } })
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props: { ...props, bodyColumns } })
  return (await ui.drawn() as any).children[0].children
}

test('desktop: cache hit is an icon, a bar and its %, at the right end', async ($: any, on: any) => {
  const row = await cacheRow($, on, 120)
  expect(row.map((c: any) => c.props?.key)).toEqual(['5h', 'gap', 'hit'])
  expect(row[1].props).toMatchObject({ flexGrow: 1 })
  const hit = JSON.stringify(row[2])
  expect(hit).toContain('"alt":"cache","width":22')
  expect(hit).not.toContain('stroke-dasharray')
  expect(hit).toContain(`stroke=\\"${G}\\" stroke-width=\\"2\\"`)
  expect(hit).toContain(`"alt":"cache 90%","width":80,"height":6`)
  expect(hit).toContain(`<rect width=\\"72\\" height=\\"6\\" rx=\\"3\\" fill=\\"${G}\\"/>`)
  expect(hit).toContain(`"color":"${G}","weight":"semibold"},"children":["90%"]`)
})

// AG NEW 14OCT26 - one grid (operator 14OCT26, fourth pass): while the session band
// shows (a turn answered, not closed) it draws this row from `view`, so this band
// draws nothing on the desktop; closed, this band draws its own row again.
// (An inline plugin runs on its own: it can use no variable from this file.)
const sessionBandShowing = {
  name: 'session-band',
  register: (on: any) => {
    on('session.start', async ($: any, e: any, next: any) => {
      await $.state.set({ plugin: 'session-band', key: 'stats' }, { turn: 1 })
      return next(e)
    })
  },
}
const sessionBandClosed = {
  name: 'session-band',
  register: (on: any) => {
    on('session.start', async ($: any, e: any, next: any) => {
      await $.state.set({ plugin: 'session-band', key: 'stats' }, { turn: 1 })
      await $.state.set({ plugin: 'session-band', key: 'isHidden' }, true)
      return next(e)
    })
  },
}

for (const hidden of [false, true]) {
  test(`desktop: session band ${hidden ? 'closed: this band draws its row' : 'showing: this band steps aside'}`, { plugins: [hidden ? sessionBandClosed : sessionBandShowing] } as any, async ($: any, on: any) => {
    stub(on, { lock: HELD, mp: '200', ...base }, {}, [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2099-01-01T00:00:00Z' }])
    await $.session.start({ source: 'startup', cwd: '/tmp' })
    await new Promise(r => setTimeout(r, 200))
    const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
    const text = JSON.stringify(await ui.drawn())
    if (hidden) expect(text).toContain('Lock taken')
    else expect(text).not.toContain('usage-status')
  })
}

// The view handed to the session band: 5h ring data with its texts, the cache
// hit, and the issue words, colours final.
test('view: quotas, cache hit and issue words for the session band', async ($: any, on: any) => {
  const seen: { value?: any } = {}
  on('state.set', { plugin: 'usage-status', key: 'view' }, (_: any, e: any, next: any) => {
    seen.value = e.value
    return next(e)
  })
  stub(on, { lock: FREE, mp: '200', ...base, hub: '000' }, {}, [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2099-01-01T00:00:00Z' }])
  on('turn.complete', () => ({ text: 'ok' }))
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  await $.turn.complete({ answer: 'ok', usage: { input_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 1 } })
  await new Promise(r => setTimeout(r, 50))
  expect(seen.value.quotas).toHaveLength(1)
  expect(seen.value.quotas[0]).toMatchObject({ label: '5h', pct: 10, color: '#5fa8d3' })
  expect(seen.value.quotas[0].texts.length).toBeGreaterThan(0)
  expect(seen.value.hit).toEqual({ pct: 90, color: G })
  expect(seen.value.issues).toEqual([{ key: 'hub', color: R, text: 'Hub DOWN' }])
})
// AG NEW END

// Narrower than the session band shows its context bar at: no cache bar either.
test('desktop: narrow window drops the cache bar, keeps icon and %', async ($: any, on: any) => {
  const hit = JSON.stringify((await cacheRow($, on, 80)).find((c: any) => c.props?.key === 'hit'))
  expect(hit).toContain('"alt":"cache"')
  expect(hit).not.toContain('"alt":"cache 90%"')
  expect(hit).toContain('["90%"]')
})

// The quota ring fills to the used % (of a 62.8-long circle) in the colour of
// the worse of used and forecast: 7d 85% used -> 53.4 filled, amber.
test('desktop: 7d ring fills to the used % in its state colour', async ($: any, on: any) => {
  stub(on, { lock: FREE, mp: '200', ...base }, {}, [{ kind: 'seven_day', percentUsed: 85, resetsAt: '2099-01-01T00:00:00Z' }])
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
  const tree: any = await ui.drawn()
  const seven = JSON.stringify(tree.children[0].children.find((c: any) => c.props?.key === '7d'))
  expect(seven).toContain('"alt":"7d"')
  expect(seven).toContain('stroke-dasharray=\\"53.4 62.8\\"')
  // A full faint outline in the state colour under a bolder fill (operator 14OCT26).
  expect(seven).toContain(`stroke=\\"${A}\\" stroke-opacity=\\"0.45\\" stroke-width=\\"2\\"`)
  expect(seven).toContain(`stroke=\\"${A}\\" stroke-width=\\"3\\" stroke-linecap`)
})

// AG NEW 14OCT26 - end estimate as a second arc (operator 14OCT26, option B): 10% used
// 3 h into a 5 h window ends at 16.7%: blue to 10%, purple on to 16.7%, grey track.
test('desktop: ring draws the end estimate as a purple arc past the used %', async ($: any, on: any) => {
  const seen: { value?: any } = {}
  on('state.set', { plugin: 'usage-status', key: 'view' }, (_: any, e: any, next: any) => {
    seen.value = e.value
    return next(e)
  })
  stub(on, { lock: FREE, mp: '200', ...base }, {}, [{ kind: 'five_hour', percentUsed: 10, resetsAt: '1970-01-01T02:00:00Z' }])
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  expect(Math.round(seen.value.quotas[0].final * 100)).toBe(1667)
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
  const tree: any = await ui.drawn()
  const five = JSON.stringify(tree.children[0].children.find((c: any) => c.props?.key === '5h'))
  expect(five).toContain('stroke=\\"#8a8f8c\\" stroke-opacity=\\"0.25\\"')
  expect(five).toContain('stroke=\\"#a78bdb\\" stroke-width=\\"3\\"')
  expect(five).toContain('stroke-dasharray=\\"4.2 62.8\\" stroke-dashoffset=\\"-6.3\\"')
  expect(five).toContain('stroke-dasharray=\\"6.3 62.8\\"')
})
// AG NEW END

// Words for a system that is not OK go on their own line under the icon row, so a
// long lock holder cannot push the quota rings off the row (operator 14OCT26).
test('desktop: issue words on a line under the row, quota rings stay in the row', async ($: any, on: any) => {
  stub(on, { lock: HELD, mp: '000', ...base, hub: '000' }, {}, [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2099-01-01T00:00:00Z' }])
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
  const tree: any = await ui.drawn()
  expect(tree.children).toHaveLength(2)
  const [row, words] = tree.children.map((c: any) => JSON.stringify(c))
  expect(row).toContain('"alt":"7d"')
  expect(row).not.toMatch(/taken|DOWN/)
  expect(words).toContain('Lock taken: tetra-distributed')
  expect(words).toContain('["MemPalace DOWN"]')
  expect(words).toContain('["Hub DOWN"]')
  expect(words).not.toContain('"alt"')
})
// AG UPDATE END

// AG NEW 03OCT26 - dual16: bare `bash` is WSL (cannot open C:/ paths) and GNU
// `date -r` reads a file, so lock, hub and the reset label all went missing.
test('windows: scripts run under Git Bash, reset label comes from python', async ($: any, on: any) => {
  const GIT_BASH = 'C:/Users/dave/scoop/apps/git/current/bin/bash.exe'
  const RESET = '2026-10-05T15:00:00Z'
  const scriptShells: string[] = []
  const sys = watchSystems(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\dave' })
  mock.clock(on, { now: Date.parse('2026-10-03T14:00:00Z') })
  on('fs.list', () => ({ value: [] }))
  on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.usage', () => ({ value: { rateLimits: [{ kind: 'seven_day', percentUsed: 40, resetsAt: RESET }], context: { percent: 10 } } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    const joined = argv.join(' ')
    if (argv[0] === GIT_BASH && argv[1] === '-c') return { value: ok('') }
    if (joined.includes('deploy-lock.sh') || joined.includes('servers-query')) {
      scriptShells.push(argv[0])
      if (argv[0] !== GIT_BASH) return { value: { ...ok(''), exitCode: 127 } }
      return { value: ok(joined.includes('deploy-lock.sh') ? FREE : ROSTER) }
    }
    if (argv[0].startsWith('python') && joined.includes('strftime')) return { value: ok('Mon@08:00\n') }
    if (argv[0] === 'date') return { value: fail }
    if (argv[0].endsWith('curl') && argv[argv.length - 1].includes('githubstatus')) return { value: ok(GH_OK) }
    if (argv[0].endsWith('curl')) return { value: ok('200') }
    return { value: fail }
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  await new Promise(r => setTimeout(r, 200))
  const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
  const text = JSON.stringify(await ui.drawn())
  expect(scriptShells.length).toBeGreaterThan(0)
  for (const s of scriptShells) expect(s).toBe(GIT_BASH)
  expect(sys.value).toMatchObject({ lock: true, hub: true }) // AG UPDATE 14OCT26 - lock/hub icons are drawn by the session band
  expect(text).toContain('"alt":"7d"') // AG UPDATE 14OCT26 - reset time and time left no longer shown
})
// AG NEW END

// AG NEW 03OCT26 - 7d during calibration warm-up (operator 03OCT26): the
// straight-line forecast, never a blank; the engine takes over once ready.
// 40% used, 119 h in, 49 h left: straight line = 40*168/119 -> 56%, pace 0.6x.
const flat = (n: any): string =>
  n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(flat).join(' ') : flat(n.children)
// AG UPDATE 03OCT26 - 📏 = straight line (with calibration progress when the
// engine reports it), 🔮 = the shared-week forecast (operator 03OCT26).
const estimates: { name: string; est: ReturnType<typeof ok> | typeof fail; want: string; not: string[] }[] = [
  { name: 'warming up shows the straight line', est: ok('{"ready": false, "f": 0.72, "n": 3, "min_n": 20}'),
    want: '→56% 0.6x', not: ['→47%', '🔮'] },
  { name: 'ready shows the engine', est: ok('{"ready": true, "final": 47.0, "hi": 47.0, "naive": 50.0, "n": 24, "min_n": 20}'),
    want: '→47% 0.5x', not: ['→56%', '📏', '/20'] },
  { name: 'failed call shows the straight line', est: fail, want: '→56% 0.6x', not: ['→47%', '🔮', '/20'] },
  // AG NEW 05OCT26 - pace warm-up: blended toward 1.0x by f / 0.10 until f reaches 0.10.
  // 05OCT26 live reading: f 0.034, naive 147 -> 0.34*1.47 + 0.66 = 1.16 -> 1.2x (raw read 1.5x).
  { name: 'early window blends the pace toward 1x', est: ok('{"ready": true, "final": 47.0, "hi": 47.0, "naive": 147.0, "f": 0.034, "n": 24, "min_n": 20}'),
    want: '→47% 1.2x', not: ['1.5x', '📏'] },
  // Halfway through the ramp: 0.5*2.0 + 0.5 = 1.5x (raw would be 2.0x).
  { name: 'mid ramp weights pace and 1x equally', est: ok('{"ready": true, "final": 47.0, "hi": 47.0, "naive": 200.0, "f": 0.05, "n": 24, "min_n": 20}'),
    want: '→47% 1.5x', not: ['2.0x'] },
  // Past the ramp: the raw pace, unchanged.
  { name: 'past the ramp shows the raw pace', est: ok('{"ready": true, "final": 47.0, "hi": 47.0, "naive": 50.0, "f": 0.72, "n": 24, "min_n": 20}'),
    want: '→47% 0.5x', not: ['~1x'] },
  // AG NEW END
  // AG NEW 10OCT26 - at-current-pace wins over the engine forecast and the straight line.
  { name: 'at current pace shows the end and the burn', est: ok('{"ready": true, "final": 47.0, "hi": 47.0, "naive": 50.0, "f": 0.72, "final_now": 83.4, "pace_now": 0.614}'),
    want: '→83% 0.61x', not: ['→47%', '0.5x', '🔮', '📏'] },
  { name: 'at current pace near the cap is not rounded to 1x', est: ok('{"ready": false, "final_now": 101.2, "pace_now": 1.04}'),
    want: '→101% 1.04x', not: ['~1x', '📏'] },
  { name: 'at the cap reads cap', est: ok('{"ready": false, "final_now": 100.0, "pace_now": null}'),
    want: '→100% cap', not: ['📏'] },
  // AG NEW END
  // AG NEW 12OCT26 - first hours of the week: "too early" beats every other reading.
  { name: 'first hours of the week read too early', est: ok('{"ready": true, "final": 47.0, "hi": 47.0, "naive": 250.0, "f": 0.004, "early": true}'),
    want: 'too early', not: ['→47%', '→56%', '🔮', '📏', 'x 2d1h'] },
  // AG NEW END
]
// AG UPDATE END
for (const c of estimates) {
  test(`7d estimate: ${c.name}`, async ($: any, on: any) => {
    mock.env(on, { HOME: '/h' })
    mock.clock(on, { now: Date.parse('2026-10-03T14:00:00Z') })
    on('fs.list', () => ({ value: [] }))
    on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })
    on('session.start', () => ({ cwd: '/tmp' }))
    on('session.usage', () => ({ value: { rateLimits: [
      { kind: 'five_hour', percentUsed: 10, resetsAt: '2026-10-03T16:00:00.000Z' },
      { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-05T15:00:00.000Z' },
    ], context: {} } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.invalidate', () => ({ value: undefined }))
    on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
    on('process.run', (_: any, e: any) => {
      const joined = e.argv.join(' ')
      if (joined.includes('UC.estimate')) return { value: c.est }
      if (joined.includes('strftime')) return { value: ok('Mon@08:00\n') }
      if (joined.includes('deploy-lock.sh')) return { value: ok(FREE) }
      return { value: fail }
    })
    await $.session.start({ source: 'startup', cwd: '/tmp' })
    await new Promise(r => setTimeout(r, 200))
    const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
    const text = flat(await ui.drawn())
    expect(text).toContain(c.want)
    for (const n of c.not) expect(text).not.toContain(n)
    // AG UPDATE 14OCT26 - desktop shows forecast and burn only: no source marks, used %, time left or reset.
    expect(text).not.toMatch(/📏|🔮|40%|2d1h|MON@08:00/)
  })
}
// AG NEW END

// AG NEW 10OCT26 - 5h reads like 7d: 3 h in, 2 h left, end = used * 5 / 3, burn = end / 100.
const fives = [
  { used: 10, want: '→17% 0.17x', not: ['0.2x'] },
  { used: 61, want: '→102% 1.02x', not: ['~1x', '→100%'] },
]
for (const c of fives) {
  test(`5h burn: ${c.used}% used`, async ($: any, on: any) => {
    mock.env(on, { HOME: '/h' })
    mock.clock(on, { now: Date.parse('2026-10-03T14:00:00Z') })
    on('fs.list', () => ({ value: [] }))
    on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })
    on('session.start', () => ({ cwd: '/tmp' }))
    on('session.usage', () => ({ value: { rateLimits: [
      { kind: 'five_hour', percentUsed: c.used, resetsAt: '2026-10-03T16:00:00.000Z' },
    ], context: {} } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.invalidate', () => ({ value: undefined }))
    on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
    on('process.run', (_: any, e: any) => {
      const joined = e.argv.join(' ')
      if (joined.includes('deploy-lock.sh')) return { value: ok(FREE) }
      return { value: fail }
    })
    await $.session.start({ source: 'startup', cwd: '/tmp' })
    await new Promise(r => setTimeout(r, 200))
    const ui = await $.ui.mount({ plugin: 'usage-status', surface: 'desktop', component: 'AbovePrompt', props })
    const text = flat(await ui.drawn())
    expect(text).toContain(c.want)
    for (const n of c.not) expect(text).not.toContain(n)
  })
}
// AG NEW END

// AG NEW 14OCT26 - quota levels (operator 14OCT26): texts white (no colour), a %
// yellow from 80 and red from 90, a burn yellow from 0.80x and red from 1.10x; the
// ring blue, or the worst colour shown. 3 h into a 5 h window: end = used × 5/3.
const B = '#5fa8d3'
const levels = [
  { used: 47, texts: [['→78%', undefined], ['0.78x', undefined], ['2h', undefined]], ring: B },
  { used: 48, texts: [['→80%', A], ['0.80x', A], ['2h', undefined]], ring: A },
  { used: 54, texts: [['→90%', R], ['0.90x', A], ['2h', undefined]], ring: R },
  { used: 66, texts: [['→110%', R], ['1.10x', R], ['2h', undefined]], ring: R },
]
for (const c of levels) {
  test(`quota levels: 5h ${c.used}% used`, async ($: any, on: any) => {
    const seen: { value?: any } = {}
    on('state.set', { plugin: 'usage-status', key: 'view' }, (_: any, e: any, next: any) => {
      seen.value = e.value
      return next(e)
    })
    mock.env(on, { HOME: '/h' })
    mock.clock(on, { now: Date.parse('2026-10-03T14:00:00Z') })
    on('fs.list', () => ({ value: [] }))
    on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })
    on('session.start', () => ({ cwd: '/tmp' }))
    on('session.usage', () => ({ value: { rateLimits: [
      { kind: 'five_hour', percentUsed: c.used, resetsAt: '2026-10-03T16:00:00.000Z' },
    ], context: {} } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.invalidate', () => ({ value: undefined }))
    on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
    on('process.run', (_: any, e: any) => ({ value: e.argv.join(' ').includes('deploy-lock.sh') ? ok(FREE) : fail }))
    await $.session.start({ source: 'startup', cwd: '/tmp' })
    await new Promise(r => setTimeout(r, 200))
    const q = seen.value.quotas[0]
    expect(q.texts.map((t: any) => [t.text, t.color])).toEqual(c.texts)
    expect(q.color).toBe(c.ring)
  })
}
// AG NEW END

// AG NEW 14OCT26 - time left, nearest unit, up from the halfway point (operator 14OCT26)
const lefts = [
  { kind: 'seven_day', reset: '2026-10-07T08:00:00.000Z', want: '4d' }, // 3d18h
  { kind: 'seven_day', reset: '2026-10-07T01:00:00.000Z', want: '3d' }, // 3d11h
  { kind: 'seven_day', reset: '2026-10-03T20:00:00.000Z', want: '0d' }, // 6h
  { kind: 'five_hour', reset: '2026-10-03T16:29:00.000Z', want: '2h' }, // 2h29m
  { kind: 'five_hour', reset: '2026-10-03T16:30:00.000Z', want: '3h' }, // 2h30m
]
for (const c of lefts) {
  test(`time left: ${c.kind} resets ${c.reset} -> ${c.want}`, async ($: any, on: any) => {
    const seen: { value?: any } = {}
    on('state.set', { plugin: 'usage-status', key: 'view' }, (_: any, e: any, next: any) => {
      seen.value = e.value
      return next(e)
    })
    mock.env(on, { HOME: '/h' })
    mock.clock(on, { now: Date.parse('2026-10-03T14:00:00Z') })
    on('fs.list', () => ({ value: [] }))
    on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })
    on('session.start', () => ({ cwd: '/tmp' }))
    on('session.usage', () => ({ value: { rateLimits: [
      { kind: c.kind, percentUsed: 10, resetsAt: c.reset },
    ], context: {} } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.invalidate', () => ({ value: undefined }))
    on('ui.render', ($e: any, e: any) => (globalThis as any).h($e.ui.resolve(e).Box, {}))
    on('process.run', (_: any, e: any) => ({ value: e.argv.join(' ').includes('deploy-lock.sh') ? ok(FREE) : fail }))
    await $.session.start({ source: 'startup', cwd: '/tmp' })
    await new Promise(r => setTimeout(r, 200))
    const texts = seen.value.quotas[0].texts
    expect(texts[texts.length - 1]).toMatchObject({ text: c.want, dim: true })
  })
}
// AG NEW END

for (const surface of ['terminal', 'desktop'] as const) {
  for (const c of cases) {
    test(`${surface}: ${c.name}`, async ($: any, on: any) => {
      const sys = watchSystems(on)
      stub(on, c)
      await $.session.start({ source: 'startup', cwd: '/tmp' })
      await new Promise(r => setTimeout(r, 200))
      const ui = await $.ui.mount({ plugin: 'usage-status', surface, component: 'AbovePrompt', props })
      const text = JSON.stringify(await ui.drawn())
      for (const w of surface === 'terminal' ? c.want : c.desk) expect(text).toContain(w)
      for (const w of surface === 'terminal' ? c.not : c.deskNot) expect(text).not.toContain(w)
      // The terminal band carries the work line only, never the quota.
      if (surface === 'terminal') expect(text).not.toContain('ctx ')
      // AG NEW 14OCT26 - the session band's icons read these states.
      expect(sys.value).toEqual(c.sys)
    })
  }
}
