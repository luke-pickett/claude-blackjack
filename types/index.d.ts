/** A card as a number 0..51: rank is `card % 13` (0 = ace .. 12 = king), suit `card / 13` (0 ♠, 1 ♥, 2 ♦, 3 ♣). */
export type Card = number

export type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'surrender'

export type Action = 'hit' | 'stand' | 'double' | 'split' | 'surrender'

export type Hand = {
  cards: Card[]
  /** The wager on this hand in cents, doubled included. */
  bet: number
  isDoubled: boolean
  isDone: boolean
  isSplit: boolean
  isSplitAces: boolean
  isSurrendered: boolean
  result: HandResult | null
  /** What the hand won (+) or lost (-) in cents, once settled. */
  net: number
}

export type Phase = 'betting' | 'insurance' | 'player' | 'dealer'

export type Outcome = {
  /** The round's net in cents, insurance included. */
  net: number
  insuranceNet: number
  headline: string
  tone: 'win' | 'lose' | 'push'
}

export type Stats = {
  rounds: number
  hands: number
  wins: number
  losses: number
  pushes: number
  blackjacks: number
  busts: number
  surrenders: number
  doubles: number
  splits: number
  insurances: number
  net: number
  biggestWin: number
  biggestLoss: number
  peak: number
  /** Positive for a run of winning rounds, negative for losing ones. */
  streak: number
  bestStreak: number
  decisions: number
  correct: number
}

/** One five-hour usage-limit window at the table: the chips it dealt and how low and high they went. */
export type LimitWindow = {
  /** When the window's chips were dealt, in ms since the epoch; 0 until the table first sees the time. */
  startedAt: number
  /** When the window ends, in ms since the epoch; null while the next five-hour limit has not been reported. */
  resetsAt: number | null
  /** `limit` when `resetsAt` is the account's five-hour limit, `clock` when the table keeps five hours itself. */
  source: 'limit' | 'clock'
  /** The bankroll in cents when the window opened. */
  start: number
  /** The highest bankroll between rounds, in cents. */
  best: number
  /** The lowest bankroll between rounds, in cents. */
  worst: number
  /** The bankroll after the window's latest round, in cents. */
  end: number
  rounds: number
}

export type Game = {
  v: number
  phase: Phase
  /** Cents off the table. */
  bankroll: number
  /** Cents to wager on the next deal. */
  bet: number
  shoe: Card[]
  shoeSize: number
  shoeDecks: number
  runningCount: number
  seed: number
  dealer: Card[]
  isHoleShown: boolean
  hands: Hand[]
  active: number
  /** Cents staked on insurance this round; 0 for none. */
  insurance: number
  outcome: Outcome | null
  notice: string | null
  round: number
  stats: Stats
  /** The five-hour window being played now. */
  window: LimitWindow
  /** Finished windows that saw a round, newest first. */
  history: LimitWindow[]
}

export type Rules = {
  decks: number
  hitSoft17: boolean
  blackjackPays: '3:2' | '6:5' | '1:1'
  doubleOn: 'any' | '9-11' | '10-11'
  doubleAfterSplit: boolean
  /** Most hands a round may be split into; 1 means no splitting. */
  maxHands: number
  resplitAces: boolean
  hitSplitAces: boolean
  surrender: boolean
  insurance: boolean
  dealerPeek: boolean
  /** Percent of the shoe dealt before the cut card brings a reshuffle. */
  penetration: number
  /** Index into the table limits. */
  table: number
  /** The chips each five-hour window deals, in dollars. */
  bankroll: number
}

export type Prefs = {
  hints: boolean
  showCount: boolean
  speed: 'normal' | 'fast' | 'instant'
  autoOpen: boolean
  workOnly: boolean
  statusLine: boolean
}

export type TableSettings = { rules: Rules; prefs: Prefs }

export type View = 'table' | 'rules' | 'stats' | 'records' | 'help'

export type ClaudeStatus = {
  isWorking: boolean
  /** When the current turn started, in ms since the epoch. */
  since: number
  /** How long the last finished turn took. */
  lastMs: number | null
  /** What Claude is waiting on the person for (a permission prompt), if anything. */
  attention: string | null
}

declare module 'claude-code' {
  interface PluginState {
    blackjack: {
      game: Game
      settings: TableSettings
      view: View
      claude: ClaudeStatus
      now: number
      /** When the account's five-hour limit resets, as last reported, in ms since the epoch. */
      limit: number | null
      isDismissed: boolean
      confirm: string | null
    }
  }
}
