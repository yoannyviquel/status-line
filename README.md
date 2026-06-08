# status-line

Additive Claude Code status line rendered as a single **powerline strip** of
configurable segments (rounded caps at both ends, filled chevrons between):

- `ctx` — context-window usage gauge (segment background colored green→red by the %)
- `5h` — 5h rate-limit quota gauge
- `7d` — 7d rate-limit quota gauge
- `dir` — current directory name (folder glyph)
- `branch` — current git branch (branch glyph; omitted outside a repo)
- `status` — Claude service status ([status.claude.com](https://status.claude.com/)): a colored dot shown **only during an incident** (hidden when all systems are operational), clickable to open the status page
- `gap` — splitter: everything after it is right-aligned to the window's right edge

```
  47%   30% →1am   82% →Jun12    tfs   main 
```

Each gauge segment shows `NN%` followed by its label and is tinted by its usage
level (green = low, red = high). The `5h` / `7d` labels are the **dynamic reset
time** reported by Claude Code (`→1am` same-day, `→Jun12` otherwise); they fall
back to `→5h` / `→7j` when no timestamp is available. `ctx` shows just `NN%`
(no label). `dir` / `branch` use light backgrounds with dark text. `status` is a
colored dot (yellow/orange/red/blue by severity) that only appears when
status.claude.com reports an incident; it is fetched in the background into a
small cache (`~/.claude/claude-status.cache.json`) so the render never blocks on
the network, and the dot is an OSC 8 hyperlink to the status page.

**Requirements:** a **truecolor** (24-bit) terminal, `node` on PATH, and a
**Nerd Font** for the powerline glyphs (caps, chevrons, folder/branch icons) —
without one they show as tofu boxes. Grab one at <https://www.nerdfonts.com/>
and set it as your terminal font.

## Elements & order

The displayed elements are an **ordered list** in
`~/.claude/gradient-statusline.config.json`. Order = display order; presence =
enabled. Whatever ends up first/last carries the rounded cap; absent data (no
quota, no git repo) drops that segment automatically.

```json
{ "baseCommand": "", "elements": [ {"type":"ctx"}, {"type":"5h"}, {"type":"7d"}, {"type":"dir"}, {"type":"branch"} ] }
```

## Why a command and not automatic?

Claude Code plugins **cannot** set the main `statusLine` directly (plugin
`settings.json` only supports `agent` / `subagentStatusLine`). So this plugin
ships a one-shot installer instead of patching your settings silently.

## Install

1. Add the plugin (via your marketplace), then enable it.
2. Run once:

   ```
   /install-statusline
   ```

   It copies `statusline.js` to `~/.claude/gradient-statusline.js` and points
   `statusLine` in your `~/.claude/settings.json` at it. Any existing config is
   backed up to `settings.json.bak`, and a previously configured status line is
   preserved as a prefix (additive). A fresh install enables all five elements.
3. Restart Claude Code (or open a new session).

The installed script lives at `~/.claude/gradient-statusline.js` — independent of
the plugin, so it keeps working if the plugin is later updated or removed.

## Configure

Use the interactive command (no restart needed — the config is re-read on every
refresh):

```
/statusline-mode
```

…or pass elements directly (order = display order):

```
/statusline-mode ctx 5h dir branch
```

Running with no argument prints the current configuration.

## Tests

End-to-end tests (zero dependency — just `node`) cover element on/off
combinations, the intermediate separators (black band vs merged dir/branch),
rounded caps at both ends, right-align via `gap`, and graceful drops
(missing data, non-git, legacy config):

```
node tests/e2e.js      # or: npm test
```

## Uninstall

Remove the `statusLine` block from `~/.claude/settings.json` (or restore
`settings.json.bak`) and delete `~/.claude/gradient-statusline.js`.

## Tweak the look

Constants at the top of `scripts/statusline.js`:

- `GLYPH` — folder / branch icons and the powerline caps & chevron.
- `LABELS` — gauge labels (`ctx`, `→5h`, `→7j`).
- `GAUGE_FG` — gauge text color; `SEG` — `dir` / `branch` segment colors.
- `grad`'s `m=170` — color brightness ceiling (lower = darker).

> `~/.claude/gradient-statusline.js` is a copy and gets overwritten on reinstall.
> To persist changes, edit the source `scripts/statusline.js` and re-run
> `/install-statusline`.
