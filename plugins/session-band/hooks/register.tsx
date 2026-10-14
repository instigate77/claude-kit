import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cache, Stats, Systems, UsageView } from '../types'

// Responses shorter than this are mostly tool-call stubs: their timing is noise.
const MIN_TOKENS = 20
// A response that arrived in one burst cannot be timed; such readings are dropped.
const MIN_SECONDS = 0.5
const MAX_SPEED = 1000
// Fixed slots, in cells, for the texts that change length, so the items after them
// hold still: "1000 tok/s", "1000/s", "expired" (the countdown's longest).
const SPEED_WIDTH = 10
const SPEED_WIDTH_COMPACT = 6
const COUNTDOWN_WIDTH = 7

const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_WARN_S = 20 * 60
const CACHE_ALERT_S = 10 * 60
// Minutes left at which the cache expiry is announced, once each per answer.
const CACHE_NOTIFY_MINUTES = [10, 5] as const

const SPEED = '#8b8cf8'
const GOOD = '#4caf6e'
const MUTED = '#8a8f8c'
const CONTEXT = '#5fa8d3'
const CACHE = '#4fb3a9'
const WARN = '#e2a94e'
const ALERT = '#e0846b'

const stats = atom({ plugin: 'session-band', key: 'stats' } as const, {
  turn: 0,
  speed: null,
  context: 0,
} as Stats)

const cache = atom({ plugin: 'session-band', key: 'cache' } as const, {
  expiresAt: null,
  secondsLeft: null,
} as Cache)

// Closed with ×: stays hidden for the rest of the session.
const isHidden = atom({ plugin: 'session-band', key: 'isHidden' } as const, false)

// A turn is running: the cache stays warm, so no countdown warnings.
const isBusy = atom({ plugin: 'session-band', key: 'isBusy' } as const, false)

// The smallest CACHE_NOTIFY_MINUTES already announced since the last answer; 0 none.
const warned = atom({ plugin: 'session-band', key: 'warned' } as const, 0)

// The Cache mod's own deadline: seeds ours after a reload missed the last turn.complete.
const cacheModExpiresAt = atom({ plugin: 'Cache', key: 'expiresAt' } as const, null)

// The usage-status mod's lock, MemPalace, GitHub and hub states, drawn as icons on
// this row when it runs; it keeps the words for one that is not OK in its own band.
const systems = atom({ plugin: 'usage-status', key: 'systems' } as const, {} as Systems)
// Their room on the row, in cells: the tiers below start this much wider when drawn.
const SYSTEMS_COLUMNS = 14

// Its usage row: drawn under this one as one grid (desktop), each column holding a
// top and a bottom cell, so the two rows share their icon size, style and places:
// 5h under the turn, 7d under the speed, the cache hit under the context.
const usageView = atom({ plugin: 'usage-status', key: 'view' } as const, { quotas: [], issues: [] } as UsageView)
// The quota texts' room ("→100%  1.23x") makes the first two columns this much wider.
const USAGE_COLUMNS = 12
// Fixed slots, in cells: the quota texts, and a % beside a bar ("100%").
const QUOTA_TEXT_WIDTH = 11
const PERCENT_WIDTH = 4

const ring = (color: string, glyph: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="${color}" stroke-width="2"/>
    ${glyph}</svg>`

const SPEED_ICON = ring(
  SPEED,
  `<path d="M6.5 15a6 6 0 0 1 11 0" fill="none" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/>
   <path d="M12 15l3-4" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/>`,
)

// The ring itself fills with the context, around a page of lines. The unfilled part
// is the ring's colour at partial strength, so it reads as full as the solid rings.
const contextIcon = (percent: number) => {
  const c = 2 * Math.PI * 10
  const filled = (Math.min(100, percent) / 100) * c
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="${CONTEXT}" stroke-opacity="0.4" stroke-width="2"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="${CONTEXT}" stroke-width="2" stroke-linecap="round"
      stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 12 12)"/>
    <g stroke="${CONTEXT}" stroke-width="1.6" stroke-linecap="round">
      <path d="M8.5 9h7M8.5 12h7M8.5 15h4.5"/>
    </g></svg>`
}

// An hourglass: the prompt cache running out.
const cacheIcon = (color: string) =>
  ring(
    color,
    `<g fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
       <path d="M8.5 6.5h7M8.5 17.5h7"/>
       <path d="M9.5 6.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M14.5 6.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5"/>
     </g>`,
  )

const line = (c: string, d: string) =>
  `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`

// Padlock: shackle open while the deploy lock is free, closed while held.
const lockIcon = (c: string, open: boolean) =>
  ring(c, `<rect x="8" y="11" width="8" height="6.5" rx="1.2" fill="none" stroke="${c}" stroke-width="1.6"/>
    ${line(c, open ? 'M9.8 11V8.6a2.2 2.2 0 0 1 4.4 0' : 'M9.8 11V9.2a2.2 2.2 0 0 1 4.4 0V11')}`)
// MemPalace: a pediment on three columns.
const mpIcon = (c: string) => ring(c, line(c, 'M7 10.2l5-3.2 5 3.2zM8.6 11.5v4.5M12 11.5v4.5M15.4 11.5v4.5M7 17.2h10'))
// GitHub: a branch.
const ghIcon = (c: string) =>
  ring(c, `<g fill="none" stroke="${c}" stroke-width="1.5"><circle cx="9.5" cy="7.6" r="1.4"/><circle cx="9.5" cy="16.4" r="1.4"/>
    <circle cx="14.8" cy="9.4" r="1.4"/></g>${line(c, 'M9.5 9v6M14.8 10.8c0 2.8-5.3 2.2-5.3 4.2')}`)
// Hub: a two-unit server.
const hubIcon = (c: string) =>
  ring(c, `<g fill="none" stroke="${c}" stroke-width="1.5"><rect x="7.5" y="7.2" width="9" height="4.2" rx="1"/>
    <rect x="7.5" y="12.6" width="9" height="4.2" rx="1"/></g>
    <circle cx="9.7" cy="9.3" r="0.8" fill="${c}"/><circle cx="9.7" cy="14.7" r="0.8" fill="${c}"/>`)
// The turn: a "#" in a ring, so the turn column's top cell is as tall as the rest.
const turnIcon = (c: string) =>
  ring(c, `<text x="12" y="16" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="11" font-weight="700" fill="${c}">#</text>`)
// A quota (5h, 7d): drawn like the context ring, filling with the used %, its label inside.
const quotaIcon = (c: string, percent: number, label: string) => {
  const len = 2 * Math.PI * 10
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * len
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-opacity="0.4" stroke-width="2"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"
      stroke-dasharray="${filled.toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 12 12)"/>
    <text x="12" y="15.4" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="9.5" font-weight="700" fill="${c}">${label}</text></svg>`
}
// The cache hit: a target in a ring, and a bar like the context bar.
const hitIcon = (c: string) =>
  ring(c, `<circle cx="12" cy="12" r="3.4" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="12" cy="12" r="1" fill="${c}"/>`)
const hitBar = (c: string, percent: number) => {
  const w = Math.round((Math.min(100, Math.max(0, percent)) / 100) * 80)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 6" width="80" height="6">
    <rect width="80" height="6" rx="3" fill="${MUTED}" fill-opacity="0.3"/>
    <rect width="${w}" height="6" rx="3" fill="${c}"/></svg>`
}

// Green OK, amber not OK, grey unknown.
const systemColor = (ok: boolean | undefined) => (ok === undefined ? MUTED : ok ? GOOD : WARN)

const pad = (n: number) => String(n).padStart(2, '0')

const contextBar = (percent: number) => {
  const color = percent >= 85 ? '#e0846b' : percent >= 65 ? '#e2a94e' : GOOD
  const w = Math.round((Math.min(100, percent) / 100) * 80)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 6" width="80" height="6">
    <rect width="80" height="6" rx="3" fill="${MUTED}" fill-opacity="0.3"/>
    <rect width="${w}" height="6" rx="3" fill="${color}"/></svg>`
}

// Density by the band's width in cells, so the row shrinks instead of wrapping:
// 0 full; 1 no context bar; 2 compact turn/speed; 3 no turn, smaller icons;
// 4 no speed. Thresholds are minimum bodyColumns for each tier.
const TIER_MIN = [78, 64, 52, 40] as const
const GAPS = [3, 2, 2, 1, 1] as const
const tierFor = (columns: number) => {
  const i = TIER_MIN.findIndex(min => columns >= min)
  return i === -1 ? TIER_MIN.length : i
}

// Last measured width, for `/session_data width` while tuning TIER_MIN; debug only.
let lastColumns: number | null = null

const refresh = async ($: EngineInterface) => {
  const { context } = await $.session.usage()
  await update($, stats, s => ({ ...s, context: context.percent ?? s.context }))
}

// Built by notifier/build.sh (macOS): posts the warning under Claude's icon.
const NOTIFIER = 'notifier/Session Band.app/Contents/MacOS/session-band-notifier'
// The desktop app's id for a local Code session, as its claude:// links take it.
const HOST_SESSION = /^local_[A-Za-z0-9-]{1,64}$/

// This session as the desktop app knows it: its id and the title in its sidebar.
// Null outside the desktop app; the title null when its record cannot be read.
const desktopSession = async ($: EngineInterface) => {
  const id = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  if (id === undefined || !HOST_SESSION.test(id)) return null

  const home = await $.env.get('HOME')
  const account = await $.env.get('CLAUDE_CODE_ACCOUNT_UUID')
  const org = await $.env.get('CLAUDE_CODE_ORGANIZATION_UUID')
  const record = `${home}/Library/Application Support/Claude/claude-code-sessions/${account}/${org}/${id}.json`
  const title = await $.fs.read(record).then(
    text => (JSON.parse(text) as { title?: unknown }).title,
    () => undefined,
  )

  return { id, title: typeof title === 'string' && title.trim() !== '' ? title.trim() : null }
}

// The notifier's system notification, titled with the project and the session, which
// opens this session when clicked. Without the notifier (not built, not macOS, or
// notifications not allowed), Claude Code's own notification, which also reaches
// the phone over Remote Control; it is skipped while the person is at this session,
// and then a toast says it instead.
const notifyCacheExpiry = async ($: EngineInterface, minutes: number) => {
  const project = (await $.session.cwd()).split('/').filter(Boolean).pop() ?? 'session'
  const message = `Prompt cache expires in ${minutes} min`

  const notifier = `${$.plugin.root}/${NOTIFIER}`
  if (await $.fs.exists(notifier)) {
    const session = await desktopSession($)
    const argv = [
      notifier,
      '-title',
      session?.title ? `${project} — ${session.title}` : project,
      '-message',
      message,
      '-group',
      `session-band-${session?.id ?? (await $.session.id())}`,
      ...(session ? ['-open', `claude://code/continue?session=${session.id}`] : []),
    ]
    // The first run waits while macOS asks whether to allow its notifications.
    const ran = await $.process.run(argv, { timeoutMs: 60_000 }).catch(() => null)
    if (ran?.exitCode === 0) return
  }

  const text = `${project}: ${message}`
  const sent = await $.tool
    .call({ tool: 'PushNotification', message: text, status: 'proactive' })
    .catch(() => null)
  const isDelivered =
    sent !== null &&
    sent.deny === undefined &&
    sent.isError !== true &&
    (sent.result.pushSent === true || sent.result.localSent === true)

  if (!isDelivered) $.ui.toast(`⏳ ${text}`, { timeoutMs: 30000 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.command.register({
      name: 'session_data',
      description: 'Show or hide the session band; `demo <minutes>` previews the cache warning',
    })

    $.clock.every(1000, async () => {
      const expiresAt = (await read($, cache)).expiresAt ?? (await read($, cacheModExpiresAt))
      if (expiresAt === null) return

      const left = Math.max(0, Math.floor((expiresAt - (await $.clock.now())) / 1000))
      if (left !== (await read($, cache)).secondsLeft) {
        await update($, cache, c => ({ expiresAt: c.expiresAt ?? expiresAt, secondsLeft: left }))
      }

      const due = CACHE_NOTIFY_MINUTES.filter(m => left > 0 && left <= m * 60)
      if (due.length === 0 || (await read($, isBusy))) return

      const minutes = Math.min(...due)
      const last = await read($, warned)
      if (last !== 0 && last <= minutes) return

      await update($, warned, () => minutes)
      await notifyCacheExpiry($, Math.ceil(left / 60))
    })

    return result
  })

  on('command.run', { command: 'session_data' }, async ($, e) => {
    // `/session_data demo <minutes>` fakes the cache deadline to preview the warnings;
    // the next answer resets it.
    const demo = e.args.trim().match(/^demo\s+(\d+(?:\.\d+)?)$/)
    if (demo) {
      const seconds = Math.round(Number(demo[1]) * 60)
      const now = await $.clock.now()
      await update($, cache, () => ({ expiresAt: now + seconds * 1000, secondsLeft: seconds }))
      await update($, warned, () => 0)
      await update($, isHidden, () => false)

      return { text: `Cache demo: ${demo[1]} min left until the next answer resets it.` }
    }

    if (e.args.trim() === 'width') {
      const columns = lastColumns
      return { text: columns === null ? 'Band not drawn yet.' : `Band: ${columns} columns, tier ${tierFor(columns)}.` }
    }

    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)

    return { text: hidden ? 'Session band hidden.' : 'Session band shown.' }
  })

  on('turn.start', async ($, e, next) => {
    await update($, stats, s => ({ ...s, turn: s.turn + 1 }))
    await update($, isBusy, () => true)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    // Measured from the response's first item (its envelope, message_start), so
    // time-to-first-token is excluded but thinking that streams hidden or in one
    // late burst is still timed: output_tokens counts it.
    let startedAt: number | null = null

    for await (const chunk of next(e)) {
      if (startedAt === null) {
        startedAt = await $.clock.now()
      }

      if (chunk.kind === 'stop' && chunk.usage !== null) {
        const tokens = chunk.usage.output_tokens
        const seconds = ((await $.clock.now()) - startedAt) / 1000
        const speed = tokens / seconds
        if (tokens >= MIN_TOKENS && seconds >= MIN_SECONDS && speed <= MAX_SPEED) {
          await update($, stats, s => ({ ...s, speed: Math.round(speed) }))
        }
      }

      yield chunk
    }

    await refresh($)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, cache, () => ({ expiresAt: now + CACHE_TTL_MS, secondsLeft: CACHE_TTL_MS / 1000 }))
      await update($, isBusy, () => false)
      await update($, warned, () => 0)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, stats)
    if (e.props.hasSurvey || s.turn === 0 || (await read($, isHidden))) return next(e)

    // Other mods' bands go beneath this row. Claude Code's own placeholder
    // ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const speed = s.speed === null ? '—' : `${s.speed} tok/s`

    const { secondsLeft } = await read($, cache)
    const level =
      e.props.isWorking || secondsLeft === null
        ? null
        : secondsLeft <= CACHE_ALERT_S
          ? ALERT
          : secondsLeft <= CACHE_WARN_S
            ? WARN
            : null
    const cacheColor = level ?? CACHE
    const cacheText =
      e.props.isWorking ? '…'
      : secondsLeft === null ? '—'
      : secondsLeft === 0 ? 'expired'
      : `${pad(Math.floor(secondsLeft / 60))}:${pad(secondsLeft % 60)}`

    // A system status mod's icons, on the desktop (SVG) only; none while it does not run.
    const sys = await read($, systems)
    // The terminal's table has an Svg too (drawn as nothing), so ask for the desktop.
    const desktop = e.surface === 'desktop' && Svg !== null
    const showSystems = desktop && Object.keys(sys ?? {}).length > 0

    // The usage-status mod's row, drawn under this one as one grid (desktop only).
    const usage = desktop ? await read($, usageView) : null
    const grid =
      desktop && usage !== null && (usage.quotas.length > 0 || usage.hit !== undefined || usage.issues.length > 0)

    lastColumns = e.props.bodyColumns
    const tier = tierFor(
      e.props.bodyColumns - (showSystems ? SYSTEMS_COLUMNS : 0) - (grid && usage.quotas.length > 0 ? USAGE_COLUMNS : 0),
    )
    const icon = tier >= 3 ? 18 : 22

    if (Svg && grid) {
      // Each column a top and a bottom cell, left-aligned, so every icon sits over
      // the one below it; every cell has an icon, so the two rows keep one height.
      const cell = (key: string, children: unknown[]) => (
        <Box key={key} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {children as never}
        </Box>
      )
      const column = (key: string, top: unknown, bottom: unknown = null) => (
        // No gap between the rows (operator 14OCT26: a full line apart was too far).
        <Box key={key} flexDirection="column" alignItems="flex-start" rowGap={0} flexShrink={0}>
          {top as never}
          {bottom as never}
        </Box>
      )
      const quota = (i: number) => {
        const q = usage.quotas[i]
        if (!q) return null
        return cell(`q${i}`, [
          <Svg key="i" source={quotaIcon(q.color, q.pct, q.label)} alt={q.label} width={icon} height={icon} />,
          <Box key="t" flexDirection="row" columnGap={1} minWidth={QUOTA_TEXT_WIDTH} flexShrink={0}>
            {q.texts.map((t, n) => (
              <Text key={String(n)} bold={!t.dim} dimColor={t.dim} color={t.color}>{t.text}</Text>
            ))}
          </Box>,
        ])
      }
      const hit = usage.hit
      // Both bars, context and cache hit, at every tier but the two narrowest
      // (operator 14OCT26: keep the bars), always together so they line up.
      const showBars = tier <= 2
      return (
        <Box flexDirection="column">
          <Box
            flexDirection="row"
            alignItems="flex-start"
            columnGap={GAPS[tier]}
            flexWrap="nowrap"
            overflow="hidden"
            paddingX={1}
            {...(level ? { borderStyle: 'round', borderColor: level } : {})}
          >
            {column(
              'turn',
              cell('turn', [
                <Svg key="i" source={turnIcon(MUTED)} alt="turn" width={icon} height={icon} />,
                tier <= 1 ? <Text key="l" dimColor>Turn</Text> : null,
                <Text key="n" bold>{String(s.turn)}</Text>,
              ]),
              quota(0),
            )}
            {column(
              'speed',
              cell('speed', [
                <Svg key="i" source={SPEED_ICON} alt="speed" width={icon} height={icon} />,
                tier <= 3 ? (
                  <Box key="speed" minWidth={tier <= 1 ? SPEED_WIDTH : SPEED_WIDTH_COMPACT} flexShrink={0}>
                    <Text bold wrap="truncate-end">{tier <= 1 || s.speed === null ? speed : `${s.speed}/s`}</Text>
                  </Box>
                ) : null,
              ]),
              quota(1),
            )}
            {column(
              'cache',
              cell('cache', [
                <Svg key="i" source={cacheIcon(cacheColor)} alt="cache" width={icon} height={icon} />,
                <Box key="countdown" minWidth={COUNTDOWN_WIDTH} flexShrink={0}>
                  <Text bold color={level ?? undefined}>{cacheText}</Text>
                </Box>,
              ]),
            )}
            {showSystems
              ? column(
                  'systems',
                  cell('systems', [
                    <Svg key="l" source={lockIcon(systemColor(sys.lock), sys.lock === true)} alt="lock" width={icon} height={icon} />,
                    <Svg key="m" source={mpIcon(systemColor(sys.mp))} alt="MemPalace" width={icon} height={icon} />,
                    <Svg key="g" source={ghIcon(systemColor(sys.gh))} alt="GitHub" width={icon} height={icon} />,
                    <Svg key="h" source={hubIcon(systemColor(sys.hub))} alt="hub" width={icon} height={icon} />,
                  ]),
                )
              : null}
            <Box flexGrow={1} flexShrink={1} />
            {column(
              'context',
              cell('context', [
                <Svg key="i" source={contextIcon(s.context)} alt="context" width={icon} height={icon} />,
                showBars ? <Svg key="b" source={contextBar(s.context)} alt={`context ${s.context}%`} width={80} height={6} /> : null,
                <Box key="p" minWidth={PERCENT_WIDTH} flexShrink={0}><Text bold>{`${s.context}%`}</Text></Box>,
              ]),
              hit
                ? cell('hit', [
                    <Svg key="i" source={hitIcon(hit.color)} alt="cache hit" width={icon} height={icon} />,
                    showBars ? <Svg key="b" source={hitBar(hit.color, hit.pct)} alt={`cache hit ${hit.pct}%`} width={80} height={6} /> : null,
                    <Box key="p" minWidth={PERCENT_WIDTH} flexShrink={0}><Text bold color={hit.color}>{`${hit.pct}%`}</Text></Box>,
                  ])
                : null,
            )}
            <Button key="hide" label="×" role="dismiss" plain dimColor onPress={() => update($, isHidden, () => true)} />
          </Box>
          {usage.issues.length > 0 ? (
            <Box flexDirection="row" columnGap={1} flexWrap="wrap" paddingX={1}>
              {usage.issues.map((i, n) => (
                <Box key={i.key} flexDirection="row" columnGap={1}>
                  {n > 0 ? <Text dimColor>·</Text> : null}
                  <Text bold color={i.color}>{i.text}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
          {below}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
      <Box
        flexDirection="row"
        alignItems="center"
        columnGap={GAPS[tier]}
        flexWrap="nowrap"
        overflow="hidden"
        paddingX={1}
        {...(level ? { borderStyle: 'round', borderColor: level } : {})}
      >
        {tier <= 2 ? (
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            {tier <= 1 ? <Text dimColor>Turn</Text> : <Text dimColor>#</Text>}
            <Text bold>{String(s.turn)}</Text>
          </Box>
        ) : null}
        {tier <= 3 ? (
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            {Svg ? <Svg source={SPEED_ICON} alt="speed" width={icon} height={icon} /> : <Text color={SPEED}>⚡</Text>}
            <Box key="speed" minWidth={tier <= 1 ? SPEED_WIDTH : SPEED_WIDTH_COMPACT} flexShrink={0}>
              <Text bold wrap="truncate-end">{tier <= 1 || s.speed === null ? speed : `${s.speed}/s`}</Text>
            </Box>
          </Box>
        ) : null}
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {Svg ? <Svg source={cacheIcon(cacheColor)} alt="cache" width={icon} height={icon} /> : <Text color={cacheColor}>⧗</Text>}
          <Box key="countdown" minWidth={COUNTDOWN_WIDTH} flexShrink={0}>
            <Text bold color={level ?? undefined}>{cacheText}</Text>
          </Box>
        </Box>
        {Svg && showSystems ? (
          <Box key="systems" flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            <Svg source={lockIcon(systemColor(sys.lock), sys.lock === true)} alt="lock" width={icon} height={icon} />
            <Svg source={mpIcon(systemColor(sys.mp))} alt="MemPalace" width={icon} height={icon} />
            <Svg source={ghIcon(systemColor(sys.gh))} alt="GitHub" width={icon} height={icon} />
            <Svg source={hubIcon(systemColor(sys.hub))} alt="hub" width={icon} height={icon} />
          </Box>
        ) : null}
        <Box flexGrow={1} flexShrink={1} />
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {Svg ? <Svg source={contextIcon(s.context)} alt="context" width={icon} height={icon} /> : null}
          {Svg && tier === 0 ? (
            <Svg source={contextBar(s.context)} alt={`context ${s.context}%`} width={80} height={6} />
          ) : null}
          <Text bold>{`${s.context}%`}</Text>
        </Box>
        <Button key="hide" label="×" role="dismiss" plain dimColor onPress={() => update($, isHidden, () => true)} />
      </Box>
      {below}
      </Box>
    )
  })
}
