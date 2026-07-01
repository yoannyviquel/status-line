---
description: Cache a ticket's estimated production time for the status-line `eta` element
allowed-tools: Bash(node:*), Bash(git:*), mcp__plugin_atlassian_atlassian__getJiraIssue
argument-hint: "[TICKET] [--points N | --hours H] [--ratio R]"
---

Fill the local estimate cache read by the status line's `eta` element, so it can
show the clock time at which the current ticket's estimated production finishes
(`now + estimate − time already produced`).

Arguments: `$ARGUMENTS`

## Steps

1. **Resolve the ticket key.**
   - If a key like `ABC-123` is in `$ARGUMENTS`, use it.
   - Otherwise read the current branch (`git rev-parse --abbrev-ref HEAD`) and
     extract the Jira key (pattern `[A-Za-z]+-\d+`, uppercased). If none is found,
     stop and ask the user for the ticket key.

2. **Determine the hours.**
   - If `--hours H` is in `$ARGUMENTS`, use it directly.
   - Else if `--points N` is in `$ARGUMENTS`, pass the points through (the script
     converts with the ratio).
   - Else fetch the story points from Jira via
     `mcp__plugin_atlassian_atlassian__getJiraIssue` (field `customfield_10033`,
     the Story Points — same field as the `estimate-task` skill). If the ticket has
     no points, ask the user for points or hours.
   - Ratio: points → hours uses `hoursPerPoint` (default **3 h/pt**, a calibration
     knob). Pass `--ratio R` to change and persist it.

3. **Write the cache** — run and report the output:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/set-estimate.js" <KEY> [--points N] [--hours H] [--ratio R]
   ```

4. **Remind** the user to enable the element if it isn't shown:
   `/statusline-mode … eta`. The change takes effect on the next status-line
   refresh — no restart needed.

To clear an estimate: `node "${CLAUDE_PLUGIN_ROOT}/scripts/set-estimate.js" <KEY> --remove`.
