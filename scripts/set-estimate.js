#!/usr/bin/env node
// Set the estimated production for a ticket, read by the `eta` status-line element.
//
// Usage: node set-estimate.js <KEY> [--points N] [--hours H] [--ratio R]
//   <KEY>       Jira-style ticket key (e.g. RUNITMCM-46297). Case-insensitive → stored upper.
//   --hours H   Estimated production hours (wins over points).
//   --points N  Story points; hours = N * ratio when --hours is absent.
//   --ratio R   Hours-per-point ratio to use AND persist as the default (default 3).
//   --remove    Delete the ticket's estimate.
//
// Merges into ~/.claude/statusline-estimates.json:
//   { "<KEY>": { "points": N, "hours": H, "ts": "<ISO>" }, "hoursPerPoint": R }
// The status line reads this file on every refresh — takes effect on the next render.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_HOURS_PER_POINT = 3;
const filePath = path.join(os.homedir(), '.claude', 'statusline-estimates.json');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

function load() {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {}; }
  catch { return {}; }
}

// Parse "<KEY> --points 5 --hours 12 --ratio 3 [--remove]".
const args = process.argv.slice(2);
const opts = { key: '', points: null, hours: null, ratio: null, remove: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--remove') opts.remove = true;
  else if (a === '--points') opts.points = Number(args[++i]);
  else if (a === '--hours') opts.hours = Number(args[++i]);
  else if (a === '--ratio') opts.ratio = Number(args[++i]);
  else if (!opts.key && !a.startsWith('--')) opts.key = a;
  else fail(`unexpected argument "${a}"`);
}

if (!opts.key) fail('missing ticket key. Usage: set-estimate.js <KEY> [--points N] [--hours H] [--ratio R]');
const key = opts.key.toUpperCase();
const cfg = load();

if (opts.remove) {
  delete cfg[key];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`✓ Removed estimate for ${key}.`);
  process.exit(0);
}

if (Number(opts.ratio) > 0) cfg.hoursPerPoint = Number(opts.ratio);
const ratio = Number(cfg.hoursPerPoint) > 0 ? Number(cfg.hoursPerPoint) : DEFAULT_HOURS_PER_POINT;

let hours = Number(opts.hours) > 0 ? Number(opts.hours) : null;
const points = Number(opts.points) > 0 ? Number(opts.points) : null;
if (hours === null && points !== null) hours = points * ratio;
if (!(Number(hours) > 0)) fail('need --hours H or --points N (with a positive ratio).');

cfg[key] = { points: points ?? undefined, hours, ts: new Date().toISOString() };
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

console.log(
  `✓ ${key}: ${points !== null ? points + ' pts → ' : ''}${hours}h estimated` +
    ` (ratio ${ratio} h/pt).`,
);
console.log('  Shown by the `eta` element; enable it with /statusline-mode … eta if needed.');
