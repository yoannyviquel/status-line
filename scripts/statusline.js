#!/usr/bin/env node
// Status line — ADDITIVE wrapper.
//
// Renders a single unified powerline strip of configurable segments and appends
// it to whatever status line was already configured. It never replaces an
// existing custom status line: install.js captures the previous `statusLine`
// command into gradient-statusline.config.json, and this wrapper runs it
// (piping the same stdin JSON through) for the prefix, then appends the strip.
//
// Elements (ordered list, read from the config on every refresh — change them
// anytime with set-mode.js / /statusline-mode, no restart):
//   ctx / 5h / 7d : gauge segments — background colored green->red by the usage
//                   %, text = "<label> NN%". The 5h/7d labels show the dynamic
//                   reset given by Claude Code (e.g. "→1am", "→Jun5").
//   dir           : current directory basename.
//   branch        : current git branch (if any).
// Every active element is a powerline segment: rounded cap on the very first,
// filled chevrons between, rounded cap on the very last.
//
// Single short-lived node process. Git branch is read from .git/HEAD directly
// (no `git` spawn). The only extra spawn is the user's own previous status-line
// command (if any) — its cost is theirs, not ours.

const fs = require('fs');
const os = require('os');
const path = require('path');
const proc = require('child_process');

const ALL_TYPES = ['ctx', '5h', '7d', 'dir', 'branch'];

// --- Powerline look (Nerd Font). Tweak freely. -----------------------------
// Glyphs built from code points so the source stays pure-ASCII (some editors
// strip raw Private-Use-Area characters on save).
const cp = (n) => String.fromCodePoint(n);
const GLYPH = {
  folder: cp(0xf07b),    // nf-fa-folder      dir segment icon
  branch: cp(0xe0a0),    // nf-pl-branch      git branch icon
  leftCap: cp(0xe0b6),   // nf-pl-left_soft   rounded left cap (strip opening)
  sep: cp(0xe0b0),       // nf-pl-right_hard  filled chevron (different-color segments)
  sepThin: cp(0xe0b1),   // nf-pl-right_soft  thin chevron (same-color segments)
  rightCap: cp(0xe0b4),  // nf-pl-right_soft  rounded right cap (strip closing)
};
const ARROW = '→'; // "→" reset prefix
// Fallback labels (used when no reset timestamp is provided).
const LABELS = { ctx: 'ctx', fiveHour: ARROW + '5h', sevenDay: ARROW + '7j' };
// Gauge text color (on the completion-colored background).
const GAUGE_FG = [255, 255, 255];
// Dark chevron between two gauge segments (their backgrounds are similar greens,
// so a segment-colored chevron would be invisible — this separates them).
const DARK_SEP = [30, 30, 30];
// dir / branch: light backgrounds, dark text.
const SEG = {
  dir: { bg: [220, 220, 220], fg: [40, 40, 40] },
  branch: { bg: [180, 180, 180], fg: [40, 40, 40] },
};

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try { process.stdout.write(render(raw)); }
  catch { process.stdout.write(indicators(safeParse(raw), defaultElements())); }
});

function safeParse(r) { try { return JSON.parse(r); } catch { return {}; } }
function has(v) { return v !== undefined && v !== null && v !== ''; }

function defaultElements() {
  return ALL_TYPES.map((type) => ({ type }));
}

// Normalise an arbitrary value into a clean elements array (or null if none).
function normElements(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const e of arr) {
    const type = e && e.type;
    if (!ALL_TYPES.includes(type) || seen.has(type)) continue;
    seen.add(type);
    out.push({ type });
  }
  return out.length ? out : null;
}

function loadConfig() {
  try {
    const p = path.join(os.homedir(), '.claude', 'gradient-statusline.config.json');
    const c = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    const baseCommand = typeof c.baseCommand === 'string' && c.baseCommand.trim() ? c.baseCommand : '';
    // Back-compat: a legacy config (only `mode`, or no elements) maps to the gauges.
    const elements = normElements(c.elements) || [{ type: 'ctx' }, { type: '5h' }, { type: '7d' }];
    return { baseCommand, elements };
  } catch { return { baseCommand: '', elements: defaultElements() }; }
}

function render(raw) {
  const { baseCommand, elements } = loadConfig();
  let prefix = '';
  if (baseCommand) {
    try {
      prefix = proc
        .execSync(baseCommand, { input: raw, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
        .toString()
        .replace(/\s+$/, '');
    } catch { prefix = ''; }
  }
  const ind = indicators(safeParse(raw), elements);
  if (prefix && ind) return prefix + ' ' + ind; // space-join, matches CC layout
  return prefix || ind;
}

// ---------------------------------------------------------------------------
// Build the unified powerline strip from the ordered elements list. Each
// present element is one segment; absent data (no quota, no git) drops it.
function indicators(d, elements) {
  const segs = [];
  for (const el of elements) {
    const s = segmentFor(el.type, d);
    if (s) segs.push(s);
  }
  return segs.length ? powerline(segs) : '';
}

function segmentFor(type, d) {
  if (type === 'ctx') return gauge(LABELS.ctx, d.context_window?.used_percentage);
  if (type === '5h') {
    const w = d.rate_limits?.five_hour;
    const r = fmtReset(w?.resets_at, true);
    return gauge(r ? ARROW + r : LABELS.fiveHour, w?.used_percentage);
  }
  if (type === '7d') {
    const w = d.rate_limits?.seven_day;
    const r = fmtReset(w?.resets_at, false);
    return gauge(r ? ARROW + r : LABELS.sevenDay, w?.used_percentage);
  }
  if (type === 'dir') return dirSegment(d);
  if (type === 'branch') return branchSegment(d);
  return null;
}

// A gauge segment: background colored by the usage %, text "<label> NN%".
function gauge(label, pct) {
  if (!has(pct)) return null;
  const p = Math.round(pct);
  return { kind: 'gauge', bg: grad(p / 100), fg: GAUGE_FG, text: `${label} ${p}%` };
}

function dirSegment(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  if (!has(cwd)) return null;
  const name = path.basename(String(cwd).replace(/[\\/]+$/, '')) || String(cwd);
  return { ...SEG.dir, text: `${GLYPH.folder} ${name}` };
}

function branchSegment(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  const br = gitBranch(cwd);
  if (!br) return null;
  return { ...SEG.branch, text: `${GLYPH.branch} ${br}` };
}

// --- ANSI / powerline rendering --------------------------------------------
const fg = (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const DEFBG = '\x1b[49m';
const RESET = '\x1b[0m';

// Render a list of {bg,fg,text} segments as a powerline strip:
// rounded left cap, segments with filled chevrons between, rounded right cap.
function powerline(segs) {
  let out = DEFBG + fg(segs[0].bg) + GLYPH.leftCap;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    out += bg(s.bg) + fg(s.fg) + ' ' + s.text + ' ';
    if (i < segs.length - 1) {
      const next = segs[i + 1];
      if (s.kind === 'gauge' && next.kind === 'gauge') {
        // Same-color greens: a thin dark chevron divides them cleanly.
        out += bg(next.bg) + fg(DARK_SEP) + GLYPH.sepThin;
      } else {
        // Different backgrounds: the usual filled chevron of the current bg.
        out += bg(next.bg) + fg(s.bg) + GLYPH.sep;
      }
    }
  }
  out += DEFBG + fg(segs[segs.length - 1].bg) + GLYPH.rightCap + RESET;
  return out;
}

// --- git branch (no spawn) -------------------------------------------------
// Walk up from `start` to find a .git dir/file; parse HEAD. Returns branch
// name, short sha (detached), or '' if not a repo.
function gitBranch(start) {
  try {
    let dir = path.resolve(String(start));
    let prev = '';
    while (dir && dir !== prev) {
      const dotgit = path.join(dir, '.git');
      let gitDir = '';
      try {
        const st = fs.statSync(dotgit);
        if (st.isDirectory()) gitDir = dotgit;
        else if (st.isFile()) {
          const m = /gitdir:\s*(.+)\s*/.exec(fs.readFileSync(dotgit, 'utf8'));
          if (m) gitDir = path.resolve(dir, m[1].trim());
        }
      } catch { /* no .git here */ }
      if (gitDir) {
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        if (ref) return ref[1];
        return head.slice(0, 7); // detached HEAD
      }
      prev = dir;
      dir = path.dirname(dir);
    }
  } catch { /* ignore */ }
  return '';
}

// --- reset timestamp -------------------------------------------------------
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
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]}${d.getDate()}`;
}

// --- completion color ------------------------------------------------------
// Gradient for fraction 0..1: green -> yellow -> red. Returns [r,g,b].
function grad(f) {
  if (f < 0) f = 0;
  if (f > 1) f = 1;
  const m = 170;
  let r, g;
  if (f < 0.5) { r = Math.trunc(2 * m * f); g = m; }
  else { r = m; g = Math.trunc(m - 2 * m * (f - 0.5)); }
  if (r < 0) r = 0; if (r > m) r = m;
  if (g < 0) g = 0; if (g > m) g = m;
  return [r, g, 0];
}
