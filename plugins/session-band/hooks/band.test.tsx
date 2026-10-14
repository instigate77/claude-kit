import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never } as const

// One answered turn, so the band has something to draw.
async function session($: Engine, on: On) {
  mock.clock(on, { now: Date.parse('2026-10-14T18:00:00Z') })
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: [], cost: { usd: 0.42 }, context: { percent: 12 } } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('turn.start', async () => ({ turnId: 't1' }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'hi', turnId: 't1' } as never)
}

async function band($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'session-band', surface, ...BAND })
  const turn = await ui.findAll({ type: 'Text', text: /^Turn$/ })
  const other = await ui.findAll({ type: 'Text', text: /^OTHER BAND$/ })
  await ui.unmount()
  return { turn: turn.length, other: other.length }
}

// The band shows no cost: nothing in it starts with "$".
test('band has no cost item', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'session-band', surface: 'desktop', ...BAND })
  const turn = await ui.findAll({ type: 'Text', text: /^Turn$/ })
  const money = await ui.findAll({ type: 'Text', text: /^\$/ })
  await ui.unmount()
  expect(turn.length).toBe(1)
  expect(money.length).toBe(0)
})

// A system status mod (usage-status) running beside it: its four states drawn as
// icons on this row, on the desktop; green OK, amber not OK, grey unknown.
const statusMod = {
  name: 'usage-status',
  register: (on: On) => {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'usage-status', key: 'systems' } as never, { lock: false, mp: true, gh: undefined, hub: true } as never)
      return next(e)
    })
  },
}

async function systemIcons($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'session-band', surface, ...BAND })
  const icons = await ui.findAll({ type: 'Svg' })
  await ui.unmount()
  return icons.map(i => JSON.stringify(i)).filter(t => /"alt":"(lock|MemPalace|GitHub|hub)"/.test(t))
}

test('desktop: a status mod\'s systems are icons on the row, coloured by state', { plugins: [statusMod] as never }, async ($, on) => {
  await session($, on)
  const icons = await systemIcons($, 'desktop')
  expect(icons).toHaveLength(4)
  expect(icons[0]).toContain('stroke=\\"#e2a94e\\"') // lock held
  expect(icons[0]).toContain('M9.8 11V9.2') // closed shackle
  expect(icons[1]).toContain('stroke=\\"#4caf6e\\"') // MemPalace up
  expect(icons[2]).toContain('stroke=\\"#8a8f8c\\"') // GitHub unknown
  expect(icons[3]).toContain('stroke=\\"#4caf6e\\"') // hub up
})

// The texts that change length sit in fixed slots, so the items after them hold
// still: speed 10 cells ("1000 tok/s"), the cache countdown 7 ("expired").
test('speed and countdown have fixed-width slots', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'session-band', surface: 'desktop', ...BAND })
  const tree = JSON.stringify(await ui.drawn())
  await ui.unmount()
  expect(tree).toContain('"key":"speed","minWidth":10')
  expect(tree).toContain('"key":"countdown","minWidth":7')
})

// The usage-status mod's row: drawn under this one as one grid on the desktop.
const usageMod = {
  name: 'usage-status',
  register: (on: On) => {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'usage-status', key: 'systems' } as never, { lock: true, mp: true, gh: true, hub: true } as never)
      await $.state.set({ plugin: 'usage-status', key: 'view' } as never, {
        quotas: [
          { label: '5h', pct: 10, color: '#4caf6e', texts: [{ text: '→40%', color: '#4caf6e' }, { text: '0.40x', color: '#4caf6e' }] },
          { label: '7d', pct: 85, color: '#e2a94e', texts: [{ text: '→95%', color: '#e2a94e' }] },
        ],
        hit: { pct: 90, color: '#4caf6e' },
        issues: [{ key: 'hub', text: 'Hub DOWN', color: '#e2a94e' }],
      } as never)
      return next(e)
    })
  },
}

// Wide enough for the full tier (bars shown) with the system icons and quota texts.
async function drawn($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'session-band', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } as never })
  const tree = (await ui.drawn()) as any
  await ui.unmount()
  return tree
}

// Each column a top and a bottom cell: 5h under the turn, 7d under the speed, the
// cache hit under the context; one icon size throughout; issue words on a line below.
test('desktop: with usage-status, both rows are one grid', { plugins: [usageMod] as never }, async ($, on) => {
  await session($, on)
  const tree = await drawn($, 'desktop')
  const [grid, words] = tree.children
  const columns = grid.children.filter((c: any) => c.props?.flexDirection === 'column')
  const alts = (cellBox: any) => JSON.stringify(cellBox).match(/"alt":"[^"]+"/g)
  expect(columns.map((c: any) => c.props.key)).toEqual(['turn', 'speed', 'cache', 'systems', 'context'])
  const [turn, speed, , , context] = columns
  expect(alts(turn.children[0])).toEqual(['"alt":"turn"'])
  expect(alts(turn.children[1])).toEqual(['"alt":"5h"'])
  expect(alts(speed.children[1])).toEqual(['"alt":"7d"'])
  expect(alts(context.children[0])).toEqual(['"alt":"context"', '"alt":"context 0%"'])
  expect(alts(context.children[1])).toEqual(['"alt":"cache hit"', '"alt":"cache hit 90%"'])
  const sizes = JSON.stringify(grid).match(/"width":(\d+),"height":\1/g)
  expect(new Set(sizes)).toEqual(new Set(['"width":22,"height":22']))
  expect(JSON.stringify(words)).toContain('["Hub DOWN"]')
})

// The bars stay at an ordinary width (operator 14OCT26): 100 columns, the grid's
// extra columns taken off, still draws both, one over the other.
test('desktop: grid keeps both bars at 100 columns', { plugins: [usageMod] as never }, async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'session-band', surface: 'desktop', ...BAND })
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  expect(text).toContain('"alt":"context 0%","width":80')
  expect(text).toContain('"alt":"cache hit 90%","width":80')
})

test('terminal: with usage-status, the single row as before', { plugins: [usageMod] as never }, async ($, on) => {
  await session($, on)
  const text = JSON.stringify(await drawn($, 'terminal'))
  expect(text).not.toContain('"flexDirection":"column","alignItems":"flex-start"')
  expect(text).not.toContain('Hub DOWN')
})

test('desktop: no status mod, no system icons', async ($, on) => {
  await session($, on)
  expect(await systemIcons($, 'desktop')).toHaveLength(0)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: another mod's band is drawn beneath this one`, async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box>
          <Text>OTHER BAND</Text>
        </Box>
      )
    })
    await session($, on)
    expect(await band($, surface)).toEqual({ turn: 1, other: 1 })
  })

  test(`${surface}: alone, it draws its own row`, async ($, on) => {
    await session($, on)
    expect(await band($, surface)).toEqual({ turn: 1, other: 0 })
  })
}
