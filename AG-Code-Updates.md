# AG Code Updates
<!-- Created: 2026-10-14 | Format reference — see REFS/AG-Code-Updates.template.md -->
<!-- ORDER: NEWEST AT THE TOP. New entries go directly below the marker line;
     older entries follow beneath in descending date order. Never append to the bottom. -->
<!-- Prepend new updates below this line -->

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
