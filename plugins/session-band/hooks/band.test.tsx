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
