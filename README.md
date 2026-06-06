# status-bar

Additive Claude Code status line with **configurable elements**:

- `ctx:` — context-window usage (green→red gradient bar)
- `→<reset>:` — 5h rate-limit quota (reset as a time, e.g. `→1am`)
- `→<reset>:` — 7d rate-limit quota (reset as a date, e.g. `→Jun5`)
- `dir` — current directory name (powerline segment)
- `branch` — current git branch (powerline segment, nests with `dir`)

```
~/project Opus 4.8  ctx:███░░░░░░░ | →1am:███░░░░░░░ | →Jun5:███░░░░░░░    status-bar  main 
```

Each filled gradient cell is colored green→yellow→red by its position; empty
cells are dim gray. The `dir` / `branch` segments render powerline-style (folder
/ branch glyphs, filled chevrons, light backgrounds).

**Requirements:** a **truecolor** (24-bit) terminal, `node` on PATH, and — for
the `dir` / `branch` glyphs — a **Nerd Font** (otherwise they show as tofu
boxes; the gradient bars work without one).

## Elements, order & sizes

The displayed elements are an **ordered list** in
`~/.claude/gradient-statusline.config.json`. Order = display order; presence =
enabled. Each bar (`ctx` / `5h` / `7d`) has its own size:

- `large` — 10-cell bar (1 cell / 10%)
- `medium` — 5-cell bar (1 cell / 20%)
- `compact` — `NN%` on a gradient box, no bar

`dir` / `branch` are powerline text segments (no size). When `dir` is enabled it
provides the left cap and `branch` chains onto it via a chevron; when `dir` is
disabled, `branch` carries its own opening cap.

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

…or pass tokens directly (order = display order):

```
/statusline-mode ctx:large 5h:medium 7d:compact dir branch
```

Tokens: `ctx[:size]`, `5h[:size]`, `7d[:size]` (size defaults to `large`), `dir`,
`branch`. Running with no argument prints the current configuration.

## Uninstall

Remove the `statusLine` block from `~/.claude/settings.json` (or restore
`settings.json.bak`) and delete `~/.claude/gradient-statusline.js`.

## Tweak the look

Glyphs and colors are constants at the top of `scripts/statusline.js`:

- `GLYPH` — folder / branch icons and the powerline caps & chevron.
- `SEG` — the `dir` / `branch` segment background & foreground colors.
- `gradRgb`'s `m=170` — gradient brightness ceiling (lower = darker); empty-cell
  color is `38;2;60;60;60`.

> `~/.claude/gradient-statusline.js` is a copy and gets overwritten on reinstall.
> To persist changes, edit the source `scripts/statusline.js` and re-run
> `/install-statusline`.
