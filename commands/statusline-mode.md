---
description: Configure the status-line elements (which ones and their order)
allowed-tools: Bash(node:*), AskUserQuestion
argument-hint: "[ctx 5h 7d dir branch status]"
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
- `eta` — clock time at which the current ticket's **estimated production**
  finishes (`now + estimate − produced`). Needs a cached estimate for the branch's
  Jira key — set one with `/statusline-estimate`. Hidden when the branch has no
  Jira key or no cached estimate.
- `status` — Claude service status (status.claude.com): a colored heartbeat mark
  + label shown **only during an incident** (hidden when operational), and **only
  when the incident concerns the model in use** (e.g. a Haiku incident is hidden
  while you are on Opus); a clickable link to the status page
- `pr` — the session's pull requests, expanded **inline** at this element's
  position (e.g. put it right after `branch`): one clickable mini-segment per PR
  (status glyph + `#id`, colored by status). Captured MCP-agnostically as PRs are
  created; nothing shown when there are none.
- `gap` — splitter: elements after it are right-aligned to the terminal's right
  edge (e.g. `dir branch gap ctx 5h 7d`)

## If the user passed `$ARGUMENTS`

Elements are already given — run the command directly and report its output:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/set-mode.js" $ARGUMENTS
```

## Otherwise — interactive configuration

1. **Pick the elements** with **AskUserQuestion** (`multiSelect: true`, header
   `Elements`, question "Which elements to show?"): options `ctx`, `5h`, `7d`,
   `model`, `dir`, `branch`, `eta`, `status`, `pr`.

2. **Build the element list** in this fixed display order — `ctx`, `5h`, `7d`,
   `model`, `dir`, `branch`, `eta`, `pr`, `status` — keeping only the selected ones.
   (`pr` expands inline at its position; placing it after `branch` reads well.
   Finer ordering is possible by passing the elements directly as `$ARGUMENTS`.)

3. **Apply** by running, and report the output:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/set-mode.js" <elements>
   ```

Changes take effect on the next status-line refresh — **no restart needed**.
Running with no argument prints the current configuration.
