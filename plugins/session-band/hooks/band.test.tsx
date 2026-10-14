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
