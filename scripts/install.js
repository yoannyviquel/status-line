#!/usr/bin/env node
// Installs the status line into the user's ~/.claude/settings.json.
//
// ADDITIVE: this never discards an existing custom status line. If one is
// already configured (and it isn't ours), its command is captured into
// gradient-statusline.config.json; the deployed wrapper then runs it for the
// prefix and appends the indicators. If nothing was configured, only the
// indicators are shown.
const fs = require('fs');
const os = require('os');
const path = require('path');

const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const configPath = path.join(claudeDir, 'gradient-statusline.config.json');
const srcScript = path.join(__dirname, 'statusline.js');
const destScript = path.join(claudeDir, 'gradient-statusline.js');

const ALL_TYPES = ['ctx', '5h', '7d', 'dir', 'branch', 'gap'];
// Default elements when none were configured before: everything.
const DEFAULT_ELEMENTS = ALL_TYPES.map((type) => ({ type }));

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

// Is a given statusLine command one we installed (current .js or legacy .sh)?
function isOurs(cmd) {
  return typeof cmd === 'string' && /gradient-statusline\.(js|sh)/.test(cmd);
}

// Keep a previously-configured elements list if it is valid (preserve the
// user's customisation across re-installs).
function validElements(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const e of arr) {
    if (!e || !ALL_TYPES.includes(e.type) || seen.has(e.type)) continue;
    seen.add(e.type);
    out.push({ type: e.type });
  }
  return out.length ? out : null;
}

function describe(elements) {
  return elements.map((e) => e.type).join('  ');
}

if (!fs.existsSync(srcScript)) fail('source script not found: ' + srcScript);
fs.mkdirSync(claudeDir, { recursive: true });

// Copy the wrapper verbatim (pure node — no shell, no per-refresh spawns).
fs.writeFileSync(destScript, fs.readFileSync(srcScript, 'utf8'), 'utf8');

// Load existing settings (tolerate missing/empty).
let settings = {};
if (fs.existsSync(settingsPath)) {
  const rawSettings = fs.readFileSync(settingsPath, 'utf8').trim();
  if (rawSettings) {
    try { settings = JSON.parse(rawSettings); }
    catch (e) { fail('invalid settings.json (JSON): ' + e.message); }
  }
  fs.copyFileSync(settingsPath, settingsPath + '.bak'); // backup before touching
}

// Determine the base command to preserve.
const prev = settings.statusLine;
const prevCmd = prev && typeof prev === 'object' ? prev.command : (typeof prev === 'string' ? prev : '');

// Read any existing config to preserve fields across re-installs.
let prevConfig = {};
try { prevConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}; } catch { /* none */ }

let baseCommand = '';
if (isOurs(prevCmd)) {
  // Re-install over ourselves: keep whatever base we captured previously.
  if (typeof prevConfig.baseCommand === 'string') baseCommand = prevConfig.baseCommand;
} else if (prevCmd) {
  // A real, foreign status line — preserve it as the prefix.
  baseCommand = prevCmd;
}

// Elements: keep a valid prior list (preserves customisation), else default.
const elements = validElements(prevConfig.elements) || DEFAULT_ELEMENTS;

fs.writeFileSync(configPath, JSON.stringify({ baseCommand, elements }, null, 2) + '\n', 'utf8');

settings.statusLine = { type: 'command', command: `node "${destScript.replace(/\\/g, '\\\\')}"` };
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

console.log('✓ Status line installed.');
console.log('  script  : ' + destScript);
console.log('  config  : ' + configPath);
console.log('  elements: ' + describe(elements));
console.log('  settings: ' + settingsPath + (fs.existsSync(settingsPath + '.bak') ? ' (.bak backup created)' : ''));
if (baseCommand) console.log('  base status line preserved: ' + JSON.stringify(baseCommand));
else console.log('  no prior status line — showing indicators only.');
console.log('\nCustomise which elements show (and their order) anytime with /statusline-mode.');
console.log('Restart Claude Code (or open a new session) to see it.');
