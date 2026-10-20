import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Game, TableSettings, View } from '../types'
import * as E from './engine'
import { drawPane } from './view'
import type { Controls } from './view'

const PANE = 'blackjack'
const PANE_OPEN = { id: PANE, title: 'Blackjack', rows: 26, columns: 46 } as const

const GAME = { plugin: 'blackjack', key: 'game' } as const
const SETTINGS = { plugin: 'blackjack', key: 'settings' } as const

const game = atom(GAME, E.newGame(E.DEFAULT_RULES))
const settings = atom(SETTINGS, E.DEFAULT_SETTINGS)
const view = atom({ plugin: 'blackjack', key: 'view' } as const, 'table')
const claude = atom({ plugin: 'blackjack', key: 'claude' } as const, {
  isWorking: false,
  since: 0,
  lastMs: null,
  attention: null,
})
const now = atom({ plugin: 'blackjack', key: 'now' } as const, 0)
const limit = atom({ plugin: 'blackjack', key: 'limit' } as const, null)
const isDismissed = atom({ plugin: 'blackjack', key: 'isDismissed' } as const, false)
const confirm = atom({ plugin: 'blackjack', key: 'confirm' } as const, null)

const DEALER_BEAT = { normal: 600, fast: 250, instant: 0 } as const
const LOCKED = 'Finish the hand before changing the table rules.'
/** How often the table looks at the clock for the five-hour window's end. */
const WATCH_MS = 30_000

// The module's own timers: a reload drops them, and session.start restarts what it needs.
let isDealing = false
let ticker: Timer | undefined
let watch: Timer | undefined

const entropy = () => crypto.getRandomValues(new Uint32Array(1))[0]! | 0

async function showStatus($: EngineInterface) {
  const current = await read($, game)
  const { prefs } = await read($, settings)
  const inPlay = E.onTable(current)
  const text = `♠ ${E.money(current.bankroll)}${inPlay > 0 ? ` · ${E.money(inPlay)} in play` : ''}`
  $.ui.status(prefs.statusLine ? text : undefined)
}

/** Applies a change to the game, keeps it, and starts the dealer when it is the dealer's turn. */
async function commit($: EngineInterface, change: (game: Game, settings: TableSettings) => Game) {
  const held = await read($, settings)
  await update($, game, current => change(current, held))
  const after = await read($, game)
  await $.store.set('game', after)
  await showStatus($)
  if (after.phase === 'dealer') await playDealer($)
  else if (after.phase === 'betting') await syncWindow($)
}

/** Deals the next five-hour window's chips once this one is over, and keeps its reset time current. */
async function syncWindow($: EngineInterface) {
  const time = await $.clock.now()
  const reading = await read($, limit)
  const { rules } = await read($, settings)
  const before = await read($, game)
  if (E.syncWindow(before, rules, reading, time) === before) return
  await update($, game, current => E.syncWindow(current, rules, reading, time))
  await $.store.set('game', await read($, game))
  await showStatus($)
}

/** Takes the five-hour limit's reset from a rate-limit reading, then brings the window in step. */
async function noteLimits($: EngineInterface, limits: readonly { kind: string; resetsAt?: string }[]) {
  const reading = E.fiveHourReset(limits)
  if (reading !== null) await update($, limit, () => reading)
  await syncWindow($)
}

function startWatch($: EngineInterface) {
  watch?.cancel()
  watch = $.clock.every(WATCH_MS, () => void watchTick($))
}

async function watchTick($: EngineInterface) {
  await tick($)
  await syncWindow($)
}

/** Plays the dealer's hand a beat at a time on the clock, or all at once at instant speed. */
async function playDealer($: EngineInterface) {
  if (isDealing) return
  isDealing = true
  const { prefs } = await read($, settings)
  if (DEALER_BEAT[prefs.speed] === 0) await dealerBeat($)
  else $.clock.after(DEALER_BEAT[prefs.speed], () => void dealerBeat($))
}

async function dealerBeat($: EngineInterface) {
  try {
    const held = await read($, settings)
    const isInstant = held.prefs.speed === 'instant'
    await update($, game, current => (isInstant ? E.finishDealer(current, held) : E.dealerStep(current, held)))
    const after = await read($, game)
    if (after.phase === 'dealer') {
      $.clock.after(DEALER_BEAT[held.prefs.speed] || DEALER_BEAT.fast, () => void dealerBeat($))

      return
    }
    isDealing = false
    await $.store.set('game', after)
    await showStatus($)
    await syncWindow($)
  } catch (error) {
    isDealing = false
    $.ui.log(`blackjack: the dealer stopped: ${String(error)}`)
  }
}

function startTicker($: EngineInterface) {
  ticker?.cancel()
  ticker = $.clock.every(1000, () => void tick($))
}

async function tick($: EngineInterface) {
  const time = await $.clock.now()
  await update($, now, () => time)
}

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

async function openPane($: EngineInterface, isAsked: boolean) {
  if (isAsked) await update($, isDismissed, () => false)
  const opened = await $.ui.open(isAsked ? { ...PANE_OPEN, focus: true } : PANE_OPEN)
  await showStatus($)

  return opened
}

async function show($: EngineInterface, next: View) {
  await update($, confirm, () => null)
  await update($, view, () => next)
  await commit($, current => E.withNotice(current, null))
}

async function dealHand($: EngineInterface) {
  const held = await read($, settings)
  const status = await read($, claude)
  if (held.prefs.workOnly && !status.isWorking) {
    await commit($, current =>
      E.withNotice(current, 'The table is locked until Claude starts working (Rules: Lock table when idle).'),
    )

    return
  }
  await syncWindow($)
  const seed = entropy()
  await commit($, (current, rules) => E.deal(current, rules, seed))
}

async function changeSetting($: EngineInterface, id: string) {
  const row = E.SETTINGS.find(one => one.id === id)
  if (row === undefined) return
  if (row.group === 'rules' && (await read($, game)).phase !== 'betting') {
    await commit($, current => E.withNotice(current, LOCKED))

    return
  }
  await update($, settings, current => E.changeSetting(current, id))
  await $.store.set('settings', await read($, settings))
  const notice = id === 'bankroll' ? 'The new amount is dealt from the next five-hour window.' : null
  await commit($, (current, held) => E.withNotice(E.fitBet(current, held.rules), notice))
}

async function restoreRules($: EngineInterface) {
  if ((await read($, game)).phase !== 'betting') {
    await commit($, current => E.withNotice(current, LOCKED))

    return
  }
  await update($, settings, current => ({ ...current, rules: E.DEFAULT_RULES }))
  await $.store.set('settings', await read($, settings))
  await commit($, (current, held) => E.withNotice(E.fitBet(current, held.rules), 'House rules restored.'))
}

/** Resets chips, stats and window records on the second press. */
async function reset($: EngineInterface) {
  if ((await read($, confirm)) !== 'reset') {
    await update($, confirm, () => 'reset')

    return
  }
  await update($, confirm, () => null)
  await commit($, (current, held) => E.resetGame(current, held.rules))
}

function controlsFor($: EngineInterface): Controls {
  return {
    chip: dollars => commit($, (current, held) => E.addChip(current, held.rules, dollars)),
    removeChip: () => commit($, (current, held) => E.removeChip(current, held.rules)),
    clearBet: () => commit($, (current, held) => E.clearBet(current, held.rules)),
    doubleBet: () => commit($, (current, held) => E.doubleBet(current, held.rules)),
    maxBet: () => commit($, (current, held) => E.maxBet(current, held.rules)),
    deal: () => dealHand($),
    insure: isTaken => commit($, (current, held) => E.insure(current, held, isTaken)),
    play: action => commit($, (current, held) => E.play(current, held, action)),
    show: next => show($, next),
    change: id => changeSetting($, id),
    restoreRules: () => restoreRules($),
    reset: () => reset($),
  }
}

/** A fresh session reads the chips back from the store; a reload keeps what $.state holds. */
async function restore($: EngineInterface) {
  if ((await $.state.get(GAME)).version === 0) {
    const stored = E.reviveGame(await $.store.get('game'))
    if (stored !== null) await $.state.set(GAME, stored)
  }
  if ((await $.state.get(SETTINGS)).version === 0) {
    const stored = E.reviveSettings(await $.store.get('settings'))
    if (stored !== null) await $.state.set(SETTINGS, stored)
  }
  if ((await read($, game)).phase === 'dealer') await playDealer($)
  if ((await read($, claude)).isWorking) startTicker($)
}

/** The rate-limit windows as the session last had them; none where it cannot say. */
async function usageLimits($: EngineInterface) {
  try {
    return (await $.session.usage()).rateLimits
  } catch {
    return []
  }
}

async function autoOpen($: EngineInterface) {
  const { prefs } = await read($, settings)
  if (!prefs.autoOpen || (await read($, isDismissed))) return
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (!isOpen) await openPane($, false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'blackjack',
      description: 'Play blackjack with fake money in a pane beside the chat',
      argumentHint: '[close|rules|stats|records|help|reset]',
      immediate: true,
    })
    await restore($)
    await tick($)
    await noteLimits($, await usageLimits($))
    startWatch($)

    return next(e)
  })

  // A rate-limit reading moved: the five-hour window may have reset.
  on('session.measure', async ($, e, next) => {
    await noteLimits($, e.rateLimits)

    return next(e)
  })

  on('command.run', { command: 'blackjack' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close' || arg === 'hide') {
      await $.ui.close({ id: PANE })

      return { text: 'Blackjack table closed. /blackjack brings it back.' }
    }
    if (arg === 'reset') await commit($, (current, held) => E.resetGame(current, held.rules))
    const target: View =
      arg === 'rules' || arg === 'settings'
        ? 'rules'
        : arg === 'stats'
          ? 'stats'
          : arg === 'records' || arg === 'windows'
            ? 'records'
            : arg === 'help'
              ? 'help'
              : 'table'
    await update($, view, () => target)
    const opened = await openPane($, true)
    const chips = E.money((await read($, game)).bankroll)
    if (!opened.isPlaced) return { text: `The blackjack table is waiting for room: ${opened.reason}` }

    return { text: `Blackjack table open with ${chips} in fake chips. Click it, or press ctrl+x then tab, to play.` }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const time = await $.clock.now()
    await update($, claude, status => ({ ...status, isWorking: true, since: time, attention: null }))
    await update($, now, () => time)
    startTicker($)
    void autoOpen($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    stopTicker()
    await update($, claude, status => ({ ...status, isWorking: false, lastMs: e.durationMs, attention: null }))

    return next(e)
  })

  // Claude is waiting on the person (a permission prompt): the table says so.
  on('classic.Notification', async ($, e, next) => {
    if (/permission|elicitation/.test(e.notification_type)) {
      await update($, claude, status => ({ ...status, attention: e.message }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if ((await read($, claude)).attention !== null) {
      await update($, claude, status => ({ ...status, attention: null }))
    }

    return ran
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, isDismissed, () => true)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const scene = {
      game: await read($, game),
      settings: await read($, settings),
      view: await read($, view),
      claude: await read($, claude),
      now: await read($, now),
      confirm: await read($, confirm),
      columns: e.props.bodyColumns,
      rows: e.props.scroll.bodyRows,
    }

    return drawPane(kit, scene, controlsFor($))
  })
}
