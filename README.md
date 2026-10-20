# Blackjack for Claude Code

A Claude Code mod that puts a blackjack table in a pane beside the chat, so you can
play with fake money while Claude works on your prompt.

- **Side panel.** In the fullscreen layout the table docks beside the transcript. On
  the main screen it opens above the prompt.
- **Opens when Claude starts working.** The header shows `● Claude working 0:42`,
  `✓ Claude done (42s)`, or `▲ Claude needs you` when a permission prompt is waiting.
- **Fresh chips every five-hour window.** Each time your Claude five-hour usage limit
  resets, the table deals you a fresh $1,000 in fake chips (or $500 to $10,000, set in
  Rules as *Chips per window*). There are no rebuys: if you go broke, the table shows
  when the next window's chips arrive. The header counts down: `↻ new chips in 2h 13m`.
  A hand in play is finished before the new chips are dealt. Where no five-hour limit is
  reported (an API key rather than a subscription), the table keeps five hours on its own
  clock.
- **Records for every window.** The Records view (`e`) shows the window in play (when it
  started and resets, and the best and worst bankroll so far), your all-time record high
  and low, and each past window's best, worst and closing bankroll. The last 50 windows
  you played are kept. Chips, stats and records are saved between sessions.
- **Bets.** Four chips sized to the table, plus −chip, ×2, clear, and max. Table limits
  are $5–$500, $10–$1,000, $25–$2,500, or $100–$10,000.
- **Table rules you can change:** decks (1/2/4/6/8), dealer hits or stands on soft 17,
  blackjack pays 3:2, 6:5 or 1:1, double on any two / 9–11 / 10–11, double after split,
  split up to 1–4 hands, resplit aces, hit split aces, late surrender, insurance and
  even money, dealer peek (US) or no hole card (European), and cut-card penetration.
- **Extras:** basic-strategy hints, a Hi-Lo running/true count, a strategy accuracy
  stat, dealer speed, and an option to lock the table while Claude is idle.

## Install

For the current session, run Claude Code with the mod folder loaded:

```
claude --plugin-dir C:\Users\engoo\Documents\claude_blackjack
```

To install it for every session, add this folder as a local marketplace and install
the plugin from it:

```
claude plugin marketplace add C:\Users\engoo\Documents\claude_blackjack
claude plugin install blackjack@claude-blackjack
```

The installed plugin is read from this folder. After you edit it, run `/reload-plugins`.

## Play

| Where | Keys |
| --- | --- |
| Betting | `1`–`4` add a chip · `z` take one off · `x` double · `c` clear · `m` max · `n` deal |
| Insurance | `y` insure (or take even money) · `n` no thanks |
| Your hand | `h` hit · `s` stand · `d` double · `p` split · `r` surrender |
| Anywhere | `o` rules · `t` stats · `e` records · `g` help |

Click the table, or press `ctrl+x` then `tab`, to give it the keyboard. `Esc` hands
the keyboard back to the prompt. You can also click any control with the mouse in
the fullscreen layout.

Commands:

- `/blackjack` opens the table at any width. It also works while a prompt is running.
- `/blackjack close` closes the table.
- `/blackjack rules`, `/blackjack stats`, `/blackjack records` and `/blackjack help` open
  those views.
- `/blackjack reset` starts over: fresh chips, and stats and window records cleared. The
  window's reset time stays as it was.

When you open the table yourself, it opens at any width. When it opens on its own as
Claude starts working, it needs a terminal at least 144 columns wide (110 once you have
opened it before). If you close the table, it stays closed until you run `/blackjack`
again in that session.

## Files

- `hooks/engine.ts`: the game as pure functions (shoe, rules, payouts, basic strategy).
- `hooks/view.tsx`: draws the pane.
- `hooks/register.tsx`: the hooks. It keeps state, saves your chips, plays the dealer on
  a timer, follows the five-hour limit (`$.session.usage()` at start, `session.measure`
  after, and a 30-second clock check), and handles `/blackjack` and the Claude-working
  signals.
- `types/index.d.ts`: the state contract.
- `tests/`: engine rules and pane tests. Run them with `claude plugin test .`
