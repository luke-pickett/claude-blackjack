// Draws the pane from plain data: what `register.tsx` read from `$.state`,
// the surface's elements, and the handlers a press runs.
import type { BoxProps, ButtonProps, ElementConstructor, RenderNode, TextProps } from 'claude-code'

import type { Action, Card, ClaudeStatus, Game, Hand, LimitWindow, TableSettings, View } from '../types'
import * as E from './engine'

export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type Controls = {
  chip: (dollars: number) => Promise<void>
  removeChip: () => Promise<void>
  clearBet: () => Promise<void>
  doubleBet: () => Promise<void>
  maxBet: () => Promise<void>
  deal: () => Promise<void>
  insure: (isTaken: boolean) => Promise<void>
  play: (action: Action) => Promise<void>
  show: (view: View) => Promise<void>
  change: (id: string) => Promise<void>
  restoreRules: () => Promise<void>
  reset: () => Promise<void>
}

export type Scene = {
  game: Game
  settings: TableSettings
  view: View
  claude: ClaudeStatus
  now: number
  confirm: string | null
  columns: number
  rows: number
}

const RED = '#ef4444'
const FELT = '#22c55e'
const GOLD = '#eab308'
const BACK = '#3b82f6'
const CHIP_COLORS: Record<number, string> = {
  5: '#ef4444',
  10: '#3b82f6',
  25: '#22c55e',
  50: '#f97316',
  100: '#a3a3a3',
  500: '#a855f7',
  1000: '#eab308',
  5000: '#ec4899',
}

const ACTIONS: Record<Action, { label: string; hotkey: string }> = {
  hit: { label: 'Hit', hotkey: 'h' },
  stand: { label: 'Stand', hotkey: 's' },
  double: { label: 'Double', hotkey: 'd' },
  split: { label: 'Split', hotkey: 'p' },
  surrender: { label: 'Surrender', hotkey: 'r' },
}

type Size = 'lg' | 'sm'

export function drawPane(kit: Kit, scene: Scene, controls: Controls) {
  const { Box } = kit
  const width = Math.max(24, scene.columns)
  const body =
    scene.view === 'rules'
      ? rulesView(kit, scene, controls, width)
      : scene.view === 'stats'
        ? statsView(kit, scene, controls)
        : scene.view === 'records'
          ? recordsView(kit, scene, controls, width)
          : scene.view === 'help'
            ? helpView(kit, controls)
            : tableView(kit, scene, controls, width)

  return (
    <Box flexDirection="column">
      {header(kit, scene, width)}
      {line(kit, width)}
      {body}
    </Box>
  )
}

function line(kit: Kit, width: number) {
  const { Text } = kit

  return <Text dimColor>{'─'.repeat(width)}</Text>
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A wait in hours and minutes, rounded up: `2h 05m`, `45m`. */
function span(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes}m`

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A local time of day: `3:05 PM`. */
function timeOfDay(ms: number): string {
  const at = new Date(ms)
  const hours = at.getHours()

  return `${hours % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

/** A local day and time: `Oct 19 3:05 PM`. */
function moment(ms: number): string {
  if (ms === 0) return '–'
  const at = new Date(ms)

  return `${MONTHS[at.getMonth()]} ${at.getDate()} ${timeOfDay(ms)}`
}

/** When the next window's chips come, for the header; null while that is not known. */
function nextChips(game: Game, now: number, isWide: boolean): string | null {
  const { resetsAt } = game.window
  if (resetsAt === null || now === 0) return null
  if (now >= resetsAt) return game.phase === 'betting' ? '↻ new chips now' : '↻ new chips after this hand'

  return isWide ? `↻ new chips in ${span(resetsAt - now)}` : `↻ ${span(resetsAt - now)}`
}

function header(kit: Kit, scene: Scene, width: number) {
  const { Box, Text } = kit
  const { claude } = scene
  const status =
    claude.attention !== null ? (
      <Text bold color="warning">▲ Claude needs you</Text>
    ) : claude.isWorking ? (
      <Text color="claude">● Claude working {clock(scene.now - claude.since)}</Text>
    ) : claude.lastMs !== null ? (
      <Text color="success">✓ Claude done ({clock(claude.lastMs)})</Text>
    ) : (
      <Text dimColor>○ Claude idle</Text>
    )
  const chips = width >= 32 ? nextChips(scene.game, scene.now, width >= 44) : null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={FELT}>
          {width >= 30 ? '♠ ♥ BLACKJACK ♦ ♣' : '♠ BLACKJACK'}
        </Text>
        <Text bold color={GOLD}>
          {E.money(scene.game.bankroll)}
        </Text>
      </Box>
      <Box flexDirection="row" justifyContent="space-between">
        {status}
        {chips !== null && <Text dimColor>{chips}</Text>}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- cards

function cardFace(kit: Kit, card: Card | null, size: Size) {
  const { Box, Text } = kit
  if (card === null) {
    const rows = size === 'lg' ? ['░░░░░', '░░░░░', '░░░░░'] : ['░░░']

    return (
      <Box borderStyle="round" borderColor={BACK} flexDirection="column">
        {rows.map(row => (
          <Text color={BACK}>{row}</Text>
        ))}
      </Box>
    )
  }
  const rank = E.rankLabel(card)
  const suit = E.suitLabel(card)
  const color = E.isRed(card) ? RED : 'text'
  if (size === 'sm') {
    return (
      <Box borderStyle="round" flexDirection="column">
        <Text bold color={color}>
          {(rank + suit).padEnd(3)}
        </Text>
      </Box>
    )
  }

  return (
    <Box borderStyle="round" flexDirection="column">
      <Text bold color={color}>
        {rank.padEnd(5)}
      </Text>
      <Text color={color}>{`  ${suit}  `}</Text>
      <Text bold color={color}>
        {rank.padStart(5)}
      </Text>
    </Box>
  )
}

function cardRow(kit: Kit, cards: (Card | null)[], size: Size) {
  const { Box } = kit

  return <Box flexDirection="row" flexWrap="wrap">{cards.map(card => cardFace(kit, card, size))}</Box>
}

function sizeFor(scene: Scene, width: number): Size {
  const { game } = scene
  const most = Math.max(2, game.dealer.length, ...game.hands.map(hand => hand.cards.length))
  if (game.hands.length > 2 || most * 7 > width || scene.rows < 26) return 'sm'

  return 'lg'
}

function totalLabel(cards: readonly Card[]): string {
  if (cards.length === 0) return ''
  if (E.isBlackjack(cards)) return 'Blackjack'
  const { total, isSoft } = E.handTotal(cards)
  if (total > 21) return `${total}, bust`

  return isSoft ? `soft ${total}` : String(total)
}

const RESULTS: Record<NonNullable<Hand['result']>, { text: string; color: string }> = {
  blackjack: { text: 'BLACKJACK', color: GOLD },
  win: { text: 'WIN', color: FELT },
  push: { text: 'PUSH', color: 'warning' },
  lose: { text: 'LOSE', color: RED },
  bust: { text: 'BUST', color: RED },
  surrender: { text: 'SURRENDER', color: 'subtle' },
}

function handHeader(kit: Kit, game: Game, hand: Hand, index: number) {
  const { Box, Text } = kit
  const isActive = game.phase === 'player' && game.active === index
  const name = game.hands.length > 1 ? `HAND ${index + 1}` : 'YOU'
  const result = hand.result === null ? undefined : RESULTS[hand.result]

  return (
    <Box flexDirection="row" gap={1}>
      <Text bold color={isActive ? GOLD : 'text'}>
        {isActive && game.hands.length > 1 ? '▶ ' : ''}
        {name}
      </Text>
      <Text>{totalLabel(hand.cards)}</Text>
      <Text dimColor>
        · {E.money(hand.bet)}
        {hand.isDoubled ? ' doubled' : ''}
      </Text>
      {result !== undefined && (
        <Text bold color={result.color}>
          {result.text} {hand.net === 0 ? '' : E.money(hand.net, true)}
        </Text>
      )}
    </Box>
  )
}

function dealerHeader(kit: Kit, game: Game) {
  const { Box, Text } = kit
  const up = game.dealer[0]
  const total =
    up === undefined ? '' : game.isHoleShown ? totalLabel(game.dealer) : `shows ${E.rankOf(up) === 0 ? 'an ace' : E.valueOf(up)}`

  return (
    <Box flexDirection="row" gap={1}>
      <Text bold>DEALER</Text>
      <Text>{total}</Text>
    </Box>
  )
}

// ---------------------------------------------------------------- the table

function tableView(kit: Kit, scene: Scene, controls: Controls, width: number) {
  const { Box, Text } = kit
  const { game } = scene
  const size = sizeFor(scene, width)
  const nodes: RenderNode[] = []

  if (game.round === 0) {
    nodes.push(
      <Box flexDirection="column" paddingY={1}>
        {cardRow(kit, [0, 25], scene.rows < 26 ? 'sm' : 'lg')}
        <Text wrap="wrap">
          Welcome to the table. You hold {E.money(game.bankroll)} in fake chips, dealt fresh each five-hour usage window.
          Set a bet with the number keys, then deal with n.
        </Text>
      </Box>,
    )
  } else {
    const dealerCards = game.dealer.map((card, at) => (at === 1 && !game.isHoleShown ? null : card))
    nodes.push(dealerHeader(kit, game), cardRow(kit, dealerCards, size))
    game.hands.forEach((hand, index) => {
      nodes.push(handHeader(kit, game, hand, index), cardRow(kit, hand.cards, size))
    })
  }

  nodes.push(line(kit, width), ...messages(kit, scene), ...actionsFor(kit, scene, controls))
  nodes.push(line(kit, width), footer(kit, scene, controls))

  return <Box flexDirection="column">{nodes}</Box>
}

function messages(kit: Kit, scene: Scene): RenderNode[] {
  const { Text } = kit
  const { game, settings } = scene
  const out: RenderNode[] = []
  if (game.phase === 'betting' && game.outcome !== null) {
    const color = game.outcome.tone === 'win' ? FELT : game.outcome.tone === 'lose' ? RED : 'warning'
    out.push(
      <Text bold color={color} wrap="wrap">
        {game.outcome.headline}
      </Text>,
    )
  }
  if (game.notice !== null) {
    out.push(
      <Text dimColor italic wrap="wrap">
        {game.notice}
      </Text>,
    )
  }
  if (game.phase === 'insurance') {
    const text = E.isEvenMoney(game)
      ? `Blackjack against an ace. Take even money (${E.money(game.hands[0]?.bet ?? 0, true)} now)?`
      : `The dealer shows an ace. Insurance costs ${E.money(E.insuranceCost(game))} and pays 2:1.`
    out.push(
      <Text color="warning" wrap="wrap">
        {text}
      </Text>,
    )
    if (settings.prefs.hints) out.push(<Text color={GOLD}>★ Basic strategy: decline</Text>)
  }
  if (game.phase === 'player' && settings.prefs.hints) {
    const best = E.recommend(game, settings.rules)
    if (best !== null) out.push(<Text color={GOLD}>★ Basic strategy: {ACTIONS[best].label}</Text>)
  }
  if (game.phase === 'dealer') out.push(<Text dimColor>The dealer plays…</Text>)

  return out
}

function actionsFor(kit: Kit, scene: Scene, controls: Controls): RenderNode[] {
  const { Box, Button, Text } = kit
  const { game, settings, claude } = scene
  const { rules } = settings

  if (game.phase === 'insurance') {
    return [
      <Box flexDirection="row" columnGap={3} flexWrap="wrap">
        <Button key="insure-yes" hotkey="y" plain onPress={() => controls.insure(true)}>
          {E.isEvenMoney(game) ? 'Even money' : 'Insure'}
        </Button>
        <Button key="insure-no" hotkey="n" plain onPress={() => controls.insure(false)}>
          No thanks
        </Button>
      </Box>,
    ]
  }

  if (game.phase === 'player') {
    const best = settings.prefs.hints ? E.recommend(game, rules) : null

    return [
      <Box flexDirection="row" columnGap={3} flexWrap="wrap">
        {E.available(game, rules).map(action => (
          <Button
            key={`play-${action}`}
            hotkey={ACTIONS[action].hotkey}
            plain
            onPress={() => controls.play(action)}
          >
            {ACTIONS[action].label}
            {action === best ? ' ★' : ''}
          </Button>
        ))}
      </Box>,
    ]
  }

  if (game.phase === 'dealer') return []

  const table = E.tableOf(rules)
  if (E.isBroke(game, rules)) {
    const { resetsAt } = game.window
    const when =
      resetsAt === null
        ? 'when this five-hour window resets (its time shows after Claude next replies)'
        : scene.now >= resetsAt
          ? 'any moment now'
          : `at ${timeOfDay(resetsAt)}, in ${span(resetsAt - scene.now)}`

    return [
      <Text color={RED} wrap="wrap">
        Out of chips for this window.
      </Text>,
      <Text wrap="wrap">
        Fresh {E.money(rules.bankroll * 100)} arrive {when}.
      </Text>,
    ]
  }
  const isPaused = settings.prefs.workOnly && !claude.isWorking

  return [
    <Box flexDirection="row" justifyContent="space-between">
      <Text bold>
        BET <Text color={GOLD}>{E.money(game.bet)}</Text>
      </Text>
      <Text dimColor>
        table {E.money(table.min * 100)}–{E.money(table.max * 100)}
      </Text>
    </Box>,
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      {table.chips.map((dollars, index) => (
        <Button key={`chip-${index}`} hotkey={String(index + 1)} plain onPress={() => controls.chip(dollars)}>
          <Text color={CHIP_COLORS[dollars] ?? GOLD}>●</Text>
          {` ${E.money(dollars * 100)}`}
        </Button>
      ))}
    </Box>,
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Button key="bet-less" hotkey="z" plain onPress={() => controls.removeChip()}>
        −{E.money(table.min * 100)}
      </Button>
      <Button key="bet-double" hotkey="x" plain onPress={() => controls.doubleBet()}>
        ×2
      </Button>
      <Button key="bet-clear" hotkey="c" plain onPress={() => controls.clearBet()}>
        Clear
      </Button>
      <Button key="bet-max" hotkey="m" plain onPress={() => controls.maxBet()}>
        Max
      </Button>
    </Box>,
    isPaused ? (
      <Text dimColor wrap="wrap">
        ⏸ Dealing opens while Claude works.
      </Text>
    ) : (
      <Button key="deal" hotkey="n" plain variant="primary" onPress={() => controls.deal()}>
        <Text bold color={FELT}>
          Deal ▶
        </Text>
      </Button>
    ),
  ]
}

function footer(kit: Kit, scene: Scene, controls: Controls) {
  const { Box, Button, Text } = kit
  const { game, settings } = scene
  const count = settings.prefs.showCount && game.shoeSize > 0
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

  return (
    <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap">
      <Box flexDirection="row" columnGap={2}>
        <Button key="view-rules" hotkey="o" plain dimColor onPress={() => controls.show('rules')}>
          Rules
        </Button>
        <Button key="view-stats" hotkey="t" plain dimColor onPress={() => controls.show('stats')}>
          Stats
        </Button>
        <Button key="view-records" hotkey="e" plain dimColor onPress={() => controls.show('records')}>
          Records
        </Button>
        <Button key="view-help" hotkey="g" plain dimColor onPress={() => controls.show('help')}>
          Help
        </Button>
      </Box>
      {count && (
        <Text dimColor>
          RC {sign(game.runningCount)} · TC {sign(Math.round(E.trueCount(game) * 10) / 10)} ·{' '}
          {E.decksLeft(game).toFixed(1)}d
        </Text>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------- the other views

function rulesView(kit: Kit, scene: Scene, controls: Controls, width: number) {
  const { Box, Button, Text } = kit
  const isLocked = scene.game.phase !== 'betting'
  const room = Math.min(width, 50) - 3
  const row = (setting: E.SettingRow) => {
    const value = setting.value(scene.settings)
    const dots = room - setting.label.length - value.length - 2
    const isDim = isLocked && setting.group === 'rules'

    return (
      <Button
        key={`set-${setting.id}`}
        hotkey={setting.hotkey}
        plain
        dimColor={isDim}
        onPress={() => controls.change(setting.id)}
      >
        {setting.label}
        {' '}
        {dots > 0 && <Text dimColor>{'·'.repeat(dots)} </Text>}
        <Text bold color={isDim ? 'subtle' : GOLD}>
          {value}
        </Text>
      </Button>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold color={FELT} wrap="wrap">
        TABLE RULES
        <Text dimColor> · {isLocked ? 'locked until the hand ends' : E.rulesSummary(scene.settings.rules)}</Text>
      </Text>
      {E.SETTINGS.filter(setting => setting.group === 'rules').map(row)}
      <Text> </Text>
      <Text bold color={FELT}>
        PREFERENCES
      </Text>
      {E.SETTINGS.filter(setting => setting.group === 'prefs').map(row)}
      <Text> </Text>
      {scene.game.notice !== null && (
        <Text dimColor italic wrap="wrap">
          {scene.game.notice}
        </Text>
      )}
      <Box flexDirection="row" columnGap={3} flexWrap="wrap">
        <Button key="rules-back" hotkey="o" plain variant="primary" onPress={() => controls.show('table')}>
          Back to the table
        </Button>
        <Button key="rules-defaults" hotkey="x" plain dimColor onPress={() => controls.restoreRules()}>
          House rules
        </Button>
      </Box>
    </Box>
  )
}

function statsView(kit: Kit, scene: Scene, controls: Controls) {
  const { Box, Button, Text } = kit
  const { game } = scene
  const stats = game.stats
  const percent = (part: number, whole: number) => (whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`)
  const streak = (n: number) => (n === 0 ? '–' : n > 0 ? `W${n}` : `L${-n}`)
  const netColor = stats.net > 0 ? FELT : stats.net < 0 ? RED : 'text'
  const pair = (label: string, value: string, color = 'text') => (
    <Text>
      <Text dimColor>{label} </Text>
      <Text bold color={color}>
        {value}
      </Text>
    </Text>
  )

  return (
    <Box flexDirection="column">
      <Text bold color={FELT}>
        YOUR STATS
      </Text>
      {pair('Bankroll', E.money(game.bankroll + E.onTable(game)), GOLD)}
      {pair('Net', E.money(stats.net, true), netColor)}
      {pair('Peak', E.money(stats.peak))}
      {pair('Rounds', `${stats.rounds} (${stats.hands} hands)`)}
      {pair('Won · Lost · Pushed', `${stats.wins} · ${stats.losses} · ${stats.pushes}`)}
      {pair('Win rate', percent(stats.wins, stats.wins + stats.losses))}
      {pair('Blackjacks · Busts', `${stats.blackjacks} · ${stats.busts}`)}
      {pair('Doubles · Splits', `${stats.doubles} · ${stats.splits}`)}
      {pair('Surrenders · Insured', `${stats.surrenders} · ${stats.insurances}`)}
      {pair('Best round', E.money(stats.biggestWin, true), FELT)}
      {pair('Worst round', E.money(stats.biggestLoss, true), RED)}
      {pair('Streak · Best run', `${streak(stats.streak)} · ${streak(stats.bestStreak)}`)}
      {pair('Basic strategy', `${percent(stats.correct, stats.decisions)} of ${stats.decisions} plays`)}
      {pair('Window best · worst', `${E.money(game.window.best)} · ${E.money(game.window.worst)}`)}
      <Text> </Text>
      <Box flexDirection="row" columnGap={3} flexWrap="wrap">
        <Button key="stats-back" hotkey="t" plain variant="primary" onPress={() => controls.show('table')}>
          Back to the table
        </Button>
        <Button key="stats-reset" hotkey="x" plain dimColor={scene.confirm !== 'reset'} onPress={() => controls.reset()}>
          {scene.confirm === 'reset' ? <Text color={RED}>Press again: records go too</Text> : 'Start over'}
        </Button>
      </Box>
    </Box>
  )
}

/** When the window in play ends, in words. */
function windowEnd(window: LimitWindow, phase: Game['phase'], now: number): string {
  if (window.resetsAt === null) return 'Its reset time shows after Claude next replies.'
  if (now >= window.resetsAt) return phase === 'betting' ? 'Resetting now.' : 'Resets when this hand ends.'
  const clock = window.source === 'clock' ? ' (table clock: no limit reported)' : ''

  return `Resets ${timeOfDay(window.resetsAt)}, in ${span(window.resetsAt - now)}${clock}.`
}

function recordsView(kit: Kit, scene: Scene, controls: Controls, width: number) {
  const { Box, Button, Text } = kit
  const { game, now } = scene
  const current = game.window
  const top = E.records(game)
  const hasEnd = width >= 43
  const room = Math.max(3, scene.rows - 17)
  const shown = game.history.slice(0, room)
  const cell = (cents: number) => E.money(cents).padStart(9)
  const pair = (label: string, value: string, color = 'text') => (
    <Text wrap="wrap">
      <Text dimColor>{label} </Text>
      <Text bold color={color}>
        {value}
      </Text>
    </Text>
  )
  const row = (past: LimitWindow) => (
    <Text>
      {moment(past.startedAt).padEnd(16)}
      <Text color={FELT}>{cell(past.best)}</Text>
      <Text color={RED}>{cell(past.worst)}</Text>
      {hasEnd ? cell(past.end) : ''}
    </Text>
  )

  return (
    <Box flexDirection="column">
      <Text bold color={FELT}>
        FIVE-HOUR WINDOWS
      </Text>
      {pair('This window', current.startedAt === 0 ? 'starting' : `since ${moment(current.startedAt)}`)}
      <Text dimColor wrap="wrap">
        {windowEnd(current, game.phase, now)}
      </Text>
      <Text wrap="wrap">
        <Text dimColor>Now </Text>
        <Text bold color={GOLD}>
          {E.money(game.bankroll + E.onTable(game))}
        </Text>
        <Text dimColor> · best </Text>
        <Text bold color={FELT}>
          {E.money(current.best)}
        </Text>
        <Text dimColor> · worst </Text>
        <Text bold color={RED}>
          {E.money(current.worst)}
        </Text>
      </Text>
      <Text dimColor>
        {current.rounds} {current.rounds === 1 ? 'round' : 'rounds'} from {E.money(current.start)}
      </Text>
      <Text> </Text>
      {pair('Record high', `${E.money(top.best.best)} · ${moment(top.best.startedAt)}`, FELT)}
      {pair('Record low', `${E.money(top.worst.worst)} · ${moment(top.worst.startedAt)}`, RED)}
      <Text> </Text>
      <Text bold>
        {'PAST WINDOWS'.padEnd(16)}
        {'BEST'.padStart(9)}
        {'WORST'.padStart(9)}
        {hasEnd ? 'END'.padStart(9) : ''}
      </Text>
      {shown.length === 0 ? (
        <Text dimColor wrap="wrap">
          None yet. Each window you play is filed here when its five hours are up.
        </Text>
      ) : (
        shown.map(row)
      )}
      {game.history.length > shown.length && <Text dimColor>and {game.history.length - shown.length} earlier</Text>}
      <Text> </Text>
      <Button key="records-back" hotkey="e" plain variant="primary" onPress={() => controls.show('table')}>
        Back to the table
      </Button>
    </Box>
  )
}

function helpView(kit: Kit, controls: Controls) {
  const { Box, Button, Text } = kit
  const keys = (keys: string, what: string) => (
    <Text wrap="wrap">
      <Text bold color={GOLD}>
        {keys}
      </Text>{' '}
      {what}
    </Text>
  )

  return (
    <Box flexDirection="column">
      <Text bold color={FELT}>
        HOW TO PLAY
      </Text>
      <Text wrap="wrap">
        Beat the dealer by getting closer to 21 without going over. Cards 2-10 count their number, faces 10, aces 1 or 11.
        The dealer draws to 17. Blackjack pays {'3:2'} (or as the rules say).
      </Text>
      <Text> </Text>
      <Text bold color={FELT}>
        KEYS
      </Text>
      <Text dimColor wrap="wrap">
        Click the table, or press ctrl+x then tab, to give it the keyboard. Esc hands it back to the prompt.
      </Text>
      {keys('1-4', 'add a chip · z take one off · x double · c clear · m max')}
      {keys('n', 'deal, or decline insurance · y take insurance')}
      {keys('h s d p r', 'hit · stand · double · split · surrender')}
      {keys('o t e g', 'rules · stats · records · this help')}
      <Text> </Text>
      <Text dimColor wrap="wrap">
        Fake money only. Each five-hour usage-limit window deals fresh chips, and Records keeps every window's best and
        worst. /blackjack opens the table; /blackjack close, rules, stats, records, help or reset.
      </Text>
      <Text> </Text>
      <Button key="help-back" hotkey="g" plain variant="primary" onPress={() => controls.show('table')}>
        Back to the table
      </Button>
    </Box>
  )
}
