# usage-status

A Claude Code mod: the 5-hour and 7-day rate-limit windows, their end-of-window estimates, burn rate and time left, the prompt cache hit, and four system states (deploy lock, MemPalace, GitHub, hub).

- **Terminal**: a line above the prompt for the deploy lock and system states only; the quota is in the terminal's own status line (`statusline-usage.sh` in claude-config).
- **Desktop**: hands its numbers to [session-band](../session-band) through the state keys `usage-status/view` and `usage-status/systems`; while the band shows, the band draws them as its second row and this mod draws nothing. Without the band (or with it hidden) this mod draws the same row itself.

## Not standalone

It runs scripts from the Claude Code config folder (`~/.claude`, from `HOME`, else `USERPROFILE`) of [instigate77/claude-config](https://github.com/instigate77/claude-config):

- `bin/usage-cost.py`: the 7-day end estimate and the cost scan.
- `bin/servers-query`: the hub's address.
- `bin/deploy-lock.sh`: `list` and `watch` for the deploy lock.
- `locks/`: this machine's lock tokens; a change re-asks the hub.

It writes a trace to `~/.claude/cache/usage-status/trace.jsonl`. It needs `python3` (or `python`), `bash`, `curl` and `date` on PATH. On Windows the scripts run under Git Bash (scoop, then `C:/Program Files/Git`), because bare `bash` there is the WSL launcher.

That is why it is not in the marketplace catalog.

## Load

Add the folder to `CLAUDE_CODE_PLUGIN_DIRS` (separator `:` on macOS, `;` on Windows), beside session-band.

## Test

```bash
claude plugin test plugins/usage-status
```
