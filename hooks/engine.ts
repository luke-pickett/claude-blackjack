// The game itself: pure functions from one Game to the next. Nothing here
// touches `$`; randomness comes in as `entropy`, so a reducer run twice on
// the same input (as `update` does on a version miss) answers the same.
import type {
  Action,
  Card,
  Game,
  Hand,
  HandResult,
  LimitWindow,
  Outcome,
  Prefs,
  Rules,
  TableSettings,
  Stats,
} from '../types'

export const GAME_VERSION = 2

export const SUITS = ['♠', '♥', '♦', '♣'] as const
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const

export const TABLES = [
  { min: 5, max: 500, chips: [5, 25, 100, 500] },
  { min: 10, max: 1000, chips: [10, 50, 100, 500] },
  { min: 25, max: 2500, chips: [25, 100, 500, 1000] },
  { min: 100, max: 10000, chips: [100, 500, 1000, 5000] },
] as const

export type Table = (typeof TABLES)[number]

export const DEFAULT_RULES: Rules = {
  decks: 6,
  hitSoft17: false,
  blackjackPays: '3:2',
  doubleOn: 'any',
  doubleAfterSplit: true,
  maxHands: 4,
  resplitAces: false,
  hitSplitAces: false,
  surrender: true,
  insurance: true,
  dealerPeek: true,
  penetration: 75,
  table: 0,
  bankroll: 1000,
}

export const DEFAULT_PREFS: Prefs = {
  hints: false,
  showCount: false,
  speed: 'normal',
  autoOpen: true,
  workOnly: false,
  statusLine: true,
}

export const DEFAULT_SETTINGS: TableSettings = { rules: DEFAULT_RULES, prefs: DEFAULT_PREFS }

// ---------------------------------------------------------------- cards

export const rankOf = (card: Card) => card % 13
export const suitOf = (card: Card) => Math.floor(card / 13) % 4
export const isRed = (card: Card) => suitOf(card) === 1 || suitOf(card) === 2
export const rankLabel = (card: Card) => RANKS[rankOf(card)] ?? '?'
export const suitLabel = (card: Card) => SUITS[suitOf(card)] ?? '?'

/** Blackjack value with an ace as 11: what splitting and the dealer's upcard compare. */
export function valueOf(card: Card): number {
  const rank = rankOf(card)

  return rank === 0 ? 11 : Math.min(rank + 1, 10)
}

export function handTotal(cards: readonly Card[]): { total: number; isSoft: boolean } {
  let total = 0
  let aces = 0
  for (const card of cards) {
    const rank = rankOf(card)
    total += rank === 0 ? 1 : Math.min(rank + 1, 10)
    if (rank === 0) aces += 1
  }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, isSoft: true }

  return { total, isSoft: false }
}

export const isBlackjack = (cards: readonly Card[]) => cards.length === 2 && handTotal(cards).total === 21

/** Hi-Lo: 2-6 count +1, 7-9 nothing, tens and aces -1. */
export function hiLo(card: Card): number {
  const value = valueOf(card)
  if (value <= 6) return 1
  if (value >= 10) return -1

  return 0
}

// ---------------------------------------------------------------- money

/** Cents as dollars: `$1,250`, `$7.50`; `signed` adds a + or −. */
export function money(cents: number, signed = false): string {
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100)
  const rest = abs % 100
  const whole = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const text = `$${whole}${rest === 0 ? '' : '.' + String(rest).padStart(2, '0')}`
  if (cents < 0) return `−${text}`

  return signed && cents > 0 ? `+${text}` : text
}

export const tableOf = (rules: Rules): Table => TABLES[rules.table] ?? TABLES[0]

/** Chips already on the table this round. */
export function onTable(game: Game): number {
  if (game.phase === 'betting') return 0

  return game.hands.reduce((sum, hand) => sum + hand.bet, 0) + game.insurance
}

// ---------------------------------------------------------------- setup

export function emptyStats(bankroll: number): Stats {
  return {
    rounds: 0,
    hands: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    blackjacks: 0,
    busts: 0,
    surrenders: 0,
    doubles: 0,
    splits: 0,
    insurances: 0,
    net: 0,
    biggestWin: 0,
    biggestLoss: 0,
    peak: bankroll,
    streak: 0,
    bestStreak: 0,
    decisions: 0,
    correct: 0,
  }
}

export function newGame(rules: Rules): Game {
  const bankroll = rules.bankroll * 100

  return {
    v: GAME_VERSION,
    phase: 'betting',
    bankroll,
    bet: Math.min(defaultBet(rules), bankroll),
    shoe: [],
    shoeSize: 0,
    shoeDecks: 0,
    runningCount: 0,
    seed: 0,
    dealer: [],
    isHoleShown: false,
    hands: [],
    active: 0,
    insurance: 0,
    outcome: null,
    notice: null,
    round: 0,
    stats: emptyStats(bankroll),
    window: openWindow(bankroll, 0, null, 'clock'),
    history: [],
  }
}

const defaultBet = (rules: Rules) => (tableOf(rules).chips[1] ?? tableOf(rules).min) * 100

/** A stored game, or null when it is not one this version or the last wrote. */
export function reviveGame(value: unknown): Game | null {
  if (typeof value !== 'object' || value === null) return null
  const game = value as Partial<Game>
  const isGame =
    (game.v === GAME_VERSION || game.v === 1) &&
    Array.isArray(game.shoe) &&
    Array.isArray(game.hands) &&
    Array.isArray(game.dealer) &&
    typeof game.bankroll === 'number' &&
    typeof game.stats === 'object'
  if (!isGame) return null
  if (game.v === GAME_VERSION) return value as Game

  // Version 1 kept one bankroll forever: its chips become the first window's.
  return { ...(value as Game), v: GAME_VERSION, window: openWindow(game.bankroll!, 0, null, 'clock'), history: [] }
}

/** Stored settings over the defaults, so a field added later reads its default. */
export function reviveSettings(value: unknown): TableSettings | null {
  if (typeof value !== 'object' || value === null) return null
  const stored = value as Partial<TableSettings>

  return {
    rules: { ...DEFAULT_RULES, ...(stored.rules ?? {}) },
    prefs: { ...DEFAULT_PREFS, ...(stored.prefs ?? {}) },
  }
}

const clone = (game: Game): Game => structuredClone(game)

const newHand = (cards: Card[], bet: number): Hand => ({
  cards,
  bet,
  isDoubled: false,
  isDone: false,
  isSplit: false,
  isSplitAces: false,
  isSurrendered: false,
  result: null,
  net: 0,
})

// ---------------------------------------------------------------- shoe

function random(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(next ^ (next >>> 15), 1 | next)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

function shuffleShoe(game: Game, decks: number, entropy: number) {
  const cards: Card[] = []
  for (let deck = 0; deck < decks; deck++) {
    for (let card = 0; card < 52; card++) cards.push(card)
  }
  let seed = (game.seed ^ entropy) | 0
  for (let i = cards.length - 1; i > 0; i--) {
    const [r, next] = random(seed)
    seed = next
    const j = Math.floor(r * (i + 1))
    const swap = cards[i]!
    cards[i] = cards[j]!
    cards[j] = swap
  }
  game.seed = seed
  game.shoe = cards
  game.shoeSize = cards.length
  game.shoeDecks = decks
  game.runningCount = 0
}

function draw(game: Game, isFaceUp = true): Card {
  if (game.shoe.length === 0) {
    shuffleShoe(game, game.shoeDecks || DEFAULT_RULES.decks, game.round)
    game.notice = 'The shoe ran dry and was reshuffled.'
  }
  const card = game.shoe.pop()!
  if (isFaceUp) game.runningCount += hiLo(card)

  return card
}

function revealHole(game: Game) {
  if (game.isHoleShown) return
  game.isHoleShown = true
  const hole = game.dealer[1]
  if (hole !== undefined) game.runningCount += hiLo(hole)
}

export const decksLeft = (game: Game) => game.shoe.length / 52

export function trueCount(game: Game): number {
  const decks = Math.max(decksLeft(game), 0.25)

  return game.runningCount / decks
}

// ---------------------------------------------------------------- betting

function affordable(game: Game, rules: Rules): number {
  return Math.min(tableOf(rules).max * 100, Math.floor(game.bankroll / 100) * 100)
}

function setBet(prev: Game, rules: Rules, bet: number): Game {
  if (prev.phase !== 'betting') return prev
  const game = clone(prev)
  const cap = affordable(game, rules)
  game.bet = Math.max(0, Math.min(bet, cap))
  game.notice = bet > cap && bet > prev.bet ? `That is as high as you can go: ${money(cap)}.` : null

  return game
}

export const addChip = (game: Game, rules: Rules, dollars: number) => setBet(game, rules, game.bet + dollars * 100)

export const removeChip = (game: Game, rules: Rules) => setBet(game, rules, game.bet - tableOf(rules).min * 100)

export const clearBet = (game: Game, rules: Rules) => setBet(game, rules, 0)

export const doubleBet = (game: Game, rules: Rules) => setBet(game, rules, Math.max(game.bet * 2, tableOf(rules).min * 100))

export const maxBet = (game: Game, rules: Rules) => setBet(game, rules, affordable(game, rules))

export const isBroke = (game: Game, rules: Rules) => game.phase === 'betting' && game.bankroll < tableOf(rules).min * 100

/** Keeps the pending bet inside the table's limits and the bankroll after a rule change. */
export function fitBet(prev: Game, rules: Rules): Game {
  if (prev.phase !== 'betting') return prev
  const table = tableOf(rules)
  const cap = affordable(prev, rules)
  let bet = Math.min(prev.bet, cap)
  if (bet > 0 && bet < table.min * 100) bet = Math.min(table.min * 100, cap)
  if (bet === prev.bet) return prev

  return { ...prev, bet }
}

/** Why the deal cannot go ahead, or null when it can. */
export function dealProblem(game: Game, rules: Rules): string | null {
  const table = tableOf(rules)
  if (game.phase !== 'betting') return 'A hand is already in play.'
  if (isBroke(game, rules)) return `You need ${money(table.min * 100)} to sit at this table: fresh chips come with the next five-hour window.`
  if (game.bet === 0) return 'Place a bet first: the number keys add chips.'
  if (game.bet < table.min * 100) return `The table minimum is ${money(table.min * 100)}.`
  if (game.bet > table.max * 100) return `The table maximum is ${money(table.max * 100)}.`
  if (game.bet > game.bankroll) return 'You cannot cover that bet.'

  return null
}

// ---------------------------------------------------------------- the round

export function deal(prev: Game, settings: TableSettings, entropy: number): Game {
  const { rules } = settings
  const problem = dealProblem(prev, rules)
  if (problem !== null) return prev.notice === problem ? prev : { ...prev, notice: problem }
  const game = clone(prev)
  game.notice = null
  const cutoff = Math.floor(game.shoeSize * (1 - rules.penetration / 100))
  if (game.shoeDecks !== rules.decks || game.shoe.length <= Math.max(cutoff, 10)) {
    const isFirst = game.shoeSize === 0
    shuffleShoe(game, rules.decks, entropy)
    if (!isFirst) game.notice = `Cut card: a fresh ${rules.decks}-deck shoe is shuffled.`
  }
  game.round += 1
  game.outcome = null
  game.bankroll -= game.bet
  game.insurance = 0
  game.isHoleShown = false
  game.active = 0
  const hand = newHand([], game.bet)
  game.hands = [hand]
  game.dealer = []
  hand.cards.push(draw(game))
  game.dealer.push(draw(game))
  hand.cards.push(draw(game))
  game.dealer.push(draw(game, false))

  const up = game.dealer[0]!
  const canInsure = game.bankroll >= Math.floor(hand.bet / 2) || isBlackjack(hand.cards)
  if (rules.insurance && rankOf(up) === 0 && canInsure) {
    game.phase = 'insurance'

    return game
  }

  return afterInsurance(game, rules)
}

/** The insurance stake on offer: half the original bet. */
export const insuranceCost = (game: Game) => Math.floor((game.hands[0]?.bet ?? 0) / 2)

/** Whether the insurance on offer is even money: the player holds blackjack. */
export const isEvenMoney = (game: Game) => isBlackjack(game.hands[0]?.cards ?? [])

export function insure(prev: Game, settings: TableSettings, isTaken: boolean): Game {
  if (prev.phase !== 'insurance') return prev
  const game = clone(prev)
  const stake = insuranceCost(game)
  game.stats.decisions += 1
  if (!isTaken) game.stats.correct += 1
  if (isTaken && isEvenMoney(game)) return evenMoney(game)
  if (isTaken && game.bankroll >= stake) {
    game.bankroll -= stake
    game.insurance = stake
    game.stats.insurances += 1
  }

  return afterInsurance(game, settings.rules)
}

/** Blackjack against an ace, paid 1:1 at once whatever the hole card is. */
function evenMoney(game: Game): Game {
  revealHole(game)
  const hand = game.hands[0]!
  hand.result = 'win'
  hand.net = hand.bet
  hand.isDone = true
  game.bankroll += hand.bet * 2
  game.phase = 'betting'
  game.outcome = { net: hand.bet, insuranceNet: 0, tone: 'win', headline: `Even money: ${money(hand.bet, true)}` }
  tally(game.stats, game, hand.bet)

  return game
}

function afterInsurance(game: Game, rules: Rules): Game {
  const up = game.dealer[0]!
  const hand = game.hands[0]!
  const isPeeked = rules.dealerPeek && (rankOf(up) === 0 || valueOf(up) === 10)
  if ((isPeeked && isBlackjack(game.dealer)) || isBlackjack(hand.cards)) {
    hand.isDone = true

    return settle(game, rules)
  }
  if (isPeeked) {
    const peek = game.insurance > 0 ? 'The dealer peeks: no blackjack. Insurance is lost.' : 'The dealer peeks: no blackjack.'
    game.notice = game.notice === null ? peek : `${game.notice} ${peek}`
  }
  game.phase = 'player'

  return game
}

export const activeHand = (game: Game): Hand | undefined =>
  game.phase === 'player' ? game.hands[game.active] : undefined

const isLockedAces = (hand: Hand, rules: Rules) => hand.isSplitAces && !rules.hitSplitAces

function canDouble(game: Game, hand: Hand, rules: Rules): boolean {
  if (hand.cards.length !== 2 || hand.isDoubled || game.bankroll < hand.bet) return false
  if (hand.isSplit && !rules.doubleAfterSplit) return false
  if (isLockedAces(hand, rules)) return false
  const { total } = handTotal(hand.cards)
  if (rules.doubleOn === '9-11') return total >= 9 && total <= 11
  if (rules.doubleOn === '10-11') return total === 10 || total === 11

  return true
}

function canSplit(game: Game, hand: Hand, rules: Rules): boolean {
  const [a, b] = hand.cards
  if (hand.cards.length !== 2 || a === undefined || b === undefined) return false
  if (valueOf(a) !== valueOf(b) || game.hands.length >= rules.maxHands) return false
  if (game.bankroll < hand.bet) return false

  return !hand.isSplitAces || rules.resplitAces
}

function canSurrender(game: Game, hand: Hand, rules: Rules): boolean {
  return rules.surrender && game.hands.length === 1 && hand.cards.length === 2 && !hand.isSplit
}

/** What the player may do with the hand in play, in button order. */
export function available(game: Game, rules: Rules): Action[] {
  const hand = activeHand(game)
  if (hand === undefined || hand.isDone) return []
  const actions: Action[] = []
  if (!isLockedAces(hand, rules)) actions.push('hit')
  actions.push('stand')
  if (canDouble(game, hand, rules)) actions.push('double')
  if (canSplit(game, hand, rules)) actions.push('split')
  if (canSurrender(game, hand, rules)) actions.push('surrender')

  return actions
}

export function play(prev: Game, settings: TableSettings, action: Action): Game {
  const { rules } = settings
  if (!available(prev, rules).includes(action)) return prev
  const game = clone(prev)
  const hand = game.hands[game.active]!
  const best = recommend(prev, rules)
  if (best !== null) {
    game.stats.decisions += 1
    if (best === action) game.stats.correct += 1
  }
  game.notice = null

  if (action === 'hit') {
    hand.cards.push(draw(game))
    if (handTotal(hand.cards).total >= 21) hand.isDone = true
  } else if (action === 'stand') {
    hand.isDone = true
  } else if (action === 'double') {
    game.bankroll -= hand.bet
    hand.bet *= 2
    hand.isDoubled = true
    hand.cards.push(draw(game))
    hand.isDone = true
    game.stats.doubles += 1
  } else if (action === 'split') {
    const [first, second] = hand.cards as [Card, Card]
    const isAces = rankOf(first) === 0
    game.bankroll -= hand.bet
    hand.cards = [first]
    hand.isSplit = true
    hand.isSplitAces = isAces
    game.hands.splice(game.active + 1, 0, { ...newHand([second], hand.bet), isSplit: true, isSplitAces: isAces })
    game.stats.splits += 1
  } else {
    hand.isSurrendered = true
    hand.isDone = true
  }

  return advance(game, rules)
}

/** Moves to the next hand that needs the player, dealing split hands their second card. */
function advance(game: Game, rules: Rules): Game {
  while (game.active < game.hands.length) {
    const hand = game.hands[game.active]!
    if (hand.cards.length === 1) {
      hand.cards.push(draw(game))
      if (isLockedAces(hand, rules)) {
        if (!canSplit(game, hand, rules)) hand.isDone = true
      } else if (handTotal(hand.cards).total === 21) {
        hand.isDone = true
      }
    }
    if (!hand.isDone) return game
    game.active += 1
  }
  game.active = game.hands.length - 1
  game.phase = 'dealer'
  const isLive = game.hands.some(hand => !hand.isSurrendered && handTotal(hand.cards).total <= 21)
  if (!isLive) return settle(game, rules)

  return game
}

export function dealerShouldHit(cards: readonly Card[], rules: Rules): boolean {
  const { total, isSoft } = handTotal(cards)

  return total < 17 || (total === 17 && isSoft && rules.hitSoft17)
}

/** One beat of the dealer's play: turn the hole card, draw one, or settle. */
export function dealerStep(prev: Game, settings: TableSettings): Game {
  if (prev.phase !== 'dealer') return prev
  const game = clone(prev)
  if (!game.isHoleShown) {
    revealHole(game)

    return game
  }
  if (dealerShouldHit(game.dealer, settings.rules)) {
    game.dealer.push(draw(game))

    return game
  }

  return settle(game, settings.rules)
}

/** The dealer's whole play at once. */
export function finishDealer(prev: Game, settings: TableSettings): Game {
  let game = prev
  for (let beat = 0; game.phase === 'dealer' && beat < 32; beat++) game = dealerStep(game, settings)

  return game
}

function blackjackWin(bet: number, rules: Rules): number {
  if (rules.blackjackPays === '6:5') return Math.floor((bet * 6) / 5)
  if (rules.blackjackPays === '1:1') return bet

  return Math.floor((bet * 3) / 2)
}

function settle(game: Game, rules: Rules): Game {
  revealHole(game)
  const dealer = handTotal(game.dealer)
  const isDealerBlackjack = isBlackjack(game.dealer)
  const isOneHand = game.hands.length === 1
  let returned = 0
  let net = 0
  for (const hand of game.hands) {
    const { total } = handTotal(hand.cards)
    const isNatural = isOneHand && !hand.isSplit && isBlackjack(hand.cards)
    let result: HandResult
    let win: number
    if (hand.isSurrendered) {
      // Without a peek the surrender stands only against a dealer without blackjack.
      const isLost = !rules.dealerPeek && isDealerBlackjack
      result = isLost ? 'lose' : 'surrender'
      win = isLost ? -hand.bet : -Math.floor(hand.bet / 2)
    } else if (total > 21) {
      result = 'bust'
      win = -hand.bet
    } else if (isNatural) {
      result = isDealerBlackjack ? 'push' : 'blackjack'
      win = isDealerBlackjack ? 0 : blackjackWin(hand.bet, rules)
    } else if (isDealerBlackjack) {
      result = 'lose'
      win = -hand.bet
    } else if (dealer.total > 21 || total > dealer.total) {
      result = 'win'
      win = hand.bet
    } else if (total === dealer.total) {
      result = 'push'
      win = 0
    } else {
      result = 'lose'
      win = -hand.bet
    }
    hand.result = result
    hand.net = win
    hand.isDone = true
    returned += hand.bet + win
    net += win
  }
  let insuranceNet = 0
  if (game.insurance > 0) {
    insuranceNet = isDealerBlackjack ? game.insurance * 2 : -game.insurance
    if (isDealerBlackjack) returned += game.insurance * 3
  }
  net += insuranceNet
  game.bankroll += returned
  game.phase = 'betting'
  game.outcome = outcomeOf(game, net, insuranceNet, dealer.total, isDealerBlackjack)
  tally(game.stats, game, net)
  game.bet = Math.min(game.bet, Math.floor(game.bankroll / 100) * 100)

  return game
}

function outcomeOf(game: Game, net: number, insuranceNet: number, dealerTotal: number, isDealerBlackjack: boolean): Outcome {
  const tone: Outcome['tone'] = net > 0 ? 'win' : net < 0 ? 'lose' : 'push'
  const insurance = insuranceNet === 0 ? '' : ` (insurance ${money(insuranceNet, true)})`
  const hands = game.hands
  if (hands.length > 1) {
    const won = hands.filter(hand => hand.result === 'win').length
    const lost = hands.filter(hand => hand.result === 'lose' || hand.result === 'bust').length
    const pushed = hands.filter(hand => hand.result === 'push').length
    const parts = [won > 0 ? `${won} won` : '', lost > 0 ? `${lost} lost` : '', pushed > 0 ? `${pushed} pushed` : '']
    const tally = parts.filter(part => part !== '').join(', ')

    return { net, insuranceNet, tone, headline: `${tally}: ${net === 0 ? 'even' : money(net, true)}${insurance}` }
  }
  const hand = hands[0]!
  const amount = money(hand.net, true)
  const headlines: Record<HandResult, string> = {
    blackjack: `Blackjack! ${amount}`,
    win: dealerTotal > 21 ? `Dealer busts with ${dealerTotal}. You win ${amount}` : `You win ${amount}`,
    push: isDealerBlackjack ? 'Both have blackjack: push' : 'Push: your bet comes back',
    lose: isDealerBlackjack ? `Dealer blackjack. ${amount}` : `Dealer wins with ${dealerTotal}. ${amount}`,
    bust: `Bust! ${amount}`,
    surrender: `Surrendered: half back. ${amount}`,
  }

  return { net, insuranceNet, tone, headline: headlines[hand.result ?? 'push'] + insurance }
}

function tally(stats: Stats, game: Game, net: number) {
  stats.rounds += 1
  for (const hand of game.hands) {
    stats.hands += 1
    if (hand.result === 'blackjack') stats.blackjacks += 1
    if (hand.result === 'win' || hand.result === 'blackjack') stats.wins += 1
    if (hand.result === 'lose' || hand.result === 'bust') stats.losses += 1
    if (hand.result === 'bust') stats.busts += 1
    if (hand.result === 'push') stats.pushes += 1
    if (hand.result === 'surrender') stats.surrenders += 1
  }
  stats.net += net
  stats.biggestWin = Math.max(stats.biggestWin, net)
  stats.biggestLoss = Math.min(stats.biggestLoss, net)
  stats.peak = Math.max(stats.peak, game.bankroll)
  if (net > 0) stats.streak = stats.streak > 0 ? stats.streak + 1 : 1
  if (net < 0) stats.streak = stats.streak < 0 ? stats.streak - 1 : -1
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak)
  const played = game.window
  played.rounds += 1
  played.end = game.bankroll
  played.best = Math.max(played.best, game.bankroll)
  played.worst = Math.min(played.worst, game.bankroll)
}

/** Fresh chips, stats and window records; the shoe and the window's timing carry on. */
export function resetGame(prev: Game, rules: Rules): Game {
  const game = newGame(rules)
  const { startedAt, resetsAt, source } = prev.window

  return {
    ...game,
    shoe: prev.shoe,
    shoeSize: prev.shoeSize,
    shoeDecks: prev.shoeDecks,
    runningCount: prev.runningCount,
    seed: prev.seed,
    window: openWindow(game.bankroll, startedAt, resetsAt, source),
    notice: `Started over at ${money(rules.bankroll * 100)}; stats and window records are cleared.`,
  }
}

// ---------------------------------------------------------------- five-hour windows

export const FIVE_HOURS = 5 * 60 * 60 * 1000

/** How far a reported reset may move before it counts as a different window. */
const DRIFT = 10 * 60 * 1000

/** Finished windows kept in the records. */
export const HISTORY = 50

export function openWindow(
  bankroll: number,
  startedAt: number,
  resetsAt: number | null,
  source: LimitWindow['source'],
): LimitWindow {
  return { startedAt, resetsAt, source, start: bankroll, best: bankroll, worst: bankroll, end: bankroll, rounds: 0 }
}

/** When the five-hour limit resets, from the engine's rate-limit readings; null when none says. */
export function fiveHourReset(limits: readonly { kind: string; resetsAt?: string }[]): number | null {
  const reset = limits.find(limit => limit.kind === 'five_hour')?.resetsAt
  const at = reset === undefined ? NaN : Date.parse(reset)

  return Number.isFinite(at) ? at : null
}

/**
 * Keeps the game's window in step with the five-hour limit: takes the reset
 * time a reading gives, and once the window is over (its reset passed, or the
 * limit reports a different one) deals the next window's chips, waiting for
 * the hand in play to finish. `reading` is the latest reported reset; one
 * already past is stale and ignored. Answers `prev` itself when nothing moves.
 */
export function syncWindow(prev: Game, rules: Rules, reading: number | null, now: number): Game {
  const current = prev.window
  const live = reading !== null && reading > now ? reading : null
  const isPast = current.resetsAt !== null && now >= current.resetsAt
  const isMoved =
    live !== null && current.source === 'limit' && current.resetsAt !== null && Math.abs(live - current.resetsAt) > DRIFT
  if (isPast || isMoved) return prev.phase === 'betting' ? nextWindow(prev, rules, live, now) : prev
  const startedAt = current.startedAt || now
  if (live !== null && (current.resetsAt === null || current.source === 'clock')) {
    return { ...prev, window: { ...current, startedAt, resetsAt: live, source: 'limit' } }
  }
  // No limit has been reported to this table: it keeps five hours on its own clock.
  if (current.resetsAt === null && current.source === 'clock') {
    return { ...prev, window: { ...current, startedAt, resetsAt: startedAt + FIVE_HOURS } }
  }

  return prev
}

/** Files the finished window in the records and deals the new one's chips. */
function nextWindow(prev: Game, rules: Rules, live: number | null, now: number): Game {
  const last = prev.window
  const bankroll = rules.bankroll * 100
  // After a limit window, the next one's end is unknown until Claude's next reply reports it.
  const source = live !== null || last.source === 'limit' ? 'limit' : 'clock'
  const resetsAt = live ?? (source === 'clock' ? now + FIVE_HOURS : null)
  const range = last.rounds > 0 ? ` Last window: best ${money(last.best)}, worst ${money(last.worst)}.` : ''

  return {
    ...prev,
    bankroll,
    bet: Math.min(defaultBet(rules), bankroll),
    window: openWindow(bankroll, now, resetsAt, source),
    history: last.rounds > 0 ? [last, ...prev.history].slice(0, HISTORY) : prev.history,
    notice: `New five-hour window: ${money(bankroll)} in fresh chips.${range}`,
  }
}

/** The best and worst bankroll of any window, the one in play included, with the window each came in. */
export function records(game: Game): { best: LimitWindow; worst: LimitWindow } {
  let best = game.window
  let worst = game.window
  for (const past of game.history) {
    if (past.best > best.best) best = past
    if (past.worst < worst.worst) worst = past
  }

  return { best, worst }
}

export const withNotice = (game: Game, notice: string | null): Game =>
  game.notice === notice ? game : { ...game, notice }

// ---------------------------------------------------------------- basic strategy

type Play = 'H' | 'S' | 'D' | 'Ds' | 'P' | 'Rh' | 'Rs' | 'Rp'

function hardPlay(total: number, up: number, rules: Rules): Play {
  if (total >= 17) return total === 17 && up === 11 && rules.hitSoft17 ? 'Rs' : 'S'
  if (total === 16) return up >= 9 ? 'Rh' : up <= 6 ? 'S' : 'H'
  if (total === 15) return up === 10 || (up === 11 && rules.hitSoft17) ? 'Rh' : up <= 6 ? 'S' : 'H'
  if (total >= 13) return up <= 6 ? 'S' : 'H'
  if (total === 12) return up >= 4 && up <= 6 ? 'S' : 'H'
  if (total === 11) return up === 11 && !rules.hitSoft17 && rules.decks > 2 ? 'H' : 'D'
  if (total === 10) return up <= 9 ? 'D' : 'H'
  if (total === 9) return up >= 3 && up <= 6 ? 'D' : 'H'

  return 'H'
}

function softPlay(total: number, up: number, rules: Rules): Play {
  if (total >= 20) return 'S'
  if (total === 19) return up === 6 && rules.hitSoft17 ? 'Ds' : 'S'
  if (total === 18) {
    if (up <= 6) return up === 2 && !rules.hitSoft17 ? 'S' : 'Ds'

    return up <= 8 ? 'S' : 'H'
  }
  if (total === 17) return up >= 3 && up <= 6 ? 'D' : 'H'
  if (total >= 15) return up >= 4 && up <= 6 ? 'D' : 'H'
  if (total >= 13) return up >= 5 && up <= 6 ? 'D' : 'H'

  return 'H'
}

function pairPlay(value: number, up: number, rules: Rules): Play | null {
  const das = rules.doubleAfterSplit
  if (value === 11) return 'P'
  if (value === 10 || value === 5) return null
  if (value === 9) return up === 7 || up >= 10 ? null : 'P'
  if (value === 8) return up === 11 && rules.hitSoft17 ? 'Rp' : 'P'
  if (value === 7) return up <= 7 ? 'P' : null
  if (value === 6) return up <= 6 && (das || up >= 3) ? 'P' : null
  if (value === 4) return das && (up === 5 || up === 6) ? 'P' : null

  return up <= 7 && (das || up >= 4) ? 'P' : null
}

function choose(play: Play, actions: readonly Action[]): Action {
  const can = (action: Action) => actions.includes(action)
  const fallback = can('hit') ? 'hit' : 'stand'
  if (play === 'S') return 'stand'
  if (play === 'H') return fallback
  if (play === 'D') return can('double') ? 'double' : fallback
  if (play === 'Ds') return can('double') ? 'double' : 'stand'
  if (play === 'P') return can('split') ? 'split' : fallback
  if (play === 'Rh') return can('surrender') ? 'surrender' : fallback
  if (play === 'Rs') return can('surrender') ? 'surrender' : 'stand'

  return can('surrender') ? 'surrender' : can('split') ? 'split' : fallback
}

/** The basic-strategy play for the hand in play, or null when there is none to make. */
export function recommend(game: Game, rules: Rules): Action | null {
  const hand = activeHand(game)
  const actions = available(game, rules)
  const upcard = game.dealer[0]
  if (hand === undefined || actions.length === 0 || upcard === undefined) return null
  const up = valueOf(upcard)
  const [a, b] = hand.cards
  if (actions.includes('split') && a !== undefined && b !== undefined) {
    const pair = pairPlay(valueOf(a), up, rules)
    if (pair !== null) return choose(pair, actions)
  }
  const { total, isSoft } = handTotal(hand.cards)

  return choose(isSoft ? softPlay(total, up, rules) : hardPlay(total, up, rules), actions)
}

// ---------------------------------------------------------------- settings

export type SettingRow = {
  id: string
  group: 'rules' | 'prefs'
  hotkey: string
  label: string
  value: (settings: TableSettings) => string
  next: (settings: TableSettings) => TableSettings
}

function cycle<T>(values: readonly T[], current: T): T {
  const at = values.indexOf(current)

  return values[(at + 1) % values.length] ?? values[0]!
}

const rule = <K extends keyof Rules>(
  id: string,
  hotkey: string,
  label: string,
  key: K,
  values: readonly Rules[K][],
  show: (value: Rules[K]) => string,
): SettingRow => ({
  id,
  group: 'rules',
  hotkey,
  label,
  value: settings => show(settings.rules[key]),
  next: settings => ({ ...settings, rules: { ...settings.rules, [key]: cycle(values, settings.rules[key]) } }),
})

const pref = <K extends keyof Prefs>(
  id: string,
  hotkey: string,
  label: string,
  key: K,
  values: readonly Prefs[K][],
  show: (value: Prefs[K]) => string,
): SettingRow => ({
  id,
  group: 'prefs',
  hotkey,
  label,
  value: settings => show(settings.prefs[key]),
  next: settings => ({ ...settings, prefs: { ...settings.prefs, [key]: cycle(values, settings.prefs[key]) } }),
})

const yesNo = (value: boolean) => (value ? 'Yes' : 'No')
const onOff = (value: boolean) => (value ? 'On' : 'Off')
const BOOLS = [true, false] as const

export const SETTINGS: readonly SettingRow[] = [
  rule('decks', 'a', 'Decks in the shoe', 'decks', [1, 2, 4, 6, 8], String),
  rule('soft17', 'b', 'Dealer on soft 17', 'hitSoft17', BOOLS, hit => (hit ? 'Hits' : 'Stands')),
  rule('pays', 'c', 'Blackjack pays', 'blackjackPays', ['3:2', '6:5', '1:1'], String),
  rule('doubleOn', 'd', 'Double down on', 'doubleOn', ['any', '9-11', '10-11'], on => (on === 'any' ? 'Any two' : on)),
  rule('das', 'e', 'Double after split', 'doubleAfterSplit', BOOLS, yesNo),
  rule('maxHands', 'f', 'Split up to', 'maxHands', [1, 2, 3, 4], n => (n === 1 ? 'No splits' : `${n} hands`)),
  rule('resplitAces', 'h', 'Resplit aces', 'resplitAces', BOOLS, yesNo),
  rule('hitSplitAces', 'i', 'Hit split aces', 'hitSplitAces', BOOLS, yesNo),
  rule('surrender', 'j', 'Late surrender', 'surrender', BOOLS, yesNo),
  rule('insurance', 'k', 'Insurance offered', 'insurance', BOOLS, yesNo),
  rule('peek', 'l', 'Dealer peeks', 'dealerPeek', BOOLS, peek => (peek ? 'Yes (US)' : 'No (Euro)')),
  rule('penetration', 'm', 'Cut card at', 'penetration', [50, 60, 70, 75, 80, 85], p => `${p}%`),
  rule('table', 'n', 'Table limits', 'table', [0, 1, 2, 3], index => {
    const table = TABLES[index] ?? TABLES[0]

    return `${money(table.min * 100)}–${money(table.max * 100)}`
  }),
  rule('bankroll', 'p', 'Chips per window', 'bankroll', [500, 1000, 2500, 5000, 10000], dollars => money(dollars * 100)),
  pref('hints', 'q', 'Strategy hints', 'hints', BOOLS, onOff),
  pref('count', 'r', 'Hi-Lo card count', 'showCount', BOOLS, onOff),
  pref('speed', 's', 'Dealer speed', 'speed', ['normal', 'fast', 'instant'], speed => speed[0]!.toUpperCase() + speed.slice(1)),
  pref('autoOpen', 'u', 'Open when Claude works', 'autoOpen', BOOLS, onOff),
  pref('workOnly', 'v', 'Lock table when idle', 'workOnly', BOOLS, onOff),
  pref('statusLine', 'w', 'Bankroll in status line', 'statusLine', BOOLS, onOff),
]

export function changeSetting(settings: TableSettings, id: string): TableSettings {
  const row = SETTINGS.find(one => one.id === id)

  return row === undefined ? settings : row.next(settings)
}

export function rulesSummary(rules: Rules): string {
  const parts = [`${rules.decks}D`, rules.hitSoft17 ? 'H17' : 'S17', rules.blackjackPays]
  if (rules.doubleAfterSplit) parts.push('DAS')
  if (rules.surrender) parts.push('LS')
  if (!rules.dealerPeek) parts.push('ENHC')

  return parts.join(' ')
}
