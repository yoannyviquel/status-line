---
description: Configure the status-line elements (which ones and their order)
allowed-tools: Bash(node:*), AskUserQuestion
argument-hint: "[ctx 5h 7d dir branch]"
---

Configure which elements the status line shows and in which order. The look is a
single powerline strip: each element is a segment (rounded caps at both ends,
filled chevrons between).

Elements:

- `ctx` — context-window usage gauge (segment colored green→red by the %)
- `5h` — 5h rate-limit quota gauge
- `7d` — 7d rate-limit quota gauge
- `dir` — current directory name
- `branch` — current git branch (omitted outside a repo)

## If the user passed `$ARGUMENTS`

Elements are already given — run the command directly and report its output:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/set-mode.js" $ARGUMENTS
```

## Otherwise — interactive configuration

1. **Pick the elements** with **AskUserQuestion** (`multiSelect: true`, header
   `Elements`, question "Which elements to show?"): options `ctx`, `5h`, `7d`,
   `dir`, `branch`.

2. **Build the element list** in this fixed display order — `ctx`, `5h`, `7d`,
   `dir`, `branch` — keeping only the selected ones. (Finer ordering is possible
   by passing the elements directly as `$ARGUMENTS`, in any order.)

3. **Apply** by running, and report the output:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/set-mode.js" <elements>
   ```

Changes take effect on the next status-line refresh — **no restart needed**.
Running with no argument prints the current configuration.
