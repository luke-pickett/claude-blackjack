import { expect, test } from 'claude-code/testing'

import * as E from '../hooks/engine'
import type { Card, Game, Rules, TableSettings } from '../types'

const A = 1
const J = 11
const Q = 12
const K = 13

/** A card by rank (1 = ace .. 13 = king) and suit (0 ♠, 1 ♥, 2 ♦, 3 ♣). */
const card = (rank: number, suit = 0): Card => suit * 13 + (rank - 1)

const rulesWith = (rules: Partial<Rules>): TableSettings => ({
  ...E.DEFAULT_SETTINGS,
  rules: { ...E.DEFAULT_RULES, ...rules },
})

/** A game whose cards come off the shoe in the order given: player, upcard, player, hole, then draws. */
function stacked(ranks: number[], settings = E.DEFAULT_SETTINGS, bet = 2500): Game {
  const filler = Array.from({ length: 200 }, (_, at) => card(2 + (at % 5), at % 4))
  const shoe = [...filler, ...ranks.map((rank, at) => card(rank, at % 4)).reverse()]

  return { ...E.newGame(settings.rules), bet, shoe, shoeSize: shoe.length, shoeDecks: settings.rules.decks }
}

test('hands total with aces soft or hard', () => {
  expect(E.handTotal([card(A), card(6)])).toEqual({ total: 17, isSoft: true })
  expect(E.handTotal([card(A), card(6), card(10)])).toEqual({ total: 17, isSoft: false })
  expect(E.handTotal([card(A), card(A), card(9)])).toEqual({ total: 21, isSoft: true })
  expect(E.handTotal([card(K), card(Q), card(2)]).total).toBe(22)
  expect(E.isBlackjack([card(A), card(J)])).toBe(true)
  expect(E.isBlackjack([card(A), card(5), card(5)])).toBe(false)
})

test('money reads as dollars', () => {
  expect(E.money(125000)).toBe('$1,250')
  expect(E.money(750)).toBe('$7.50')
  expect(E.money(-2500)).toBe('−$25')
  expect(E.money(2500, true)).toBe('+$25')
  expect(E.money(0, true)).toBe('$0')
})

test('a natural pays 3:2, or 6:5 where the table says', () => {
  const won = E.deal(stacked([A, 9, K, 7]), E.DEFAULT_SETTINGS, 1)
  expect(won.phase).toBe('betting')
  expect(won.hands[0]?.result).toBe('blackjack')
  expect(won.bankroll).toBe(100000 + 3750)

  const sixFive = rulesWith({ blackjackPays: '6:5' })
  expect(E.deal(stacked([A, 9, K, 7], sixFive), sixFive, 1).bankroll).toBe(100000 + 3000)
})

test('the dealer peeks: a blackjack ends the round and insurance pays 2:1', () => {
  const offered = E.deal(stacked([10, A, 9, K]), E.DEFAULT_SETTINGS, 1)
  expect(offered.phase).toBe('insurance')
  expect(E.insuranceCost(offered)).toBe(1250)

  const declined = E.insure(offered, E.DEFAULT_SETTINGS, false)
  expect(declined.phase).toBe('betting')
  expect(declined.hands[0]?.result).toBe('lose')
  expect(declined.bankroll).toBe(100000 - 2500)

  const insured = E.insure(offered, E.DEFAULT_SETTINGS, true)
  expect(insured.outcome?.net).toBe(0)
  expect(insured.bankroll).toBe(100000)
})

test('insurance is lost when the dealer has no blackjack, and play goes on', () => {
  const insured = E.insure(E.deal(stacked([10, A, 9, 7]), E.DEFAULT_SETTINGS, 1), E.DEFAULT_SETTINGS, true)
  expect(insured.phase).toBe('player')
  expect(insured.bankroll).toBe(100000 - 2500 - 1250)
  const done = E.finishDealer(E.play(insured, E.DEFAULT_SETTINGS, 'stand'), E.DEFAULT_SETTINGS)
  expect(done.hands[0]?.result).toBe('win')
  expect(done.outcome?.net).toBe(2500 - 1250)
})

test('even money pays 1:1 on a blackjack against an ace', () => {
  const offered = E.deal(stacked([A, A, K, 5]), E.DEFAULT_SETTINGS, 1)
  expect(E.isEvenMoney(offered)).toBe(true)
  const taken = E.insure(offered, E.DEFAULT_SETTINGS, true)
  expect(taken.phase).toBe('betting')
  expect(taken.bankroll).toBe(100000 + 2500)
})

test('the dealer draws to 17 and can bust', () => {
  const standing = E.play(E.deal(stacked([10, 6, 8, 10, K]), E.DEFAULT_SETTINGS, 1), E.DEFAULT_SETTINGS, 'stand')
  expect(standing.phase).toBe('dealer')
  const done = E.finishDealer(standing, E.DEFAULT_SETTINGS)
  expect(E.handTotal(done.dealer).total).toBe(26)
  expect(done.hands[0]?.result).toBe('win')
  expect(done.bankroll).toBe(100000 + 2500)
})

test('the dealer stands on soft 17 under S17 and hits it under H17', () => {
  const play = (settings: TableSettings) =>
    E.finishDealer(E.play(E.deal(stacked([10, 6, 8, A, 4], settings), settings, 1), settings, 'stand'), settings)
  const s17 = play(rulesWith({ hitSoft17: false }))
  expect(E.handTotal(s17.dealer).total).toBe(17)
  expect(s17.hands[0]?.result).toBe('win')
  const h17 = play(rulesWith({ hitSoft17: true }))
  expect(E.handTotal(h17.dealer).total).toBe(21)
  expect(h17.hands[0]?.result).toBe('lose')
})

test('a double takes one card and doubles the stake', () => {
  const dealt = E.deal(stacked([5, 6, 6, 10, 10, 9]), E.DEFAULT_SETTINGS, 1)
  expect(E.available(dealt, E.DEFAULT_RULES)).toContain('double')
  const doubled = E.play(dealt, E.DEFAULT_SETTINGS, 'double')
  expect(doubled.hands[0]?.cards).toHaveLength(3)
  expect(doubled.hands[0]?.bet).toBe(5000)
  const done = E.finishDealer(doubled, E.DEFAULT_SETTINGS)
  expect(done.bankroll).toBe(100000 + 5000)
  expect(done.stats.doubles).toBe(1)
})

test('doubling is held to the rule for which totals may double', () => {
  const tenEleven = rulesWith({ doubleOn: '10-11' })
  expect(E.available(E.deal(stacked([5, 6, 4, 10], tenEleven), tenEleven, 1), tenEleven.rules)).not.toContain('double')
  expect(E.available(E.deal(stacked([5, 6, 5, 10], tenEleven), tenEleven, 1), tenEleven.rules)).toContain('double')
})

test('a split makes two hands; double after split follows the rule', () => {
  const order = [8, 6, 8, 10, 3, 2]
  const das = E.play(E.deal(stacked(order), E.DEFAULT_SETTINGS, 1), E.DEFAULT_SETTINGS, 'split')
  expect(das.hands).toHaveLength(2)
  expect(das.hands[0]?.cards.map(E.rankOf)).toEqual([7, 2])
  expect(das.bankroll).toBe(100000 - 5000)
  expect(E.available(das, E.DEFAULT_RULES)).toContain('double')

  const noDas = rulesWith({ doubleAfterSplit: false })
  const split = E.play(E.deal(stacked(order, noDas), noDas, 1), noDas, 'split')
  expect(E.available(split, noDas.rules)).not.toContain('double')

  const noSplit = rulesWith({ maxHands: 1 })
  expect(E.available(E.deal(stacked(order, noSplit), noSplit, 1), noSplit.rules)).not.toContain('split')
})

test('split aces take one card each and 21 there is no blackjack', () => {
  const split = E.play(E.deal(stacked([A, 6, A, 10, K, 9, 10]), E.DEFAULT_SETTINGS, 1), E.DEFAULT_SETTINGS, 'split')
  expect(split.phase).toBe('dealer')
  expect(split.hands.map(hand => hand.cards.length)).toEqual([2, 2])
  const done = E.finishDealer(split, E.DEFAULT_SETTINGS)
  expect(done.hands.map(hand => hand.result)).toEqual(['win', 'win'])
  expect(done.outcome?.net).toBe(5000)
})

test('late surrender gives half back', () => {
  const dealt = E.deal(stacked([10, 10, 6, 7]), E.DEFAULT_SETTINGS, 1)
  expect(E.recommend(dealt, E.DEFAULT_RULES)).toBe('surrender')
  const gone = E.play(dealt, E.DEFAULT_SETTINGS, 'surrender')
  expect(gone.phase).toBe('betting')
  expect(gone.outcome?.net).toBe(-1250)
  expect(gone.stats.correct).toBe(1)
})

test('without a peek, a dealer blackjack takes the doubled stake too', () => {
  const euro = rulesWith({ dealerPeek: false, insurance: false })
  const dealt = E.deal(stacked([5, 10, 6, A, 10], euro), euro, 1)
  expect(dealt.phase).toBe('player')
  const done = E.play(dealt, euro, 'double')
  const settled = E.finishDealer(done, euro)
  expect(settled.hands[0]?.result).toBe('lose')
  expect(settled.outcome?.net).toBe(-5000)
})

test('a bust loses at once and the dealer only turns the hole card', () => {
  const busted = E.play(E.deal(stacked([10, 6, 6, 10, K]), E.DEFAULT_SETTINGS, 1), E.DEFAULT_SETTINGS, 'hit')
  expect(busted.phase).toBe('betting')
  expect(busted.isHoleShown).toBe(true)
  expect(busted.dealer).toHaveLength(2)
  expect(busted.hands[0]?.result).toBe('bust')
  expect(busted.stats.busts).toBe(1)
})

test('basic strategy picks the textbook play', () => {
  const advice = (ranks: number[], rules = E.DEFAULT_RULES) => {
    const settings = rulesWith(rules)

    return E.recommend(E.deal(stacked(ranks, settings), settings, 1), settings.rules)
  }
  expect(advice([5, 6, 6, 10])).toBe('double')
  expect(advice([8, 10, 8, 7])).toBe('split')
  expect(advice([A, 9, 7, 10])).toBe('hit')
  expect(advice([10, 4, 2, 10])).toBe('stand')
  expect(advice([10, 10, 6, 7], { ...E.DEFAULT_RULES, surrender: false })).toBe('hit')
  expect(advice([9, 7, 9, 10])).toBe('stand')
})

test('the cut card and a change of decks bring a fresh shoe', () => {
  const short = { ...stacked([10, 6, 8, 10]), shoe: [1, 2, 3, 4, 5, 6, 7, 8], shoeSize: 312, shoeDecks: 6 }
  const reshuffled = E.deal(short, E.DEFAULT_SETTINGS, 99)
  expect(reshuffled.shoeSize).toBe(312)
  expect(reshuffled.shoe).toHaveLength(312 - 4)
  expect(reshuffled.notice).toMatch(/fresh 6-deck shoe/)

  const twoDecks = rulesWith({ decks: 2 })
  expect(E.deal(stacked([10, 6, 8, 10]), twoDecks, 5).shoeSize).toBe(104)
})

test('bets stay inside the table limits and the bankroll', () => {
  const rules = E.DEFAULT_RULES
  const start = { ...E.newGame(rules), bet: 0 }
  expect(E.dealProblem(start, rules)).toMatch(/Place a bet/)
  expect(E.addChip(start, rules, 25).bet).toBe(2500)
  expect(E.addChip({ ...start, bet: 49500 }, rules, 100).bet).toBe(50000)
  expect(E.maxBet({ ...start, bankroll: 12345 }, rules).bet).toBe(12300)
  expect(E.removeChip({ ...start, bet: 300 }, rules).bet).toBe(0)
  expect(E.doubleBet({ ...start, bet: 2500 }, rules).bet).toBe(5000)
  expect(E.fitBet({ ...start, bet: 2500 }, { ...rules, table: 3 }).bet).toBe(10000)
})

test('a broke player waits for the next window', () => {
  const broke = { ...E.newGame(E.DEFAULT_RULES), bankroll: 300, bet: 0 }
  expect(E.isBroke(broke, E.DEFAULT_RULES)).toBe(true)
  expect(E.dealProblem(broke, E.DEFAULT_RULES)).toMatch(/next five-hour window/)
})

const HOUR = 60 * 60 * 1000
const T = Date.UTC(2026, 9, 19, 15)

test('each round moves the window’s best, worst and end', () => {
  const won = E.deal(stacked([A, 9, K, 7]), E.DEFAULT_SETTINGS, 1)
  expect(won.window).toMatchObject({ rounds: 1, start: 100000, best: 103750, worst: 100000, end: 103750 })
  const lost = E.insure(E.deal(stacked([10, A, 9, K]), E.DEFAULT_SETTINGS, 1), E.DEFAULT_SETTINGS, false)
  expect(lost.window).toMatchObject({ rounds: 1, best: 100000, worst: 97500, end: 97500 })
})

test('the five-hour reset is read from the rate-limit windows', () => {
  const limits = [
    { kind: 'seven_day', resetsAt: '2026-10-25T00:00:00Z' },
    { kind: 'five_hour', resetsAt: '2026-10-19T20:00:00Z' },
  ]
  expect(E.fiveHourReset(limits)).toBe(Date.UTC(2026, 9, 19, 20))
  expect(E.fiveHourReset([{ kind: 'five_hour' }])).toBeNull()
  expect(E.fiveHourReset([])).toBeNull()
})

test('with no limit reported, the table keeps five hours on its own clock', () => {
  const clocked = E.syncWindow(E.newGame(E.DEFAULT_RULES), E.DEFAULT_RULES, null, T)
  expect(clocked.window).toMatchObject({ startedAt: T, resetsAt: T + 5 * HOUR, source: 'clock' })
  expect(E.syncWindow(clocked, E.DEFAULT_RULES, null, T + HOUR)).toBe(clocked)

  const next = E.syncWindow(clocked, E.DEFAULT_RULES, null, T + 5 * HOUR)
  expect(next.window).toMatchObject({ startedAt: T + 5 * HOUR, resetsAt: T + 10 * HOUR, source: 'clock' })
  expect(next.history).toEqual([])
})

test('a reported reset becomes the window’s end; a stale or barely moved one changes nothing', () => {
  const clocked = E.syncWindow(E.newGame(E.DEFAULT_RULES), E.DEFAULT_RULES, null, T)
  const limited = E.syncWindow(clocked, E.DEFAULT_RULES, T + 2 * HOUR, T + 1000)
  expect(limited.window).toMatchObject({ startedAt: T, resetsAt: T + 2 * HOUR, source: 'limit' })
  expect(limited.bankroll).toBe(100000)
  expect(E.syncWindow(limited, E.DEFAULT_RULES, T - HOUR, T + 2000)).toBe(limited)
  expect(E.syncWindow(limited, E.DEFAULT_RULES, T + 2 * HOUR + 60_000, T + 3000)).toBe(limited)
})

test('when the limit resets, fresh chips are dealt and the last window is filed', () => {
  const opened = E.syncWindow(E.newGame(E.DEFAULT_RULES), E.DEFAULT_RULES, T + 2 * HOUR, T)
  const played = E.deal({ ...stacked([A, 9, K, 7]), window: opened.window }, E.DEFAULT_SETTINGS, 1)
  expect(played.bankroll).toBe(103750)

  const next = E.syncWindow(played, E.DEFAULT_RULES, T + 2 * HOUR, T + 2 * HOUR)
  expect(next.bankroll).toBe(100000)
  expect(next.window).toMatchObject({ startedAt: T + 2 * HOUR, resetsAt: null, source: 'limit', rounds: 0 })
  expect(next.history).toHaveLength(1)
  expect(next.history[0]).toMatchObject({ startedAt: T, best: 103750, worst: 100000, end: 103750, rounds: 1 })
  expect(next.notice).toMatch(/fresh chips\. Last window: best \$1,037\.50, worst \$1,000/)
  expect(E.records(next).best.best).toBe(103750)

  // Claude's next reply reports when the new window resets: no second deal.
  const timed = E.syncWindow(next, E.DEFAULT_RULES, T + 8 * HOUR, T + 3 * HOUR)
  expect(timed.window.resetsAt).toBe(T + 8 * HOUR)
  expect(timed.window.startedAt).toBe(T + 2 * HOUR)
  expect(timed.history).toHaveLength(1)
})

test('a reset that moves starts a new window too, but never in the middle of a hand', () => {
  const opened = E.syncWindow(E.newGame(E.DEFAULT_RULES), E.DEFAULT_RULES, T + 4 * HOUR, T)
  const inPlay = E.deal({ ...stacked([10, 6, 8, 10]), window: opened.window }, E.DEFAULT_SETTINGS, 1)
  expect(inPlay.phase).toBe('player')
  expect(E.syncWindow(inPlay, E.DEFAULT_RULES, T + 6 * HOUR, T + HOUR)).toBe(inPlay)

  const done = E.finishDealer(E.play(inPlay, E.DEFAULT_SETTINGS, 'stand'), E.DEFAULT_SETTINGS)
  const next = E.syncWindow(done, E.DEFAULT_RULES, T + 6 * HOUR, T + HOUR)
  expect(next.window).toMatchObject({ startedAt: T + HOUR, resetsAt: T + 6 * HOUR, source: 'limit', start: 100000 })
  expect(next.bankroll).toBe(100000)
  expect(next.history).toHaveLength(1)
})

test('a version 1 save keeps its chips as the first window’s', () => {
  const old: Record<string, unknown> = { ...E.newGame(E.DEFAULT_RULES), v: 1, bankroll: 4321 }
  delete old.window
  delete old.history
  const revived = E.reviveGame(old)
  expect(revived?.v).toBe(E.GAME_VERSION)
  expect(revived?.bankroll).toBe(4321)
  expect(revived?.window).toMatchObject({ start: 4321, best: 4321, worst: 4321, resetsAt: null, source: 'clock' })
  expect(revived?.history).toEqual([])
  expect(E.reviveGame({ ...old, v: 0 })).toBeNull()
})

test('starting over clears the records but keeps the window’s timing', () => {
  const opened = E.syncWindow(E.newGame(E.DEFAULT_RULES), E.DEFAULT_RULES, T + 2 * HOUR, T)
  const filed = { ...opened, bankroll: 5000, history: [opened.window] }
  const fresh = E.resetGame(filed, E.DEFAULT_RULES)
  expect(fresh.bankroll).toBe(100000)
  expect(fresh.history).toEqual([])
  expect(fresh.window).toMatchObject({ startedAt: T, resetsAt: T + 2 * HOUR, source: 'limit', best: 100000 })
})

test('settings cycle through their values', () => {
  const once = E.changeSetting(E.DEFAULT_SETTINGS, 'decks')
  expect(once.rules.decks).toBe(8)
  expect(E.changeSetting(once, 'decks').rules.decks).toBe(1)
  expect(E.changeSetting(E.DEFAULT_SETTINGS, 'pays').rules.blackjackPays).toBe('6:5')
  expect(E.changeSetting(E.DEFAULT_SETTINGS, 'hints').prefs.hints).toBe(true)
  expect(E.rulesSummary(E.DEFAULT_RULES)).toBe('6D S17 3:2 DAS LS')
})
