# AG Code Updates
<!-- Created: 2026-10-14 | Format reference — see REFS/AG-Code-Updates.template.md -->
<!-- ORDER: NEWEST AT THE TOP. New entries go directly below the marker line;
     older entries follow beneath in descending date order. Never append to the bottom. -->
<!-- Prepend new updates below this line -->

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: bolder 5h/7d rings
================================================================================
```

## 14OCT26: quota rings drawn with a 3 wide line, same 24 px size  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (`QUOTA_STROKE = 3` for every circle in `quotaIcon`: track, purple estimate arc, used arc; the other rings keep 2), `hooks/band.test.tsx` (the grid test checks both quota rings are 24 px with no 2 wide line and the turn ring keeps 2).

**Why** Operator 14OCT26: make the 5h/7d circles more visible, slightly bigger or bold. Bolder, not bigger, so the one-size grid stays aligned; usage-status's own ring already draws its arcs 3 wide.

**Verification** `claude plugin test`: 11 pass; with the stroke set back to 2 the grid test fails (checked, then restored). Not verified: the live band.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - usage-status: moved into the kit
================================================================================
```

## 14OCT26: `plugins/usage-status` added, copied from claude-config  `[I]`

**Files** `plugins/usage-status/` (`hooks/register.tsx`, `hooks/hooks.json`, `hooks/strip.test.ts` copied unchanged from instigate77/claude-config `skills/usage-status` at `33b213e`, except the test's stale "ships without plugin.json" comment; `.claude-plugin/plugin.json` keeps the name `usage-status`, version 0.2.0, author and repository added; new `README.md`), root `README.md` (listed; not added to `marketplace.json` because it needs `~/.claude/bin` scripts).

**Why** Operator 14OCT26: one place to maintain the usage display; the two mods stay separate. The name stays because session-band reads its state keys by plugin name.

**Verification** `claude plugin test plugins/usage-status`: 51 pass. Not yet loaded from here: the cutover (`CLAUDE_CODE_PLUGIN_DIRS`, then removing the claude-config copy) is the next step of the plan.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: quota rings show the end estimate as a second arc
================================================================================
```

## 14OCT26: 5h/7d rings draw the end estimate in purple past the used %  `[I]`

**Files** `plugins/session-band/types/index.d.ts` (`UsageView.quotas[]` gains optional `final`, the end-of-window estimate %), `plugins/session-band/hooks/register.tsx` (`quotaIcon` takes `final`: when past the used %, a grey track and a `#a78bdb` arc from used to estimate under the used arc; otherwise unchanged), `hooks/band.test.tsx` (the grid test's 7d carries `final: 95` and checks the arc; the 5h ring without one keeps its track).

**Why** Operator 14OCT26: one circle with current usage in one colour and the estimated final usage in another (mock option B). `final` comes from usage-status (claude-config `33b213e`).

**Verification** `claude plugin test`: 11 pass. `tsc`: not run (no TypeScript compiler on this machine). Not verified: the live band.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: alert red is a true red
================================================================================
```

## 14OCT26: ALERT #e0846b → #ef4444  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (`ALERT` is `#ef4444`, which changes the lock taken and down icons, the cache countdown's last-10-minutes frame and its countdown text; the context bar at 85% or more now uses `ALERT` too), `hooks/band.test.tsx` (icon test expects the new red).

**Why** Operator 14OCT26: "doesn't it have a real red, that is sort of orange"; go for one red throughout, cache countdown included.

**Verification** `claude plugin test`: 11 pass. `tsc`: no errors. Not verified: the live band.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: system icons red when taken or down
================================================================================
```

## 14OCT26: lock taken and systems down are red; GitHub's minor level amber  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (`systemColor`: true green, false red (`ALERT`), `'minor'` amber, unknown grey), `types/index.d.ts` (`Systems.gh` may be `'minor'`), `hooks/band.test.tsx` (icon test covers red, amber and grey; green is in the grid test).

**Why** Operator 14OCT26: "make the lock icon RED if lock taken ... if there are no [intermediate states] then DOWN should be red, if there are intermediate steps, make them amber". MemPalace and the hub report only up or down; GitHub's status page has its own levels, and its "minor" is the one drawn amber.

**Verification** `claude plugin test`: 11 pass; drawing a down system amber fails the icon test. `tsc`: no errors. Not verified: the live band.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: grid rows touch; filling rings outlined in their colour
================================================================================
```

## 14OCT26: no gap between the grid rows; context/5h/7d rings read full  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (grid columns `rowGap` 0 instead of 1; the context and quota rings' unfilled part is the ring's own colour at 0.4 instead of grey at 0.35, so a little-filled ring reads as large as the solid ones), `hooks/band.test.tsx` (grid test checks the gap and a quota ring's outline).

**Why** Operator 14OCT26: the two lines "a little far apart", and the 5h/7d icons looked smaller than the others (the same size in code: a mostly grey ring read smaller).

**Verification** `claude plugin test`: 11 pass; with the gap back the grid test fails. `tsc`: no errors. Not verified: the live band.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: grid keeps both bars
================================================================================
```

## 14OCT26: context and cache-hit bars back in the grid  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (in the grid, the context and cache-hit bars show at tiers 0-2 through one `showBars` flag, so they appear and go together, one over the other; they had shown at tier 0 only, which the grid's extra columns put out of reach at an ordinary width), `hooks/band.test.tsx` (new test at 100 columns).

**Why** Operator 14OCT26: "you lost the bar graph and I like that for both the context % and cache % I want them back and aligned".

**Verification** `claude plugin test`: 11 pass; with the tier-0 rule back the new test fails. `tsc`: no errors. Not verified: the live band.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: usage-status row drawn as one grid
================================================================================
```

## 14OCT26: session band and usage row as one grid (desktop)  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (on the desktop, when the `usage-status` mod publishes its `view`, the band draws both rows as columns of a top and a bottom cell: turn over 5h, speed over 7d, the countdown, the system icons, then context over the cache hit (icon, bar, % in a 4-cell slot); every cell has a 22 icon, the quota rings drawn like the context ring; the issue words on a line below; the tiers start 12 cells wider for the quota texts (11-cell slot); system icons and the grid now check for the desktop, as the terminal's element table has an `Svg` too, drawn as nothing), `types/index.d.ts` (`UsageView`, `usage-status.view`), `hooks/band.test.tsx` (grid and terminal tests), `README.md`.

**Why** Operator 14OCT26: "convert the whole thing to be displayed the same as the top part through the whole strip ... different size and alignments, the cache percentage is not lined up with the top graph"; go given for the one-grid rebuild.

**Verification** `claude plugin test`: 10 pass; leaving 5h out of the turn column fails the grid test. `claude plugin validate` passed. `tsc`: no errors. Not verified: the live band, and whether the cells' heights match on the desktop.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: fixed-width speed and cache countdown
================================================================================
```

## 14OCT26: speed and countdown in fixed slots  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (the speed text sits in a 10-cell slot, 6 when compact, and the cache countdown in a 7-cell slot (`SPEED_WIDTH`, `SPEED_WIDTH_COMPACT`, `COUNTDOWN_WIDTH`), so the icons after them stop moving as the texts change length), `hooks/band.test.tsx` (new test).

**Why** Operator 14OCT26: "make the time display fixed width as the icons to the right keep shfting".

**Verification** `claude plugin test`: 8 pass; dropping the countdown slot fails the new test. `claude plugin validate` passed. `tsc`: no errors. Not verified: the live band (a slot sized in cells; the desktop's proportional font may still let narrow digits shift a little).

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: system status icons on the row
================================================================================
```

## 14OCT26: session-band draws the usage-status system icons  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (reads the `usage-status` mod's `systems` state and, on the desktop, draws lock, MemPalace, GitHub and hub icons after the cache countdown: green OK, amber not OK, grey unknown, the padlock open when the lock is free; nothing when that mod does not run; the width tiers start 14 cells wider while they show), `types/index.d.ts` (`Systems`; `usage-status.systems` and the Cache mod's `expiresAt` declared, which also clears the 4 tsc errors about the Cache atom), `hooks/band.test.tsx` (two tests), `README.md`.

**Why** Operator 14OCT26: "put the lock/status icons on the top row"; operator choice: the session band draws them from usage-status's state. The words for a system that is not OK stay in the usage band.

**Verification** `claude plugin test`: 7 pass; swapping the OK/not-OK colours fails the icon test. `claude plugin validate` passed. `tsc`: no errors. Not verified: the live band, and whether 14 cells is the icons' real width.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band: $ item and token counter removed
================================================================================
```

## 14OCT26: session-band drops the $ item and the token counter  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (the $ item, its icon and `usd` are gone; the token counter from the entry below is undone; `stats` no longer keeps `total`, `turnCost`, `costAtStart` or `tokens`; `turn.start` no longer reads the session cost; `refresh` keeps only the context; the green used by the context bar is renamed `GOOD`), `types/index.d.ts` (`Stats` is turn, speed, context), `hooks/band.test.tsx` (the token test is replaced by "band has no cost item"), `README.md` (band description).

**Why** Operator decision 14OCT26: the cost and the token counter are of no use on a Max plan. The band keeps turn, speed, the cache countdown and context.

**Verification** `claude plugin test`: 5 pass. With the old band code put back, "band has no cost item" fails (1 "$" text found instead of 0). `claude plugin validate` passed. `tsc`: 4 errors, all about the Cache mod's atom, none in the changed code. Not verified: the live band.

```
================================================================================
AG UPDATE - 14OCT26 - [I] - session-band $ item: session tokens and total cost
================================================================================
```

## 14OCT26: session-band $ item shows tokens and total cost  `[I]`

**Files** `plugins/session-band/hooks/register.tsx` (the $ item shows the session's tokens, e.g. "18.4M tok", then the session cost; the last-turn cost and its `turnCost`/`costAtStart` state are gone; `turn.step` adds input, output, cache-read and cache-write tokens of every response, subagents included, passing a subagent's step result on unchanged), `types/index.d.ts` (`Stats.tokens`), `hooks/band.test.tsx` (new test), `README.md` (band description).

**Why** Operator request 14OCT26: "change the $ icon to show total tokens used and total cost", all token kinds counted (operator choice). The app gives mods a session cost total but no token total, so the band adds the tokens up itself: in a session that was already running when the band loaded, earlier tokens are not counted.

**Verification** `claude plugin test`: 5 pass. Not counting subagent responses makes the new test fail (1.2M instead of 2.4M). `claude plugin validate` passed. `tsc`: only the 4 errors that are already on main (the Cache mod's atom), none in the new code. Not verified: the live band.

```
================================================================================
AG FIX - 14OCT26 - [I] - session-band hides other mods' bands above the prompt
================================================================================

 ___ _____  __
| __|_ _\ \/ /
| _| | | >  <
|_| |___/_/\_\
```

## 14OCT26: session-band stacks with other mods' bands  `[I]`

**Files**

| File | Role in this change |
|---|---|
| `plugins/session-band/hooks/register.tsx` | AbovePrompt render now draws the bands beneath it |
| `plugins/session-band/hooks/band.test.tsx` | New: stacking test on terminal and desktop |

**Problem Report**
With session-band loaded, the operator's other band above the prompt (usage-status: LOCK / MP / GH / HUB and quota) was no longer shown.

**Investigation**
session-band's `ui.render` hook on `AbovePrompt` returned its own row and never called `next(e)` once a turn had been answered [read: register.tsx:299-370 before this change], so no hook beneath it in the chain ran. usage-status does the same [read: ~/.claude/skills/usage-status/hooks/register.tsx:610-623]. savvy-progress shows the stacking pattern: it awaits `next(e)`, drops the engine's `{ type: 'engine' }` placeholder, and nests the result under its own row [read: plugins/savvy-progress/hooks/register.tsx:1208-1211, 1238-1246].

**Root Cause**
The AbovePrompt hook answered for itself without calling `next(e)`, so every band beneath it in the chain was hidden.

**Changes**

*`plugins/session-band/hooks/register.tsx` — AbovePrompt render*
- `register.tsx:301-304` — before: no `next(e)` call on the drawing path → now: awaits `next(e)` (a rejection reads as nothing) and keeps the result as `below` unless it is the engine's placeholder, which the desktop refuses to nest.
- `register.tsx:333, 375-376` — before: the band was a single row `Box` → now: that row sits in a column `Box` with `below` under it.

*`plugins/session-band/hooks/band.test.tsx` — new*
- Mounts the band on `terminal` and `desktop` after one turn; with a stand-in band beneath, both rows are drawn; alone, only its own row.

**Not Changed** *(deliberate — do not "fix" these)*
- The early `return next(e)` when hidden, on turn 0 or during a survey: other bands still show alone there.
- The four existing `tsc` errors at `register.tsx:50, 203, 205` (reading the `Cache` mod's state through `atom`). They are on unchanged upstream main too and are not part of this fix.
- usage-status still does not call `next(e)`; with session-band now above it, that does not hide anything.

**Verified**
- `claude plugin test plugins/session-band`: 4 pass, 0 fail.
- Fault check: with the old `register.tsx` restored, both stacking tests fail (`other: 0`, expected `1`); with the fix, they pass again.
- `claude plugin validate plugins/session-band`: passed.
- `tsc -p plugins/session-band`: no new errors; the same 4 as unchanged main.
- **NOT checked in the live app.** Load order between session-band and usage-status was not observed.

**Follow-ups**
- usage-status (`~/.claude/skills/usage-status`) could also call `next(e)`, so the bands stack whichever loads first.
