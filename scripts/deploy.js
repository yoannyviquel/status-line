#!/usr/bin/env node
// SessionStart hook — keep an existing install in sync with the plugin.
//
// install.js snapshots scripts/statusline.js into ~/.claude/gradient-statusline.js
// and points settings.json at that copy. A plugin update changes the source but
// not the deployed copy, so users would otherwise have to re-run /install-statusline
// after every update. This hook re-copies the script on session start.
//
// Deliberately minimal and defensive:
//   - only syncs when an install already exists (deployed file present); it never
//     creates one — /install-statusline is still what wires up settings + config.
//   - only writes when the content actually differs (no needless churn).
//   - never throws / never prints to stdout (a SessionStart hook's stdout is parsed
//     as JSON; we add no context), so it can never break session startup.
const fs = require('fs');
const os = require('os');
const path = require('path');

try {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (!root) process.exit(0);
  const src = path.join(root, 'scripts', 'statusline.js');
  const dest = path.join(os.homedir(), '.claude', 'gradient-statusline.js');
  if (!fs.existsSync(dest)) process.exit(0); // not installed yet — leave it to /install-statusline
  const fresh = fs.readFileSync(src, 'utf8');
  let current = '';
  try { current = fs.readFileSync(dest, 'utf8'); } catch { /* unreadable -> overwrite */ }
  if (fresh !== current) fs.writeFileSync(dest, fresh, 'utf8');
} catch { /* never let the sync break session start */ }
process.exit(0);
