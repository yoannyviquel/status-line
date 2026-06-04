#!/usr/bin/env node
// Installs the gradient status line into the user's ~/.claude/settings.json.
// - Copies statusline.sh to ~/.claude/gradient-statusline.sh (stable path,
//   survives plugin update/uninstall).
// - Sets settings.json "statusLine" to run it, backing up any existing config.
const fs = require('fs');
const os = require('os');
const path = require('path');

const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const srcScript = path.join(__dirname, 'statusline.sh');
const destScript = path.join(claudeDir, 'gradient-statusline.sh');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

if (!fs.existsSync(srcScript)) fail('source script not found: ' + srcScript);
fs.mkdirSync(claudeDir, { recursive: true });

// Copy the script (LF line endings; bash on Windows chokes on CRLF)
const body = fs.readFileSync(srcScript, 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(destScript, body, 'utf8');

// Load existing settings (tolerate missing/empty)
let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (raw) {
    try { settings = JSON.parse(raw); }
    catch (e) { fail('invalid settings.json (JSON): ' + e.message); }
  }
  // Backup before touching
  fs.copyFileSync(settingsPath, settingsPath + '.bak');
}

const prev = settings.statusLine;
const newCmd = `bash "${destScript.replace(/\\/g, '\\\\')}"`;
settings.statusLine = { type: 'command', command: newCmd };

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

console.log('✓ Status line installed.');
console.log('  script : ' + destScript);
console.log('  config : ' + settingsPath + (fs.existsSync(settingsPath + '.bak') ? ' (.bak backup created)' : ''));
if (prev) console.log('  previous statusLine replaced: ' + JSON.stringify(prev.command || prev));
console.log('\nRestart Claude Code (or open a new session) to see the bar.');
