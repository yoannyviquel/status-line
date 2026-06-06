---
description: Configure the status-line elements (which ones, order, per-bar size)
allowed-tools: Bash(node:*), AskUserQuestion
argument-hint: "[ctx[:size] 5h[:size] 7d[:size] dir branch]"
---

Configure which elements the status line shows, in which order, and the size of
each gradient bar.

Elements:

- `ctx` — context-window usage bar
- `5h` — 5h rate-limit quota bar
- `7d` — 7d rate-limit quota bar
- `dir` — current directory name (powerline segment)
- `branch` — current git branch (powerline segment; nests with `dir`)

Bar sizes: `large` (10-cell bar) · `medium` (5-cell bar) · `compact` (`NN%` on a
gradient box, no bar). `dir`/`branch` have no size.

## If the user passed `$ARGUMENTS`

Tokens are already given — run the command directly and report its output:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/set-mode.js" $ARGUMENTS
```

## Otherwise — interactive configuration

1. **Pick the elements** with **AskUserQuestion** (`multiSelect: true`, header
   `Elements`, question "Which elements to show?"): options `ctx`, `→5h`, `→7d`,
   `dir`, `branch`.

2. **Pick a size for each enabled bar.** For whichever of `ctx` / `5h` / `7d`
   were selected, ask their sizes in a **single AskUserQuestion call** (one
   question per enabled bar, header `ctx size` / `5h size` / `7d size`), options
   `large`, `medium`, `compact`. Skip this step if no bar was selected.

3. **Build the token list** in this fixed display order — `ctx`, `5h`, `7d`,
   `dir`, `branch` — keeping only the enabled ones, appending `:size` to each
   selected bar. (Finer ordering is possible by passing tokens directly as
   `$ARGUMENTS`.)

4. **Apply** by running, and report the output:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/set-mode.js" <tokens>
   ```

Changes take effect on the next status-line refresh — **no restart needed**.
Running with no argument prints the current configuration.
