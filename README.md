# gradient-statusline

Claude Code status line with **green-to-red gradient progress bars** for:

- `ctx:` — context window usage
- `→<reset>:` — 5h rate-limit quota (reset shown as a time, e.g. `→1am`)
- `→<reset>:` — 7d rate-limit quota (reset shown as a date, e.g. `→Jun5`)

```
~/project (main) Opus 4.8  ctx:███░░░░░░░ | →1am:███░░░░░░░ | →Jun5:███░░░░░░░
```

Each filled cell is colored along a green→yellow→red gradient by its position;
empty cells are dim gray. Requires a truecolor (24-bit) terminal and `node` +
`bash` on PATH.

## Why a command and not automatic?

Claude Code plugins **cannot** set the main `statusLine` directly (plugin
`settings.json` only supports `agent` / `subagentStatusLine`). So this plugin
ships a one-shot installer instead of patching your settings silently.

## Install

1. Add the plugin (via your marketplace), then enable it.
2. Run the command once:

   ```
   /install-statusline
   ```

   It copies `statusline.sh` to `~/.claude/gradient-statusline.sh` and points
   `statusLine` in your `~/.claude/settings.json` at it. Any existing config is
   backed up to `settings.json.bak`.
3. Restart Claude Code (or open a new session).

The installed script lives at `~/.claude/gradient-statusline.sh` — independent
of the plugin, so it keeps working if the plugin is later updated or removed.

## Uninstall

Remove the `statusLine` block from `~/.claude/settings.json` (or restore
`settings.json.bak`) and delete `~/.claude/gradient-statusline.sh`.

## Customize

Edit `~/.claude/gradient-statusline.sh`:

- `BAR_W=10` — bar width in cells (1 cell per 10%).
- `m=170` in `grad_rgb` — gradient brightness ceiling (lower = darker).
- empty-cell color `38;2;60;60;60`.
