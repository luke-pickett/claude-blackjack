import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'blackjack',
  component: 'Pane',
  requestId: 'blackjack',
  props: {
    title: 'Blackjack',
    isFocused: true,
    bodyColumns: 46,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 19, 18)

const fiveHour = (resetsAt: number) => [{ kind: 'five_hour', percentUsed: 12, resetsAt: new Date(resetsAt).toISOString() }]

/** Stands in for the engine beneath the plugin; the five-hour limit resets an hour in. */
function engine(on: On) {
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'blackjack' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: fiveHour(NOW + HOUR) },
  }))
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })

  return { opened, clock }
}

test('a hand is bet, dealt and played to the end, on every surface', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /BLACKJACK/ })).toBeDefined()

    await ui.press({ key: 'bet-clear' })
    await ui.press({ key: 'chip-1' })
    await ui.press({ key: 'chip-0' })
    expect(await ui.find({ type: 'Text', text: /^\$30$/ })).toBeDefined()

    await ui.press({ key: 'deal' })
    expect(await ui.find({ type: 'Text', text: /DEALER/ })).toBeDefined()
    if ((await ui.find({ key: 'insure-no' })) !== undefined) await ui.press({ key: 'insure-no' })
    if ((await ui.find({ key: 'play-stand' })) !== undefined) await ui.press({ key: 'play-stand' })
    await clock.advance(10_000)

    expect(await ui.find({ key: 'play-stand' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /win|wins|Push|Bust|Blackjack|money|Surrendered/ })).toBeDefined()
    expect(await ui.find({ key: 'deal' })).toBeDefined()
    await ui.unmount()
  }
})

test('the rules view changes a rule and goes back', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'view-rules' })
    expect(await ui.find({ type: 'Text', text: /TABLE RULES/ })).toBeDefined()
    const before = (await ui.find({ key: 'set-pays' }))?.text
    await ui.press({ key: 'set-pays' })
    const after = (await ui.find({ key: 'set-pays' }))?.text
    expect(after).not.toBe(before)
    await ui.press({ key: 'rules-back' })
    expect(await ui.find({ key: 'deal' })).toBeDefined()
    await ui.unmount()
  }
})

test('the table opens when Claude starts working and shows when it is done', async ($, on) => {
  const { opened, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  await clock.settle()
  expect(opened).toEqual(['blackjack'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(3000)
  expect((await ui.find({ type: 'Text', text: /Claude working/ }))?.text).toContain('3s')

  await $.turn.complete({ answer: 'done', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await ui.find({ type: 'Text', text: /Claude done/ }))?.text).toContain('42s')
  await ui.unmount()
})

test('with deal-only-while-working on, the table waits for Claude', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view-rules' })
  await ui.press({ key: 'set-workOnly' })
  await ui.press({ key: 'rules-back' })
  expect(await ui.find({ key: 'deal' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Dealing opens while Claude works/ })).toBeDefined()

  await $.turn.start({ text: 'go', turnId: 't2' })
  expect(await ui.find({ key: 'deal' })).toBeDefined()
  await ui.unmount()
})

test('a five-hour reset deals fresh chips, and Records keeps the window before', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'view-records' })
    expect(await ui.find({ type: 'Text', text: /FIVE-HOUR WINDOWS/ })).toBeDefined()
    await ui.press({ key: 'records-back' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /new chips in 1h 00m/ })).toBeDefined()

  await ui.press({ key: 'bet-max' })
  await ui.press({ key: 'deal' })
  if ((await ui.find({ key: 'insure-no' })) !== undefined) await ui.press({ key: 'insure-no' })
  if ((await ui.find({ key: 'play-stand' })) !== undefined) await ui.press({ key: 'play-stand' })
  await clock.advance(10_000)
  expect(await ui.find({ key: 'deal' })).toBeDefined()

  await clock.advance(HOUR)
  expect(await ui.find({ type: 'Text', text: /New five-hour window: \$1,000 in fresh chips/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$1,000$/ })).toBeDefined()

  // Claude's next reply reports when the new window resets.
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: fiveHour(clock.now() + 5 * HOUR),
    changed: ['rateLimits'],
  })
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: /new chips in (4h 5\dm|5h 00m)/ })).toBeDefined()

  await ui.press({ key: 'view-records' })
  expect(await ui.find({ type: 'Text', text: /PAST WINDOWS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /None yet/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^0 rounds from \$1,000$/ })).toBeDefined()
  await ui.unmount()

  const shown = await $.command.run({ ...RUN, command: 'blackjack', args: 'records' })
  expect(shown.text).toMatch(/Blackjack table open/)
})

test('/blackjack opens the table, and /blackjack close closes it', async ($, on) => {
  const { opened } = engine(on)
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const open = await $.command.run({ ...RUN, command: 'blackjack', args: '' })
  expect(open.text).toMatch(/\$1,000 in fake chips/)
  expect(opened).toEqual(['blackjack'])
  await $.command.run({ ...RUN, command: 'blackjack', args: 'close' })
  expect(closed).toEqual(['blackjack'])
})
