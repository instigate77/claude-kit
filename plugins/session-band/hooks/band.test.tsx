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

// One model response that reports these tokens; agentId set for a subagent's.
const USAGE = { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 200_000 }
async function respond($: Engine, agentId?: string) {
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 't1', index: 0, model: USAGE.model, messageCount: 1, agentId })
  for await (const _ of stream) void _
}

async function moneyTexts($: Engine) {
  const ui = await $.ui.mount({ plugin: 'session-band', surface: 'desktop', ...BAND })
  const texts = [
    ...(await ui.findAll({ type: 'Text', text: /tok$/ })),
    ...(await ui.findAll({ type: 'Text', text: /^\$/ })),
  ].map(t => JSON.stringify(t))
  await ui.unmount()
  return texts.join(' ')
}

// The $ item: the session's tokens (every kind, subagents too) and its total cost.
test('$ item shows session tokens and total cost, counting subagent responses', async ($, on) => {
  on('turn.step', async function* () {
    yield { kind: 'stop', ref: 0, stopReason: 'end_turn', usage: USAGE }
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  } as never)
  await session($, on)
  const before = await moneyTexts($)
  expect(before).toContain('0 tok')
  expect(before).toContain('$0.42')

  // 1,000 + 500 + 1,000,000 + 200,000 = 1,201,500 per response; two responses.
  await respond($)
  await respond($, 'a1')
  const after = await moneyTexts($)
  expect(after).toContain('2.4M tok')
  expect(after).toContain('$0.42')
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
