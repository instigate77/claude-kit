# AG Code Updates
<!-- Created: 2026-10-14 | Format reference — see REFS/AG-Code-Updates.template.md -->
<!-- ORDER: NEWEST AT THE TOP. New entries go directly below the marker line;
     older entries follow beneath in descending date order. Never append to the bottom. -->
<!-- Prepend new updates below this line -->

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
