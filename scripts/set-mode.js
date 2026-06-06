#!/usr/bin/env node
// Configure the status-line elements at any time.
//
// Usage: node set-mode.js [element ...]
//   element (order = display order, presence = enabled):
//     ctx   5h   7d   dir   branch
//   no arg -> print the current config + help
//
// Writes `elements` into ~/.claude/gradient-statusline.config.json (preserving
// baseCommand). The status line reads this file on every refresh, so the change
// takes effect on the next render — no Claude Code restart needed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL_TYPES = ['ctx', '5h', '7d', 'dir', 'branch', 'gap'];
// Legacy size suffixes / mode words are accepted and ignored (the look is fixed).
const LEGACY_MODES = ['full', 'medium', 'compact', 'large'];

const configPath = path.join(os.homedir(), '.claude', 'gradient-statusline.config.json');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}; }
  catch { return {}; }
}

function printCurrent(cfg) {
  const els = Array.isArray(cfg.elements) ? cfg.elements.map((e) => e && e.type).filter((t) => ALL_TYPES.includes(t)) : null;
  console.log('Current elements: ' + (els && els.length ? els.join('  ') : '(legacy/default — ctx, 5h, 7d)'));
  console.log('');
  console.log('Set with: set-mode.js <element ...>   (order = display order)');
  console.log('  elements: ' + ALL_TYPES.join('  '));
  console.log('  e.g.    : ctx 5h 7d dir branch');
}

const args = process.argv.slice(2).filter((a) => a.trim());
const cfg = loadConfig();

if (!args.length || args[0] === 'status') {
  printCurrent(cfg);
  process.exit(0);
}

// A single legacy mode word (full/medium/compact/large) just enables the three
// gauges — keeps old `/statusline-mode full` invocations working.
if (args.length === 1 && LEGACY_MODES.includes(args[0].toLowerCase())) {
  args.length = 0;
  args.push('ctx', '5h', '7d');
}

const elements = [];
const seen = new Set();
for (const tok of args) {
  // tolerate a stray ":size" suffix from old habits
  const type = tok.split(':')[0].toLowerCase();
  if (!ALL_TYPES.includes(type)) fail(`unknown element "${tok}". Choose: ${ALL_TYPES.join(', ')}`);
  if (seen.has(type)) fail(`duplicate element "${type}"`);
  seen.add(type);
  elements.push({ type });
}
if (!elements.length) fail('no valid elements given');

const out = { baseCommand: typeof cfg.baseCommand === 'string' ? cfg.baseCommand : '', elements };
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log('✓ Status-line elements set: ' + elements.map((e) => e.type).join('  '));
console.log('  Takes effect on the next status-line refresh (no restart needed).');
