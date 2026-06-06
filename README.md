# status-bar

Additive Claude Code status line rendered as a single **powerline strip** of
configurable segments (rounded caps at both ends, filled chevrons between):

- `ctx` — context-window usage gauge (segment background colored green→red by the %)
- `5h` — 5h rate-limit quota gauge
- `7d` — 7d rate-limit quota gauge
- `dir` — current directory name (folder glyph)
- `branch` — current git branch (branch glyph; omitted outside a repo)
- `gap` — splitter: everything after it is right-aligned to the window's right edge

```
 ctx 47%  →5h 30%  →7j 82%   tfs   main 
```

Each gauge segment shows `<label> NN%` and is tinted by its usage level
(green = low, red = high). `dir` / `branch` use light backgrounds with dark text.

**Requirements:** a **truecolor** (24-bit) terminal, `node` on PATH, and a
**Nerd Font** for the powerline glyphs (caps, chevrons, folder/branch icons) —
without one they show as tofu boxes.

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
