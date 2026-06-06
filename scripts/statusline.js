#!/usr/bin/env node
// Consumption-bar status line — ADDITIVE wrapper.
//
// Renders ONLY the consumption indicators (context window + rate-limit windows)
// and appends them to whatever status line was already configured. It never
// replaces an existing custom status line: install.js captures the previous
// `statusLine` command into gradient-statusline.config.json, and this wrapper
// runs it (piping the same stdin JSON through) for the prefix, then appends the
// indicators. If no prior status line existed, only the indicators are shown.
//
// Render mode is read from the config file on every refresh, so it can be
// changed at any time (set-mode.js) without restarting Claude Code:
//   full    : 10-cell gradient bars (1 cell / 10%)
//   compact : 5-cell gradient bars  (1 cell / 20%)
//   ultra   : tight "label+%" with the % on a gradient background, no bars
//             e.g. ctx34%→1am62%→Jun1118%
//
// Single short-lived node process. The only extra spawn is the user's own
// previous status-line command (if any) — its cost is theirs, not ours.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const MODES = ['full', 'compact', 'ultra'];

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try { process.stdout.write(render(raw)); }
  catch { process.stdout.write(bars(safeParse(raw), 'full')); }
});

function safeParse(r) { try { return JSON.parse(r); } catch { return {}; } }
function has(v) { return v !== undefined && v !== null && v !== ''; }

function loadConfig() {
  try {
    const p = path.join(os.homedir(), '.claude', 'gradient-statusline.config.json');
    const c = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    return {
      baseCommand: typeof c.baseCommand === 'string' && c.baseCommand.trim() ? c.baseCommand : '',
      mode: MODES.includes(c.mode) ? c.mode : 'full',
    };
  } catch { return { baseCommand: '', mode: 'full' }; }
}

function render(raw) {
  const { baseCommand, mode } = loadConfig();
  let prefix = '';
  if (baseCommand) {
    try {
      prefix = cp
        .execSync(baseCommand, { input: raw, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
        .toString()
        .replace(/\s+$/, '');
    } catch { prefix = ''; }
  }
  const b = bars(safeParse(raw), mode);
  if (prefix && b) return prefix + ' ' + b; // space-join, matches CC layout
  return prefix || b;
}

// Build only the consumption indicators: ctx | →5h | →7d
function bars(d, mode) {
  const usedPct = d.context_window?.used_percentage;
  const fivePct = d.rate_limits?.five_hour?.used_percentage;
  const fiveReset = d.rate_limits?.five_hour?.resets_at;
  const sevenPct = d.rate_limits?.seven_day?.used_percentage;
  const sevenReset = d.rate_limits?.seven_day?.resets_at;

  const items = [];
  if (has(usedPct)) items.push({ label: 'ctx', pct: Math.round(usedPct) });
  if (has(fivePct)) {
    const r = fmtReset(fiveReset, true);
    items.push({ label: r ? '→' + r : '', pct: Math.round(fivePct) });
  }
  if (has(sevenPct)) {
    const r = fmtReset(sevenReset, false);
    items.push({ label: r ? '→' + r : '', pct: Math.round(sevenPct) });
  }

  if (mode === 'ultra') {
    // tight: label glued to a gradient-backed "NN%", no separators
    // (the "→" reset prefixes act as visual delimiters)
    return items.map((it) => `${it.label}${makeBox(it.pct)}`).join('');
  }
  const width = mode === 'compact' ? 5 : 10;
  return items.map((it) => `${it.label}:${makeBar(it.pct, width)}`).join(' | ');
}

// Gradient RGB for fraction 0..1: green -> yellow -> red. Returns "R;G;B".
function gradRgb(f) {
  if (f < 0) f = 0;
  if (f > 1) f = 1;
  const m = 170;
  let r, g;
  if (f < 0.5) { r = Math.trunc(2 * m * f); g = m; }
  else { r = m; g = Math.trunc(m - 2 * m * (f - 0.5)); }
  if (r < 0) r = 0; if (r > m) r = m;
  if (g < 0) g = 0; if (g > m) g = m;
  return `${r};${g};0`;
}

// Gradient bar (green->red), 1 cell per (100/width)%. Empty cells dim gray.
function makeBar(pct, width) {
  let filled = Math.trunc((pct * width) / 100);
  if (filled > width) filled = width;
  const denom = Math.max(width - 1, 1);
  let bar = '';
  for (let i = 0; i < filled; i++) bar += `\x1b[38;2;${gradRgb(i / denom)}m█`;
  for (let i = filled; i < width; i++) bar += `\x1b[38;2;60;60;60m░`;
  return bar + '\x1b[0m';
}

// Tight percentage on a gradient background, white text — e.g. "34%".
function makeBox(pct) {
  const bg = gradRgb(pct / 100);
  return `\x1b[48;2;${bg};38;2;255;255;255m${pct}%\x1b[0m`;
}

// Format a reset timestamp (unix seconds) as "10pm" or "Apr18".
function fmtReset(ts, forceTime) {
  if (!has(ts)) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString() || forceTime;
  if (sameDay) {
    const h = d.getHours();
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return `${h12}${ampm}`;
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]}${d.getDate()}`;
}
