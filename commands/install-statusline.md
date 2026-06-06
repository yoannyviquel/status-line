---
description: Install the status line (all elements enabled by default)
allowed-tools: Bash(node:*)
---

Install the status line: copy the script into `~/.claude/` and wire `statusLine`
in the user `settings.json` (an existing config is backed up to
`settings.json.bak` first).

The installer is **additive**: it renders only the indicators and, if a status
line was already configured, runs it for the prefix and appends the indicators —
it never discards the user's existing line.

Steps:

1. **Run the installer** (report its output to the user):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js"
   ```

   On a fresh install it enables all five elements — `ctx`, `5h`, `7d` (gauge
   segments colored by usage), plus `dir` and `branch`. A previous element
   configuration is preserved across re-installs.

2. After it succeeds, tell the user to **restart Claude Code** (or open a new
   session) for the status line to take effect. If `settings.json` was already
   pointing at a different status line, mention it was preserved as the prefix.

Notes to relay:

- Customise which elements show, and their order, anytime with
  **`/statusline-mode`**.
- The `dir` / `branch` segments use **Nerd Font** powerline glyphs (folder /
  branch icons + chevrons) and a **truecolor** terminal — without a Nerd Font
  those glyphs show as tofu boxes.
