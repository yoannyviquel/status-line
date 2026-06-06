#!/usr/bin/env node
// Configure the status-line elements at any time.
//
// Usage: node set-mode.js [token ...]
//   token (order = display order, presence = enabled):
//     ctx[:size]   5h[:size]   7d[:size]     (bars; size = compact|medium|large, default large)
//     dir          branch                    (powerline segments)
//   no arg            -> print the current config + help
//   legacy single arg -> full|medium|compact applies to ctx/5h/7d (back-compat)
//
// Writes `elements` into ~/.claude/gradient-statusline.config.json (preserving
// baseCommand). The status line reads this file on every refresh, so the change
// takes effect on the next render — no Claude Code restart needed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIZES = ['compact', 'medium', 'large'];
const BAR_TYPES = ['ctx', '5h', '7d'];
const TEXT_TYPES = ['dir', 'branch'];
const LEGACY = { full: 'large', large: 'large', medium: 'medium', compact: 'compact' };

const configPath = path.join(os.homedir(), '.claude', 'gradient-statusline.config.json');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}; }
  catch { return {}; }
}

function describe(elements) {
  return elements
    .map((e) => (BAR_TYPES.includes(e.type) ? `${e.type}:${e.size}` : e.type))
    .join('  ');
}

function printCurrent(cfg) {
  const els = Array.isArray(cfg.elements) ? cfg.elements : null;
  console.log('Current elements: ' + (els && els.length ? describe(els) : '(legacy/default — ctx, 5h, 7d)'));
  console.log('');
  console.log('Set with: set-mode.js <token ...>   (order = display order)');
  console.log('  bars  : ctx[:size]  5h[:size]  7d[:size]   size = ' + SIZES.join(' | ') + ' (default large)');
  console.log('  text  : dir  branch');
  console.log('  e.g.  : ctx:large 5h:medium 7d:compact dir branch');
}

const args = process.argv.slice(2).filter((a) => a.trim());
const cfg = loadConfig();

if (!args.length || args[0] === 'status') {
  printCurrent(cfg);
  process.exit(0);
}

// Back-compat: a single legacy mode word applies to the three bars.
let elements;
if (args.length === 1 && LEGACY[args[0].toLowerCase()] && !args[0].includes(':')) {
  const size = LEGACY[args[0].toLowerCase()];
  elements = [
    { type: 'ctx', size },
    { type: '5h', size },
    { type: '7d', size },
  ];
} else {
  elements = [];
  const seen = new Set();
  for (const tok of args) {
    const [typeRaw, sizeRaw] = tok.split(':');
    const type = typeRaw.toLowerCase();
    if (seen.has(type)) fail(`duplicate element "${type}"`);
    if (BAR_TYPES.includes(type)) {
      const size = (sizeRaw || 'large').toLowerCase();
      if (!SIZES.includes(size)) fail(`unknown size "${sizeRaw}" for "${type}". Choose: ${SIZES.join(', ')}`);
      elements.push({ type, size });
    } else if (TEXT_TYPES.includes(type)) {
      if (sizeRaw) fail(`"${type}" takes no size`);
      elements.push({ type });
    } else {
      fail(`unknown element "${typeRaw}". Choose: ${[...BAR_TYPES, ...TEXT_TYPES].join(', ')}`);
    }
    seen.add(type);
  }
  if (!elements.length) fail('no valid elements given');
}

const out = { baseCommand: typeof cfg.baseCommand === 'string' ? cfg.baseCommand : '', elements };
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log('✓ Status-line elements set: ' + describe(elements));
console.log('  Takes effect on the next status-line refresh (no restart needed).');
