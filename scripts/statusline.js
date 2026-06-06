#!/usr/bin/env node
// Status line — ADDITIVE wrapper.
//
// Renders configurable indicators and appends them to whatever status line was
// already configured. It never replaces an existing custom status line:
// install.js captures the previous `statusLine` command into
// gradient-statusline.config.json, and this wrapper runs it (piping the same
// stdin JSON through) for the prefix, then appends the indicators. If no prior
// status line existed, only the indicators are shown.
//
// Elements (ordered list, read from the config on every refresh — change them
// anytime with set-mode.js / /statusline-mode, no restart):
//   ctx / 5h / 7d : gradient bars, each sized independently
//                     large   = 10-cell bar (1 cell / 10%)
//                     medium  = 5-cell bar  (1 cell / 20%)
//                     compact = label + "NN%" on a gradient background, no bar
//   dir           : current directory basename, powerline segment
//   branch        : current git branch (if any), powerline segment
//                   dir + branch nest into a single powerline run.
//
// Single short-lived node process. Git branch is read from .git/HEAD directly
// (no `git` spawn). The only extra spawn is the user's own previous status-line
// command (if any) — its cost is theirs, not ours.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SIZES = ['compact', 'medium', 'large'];
const BAR_TYPES = ['ctx', '5h', '7d'];
const ALL_TYPES = ['ctx', '5h', '7d', 'dir', 'branch'];

// --- Powerline look (Nerd Font). Tweak freely. -----------------------------
const GLYPH = {
  folder: '',     //  dir segment icon
  branch: '',     //  git branch icon
  leftCap: '',    //  rounded left cap (run opening)
  sep: '',        //  filled chevron between segments
  rightCap: '',   //  rounded right cap (run closing)
};
// Light / "white" theme: pale backgrounds, dark text.
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
  return [
    { type: 'ctx', size: 'large' },
    { type: '5h', size: 'large' },
    { type: '7d', size: 'large' },
    { type: 'dir' },
    { type: 'branch' },
  ];
}

// Normalise an arbitrary value into a clean elements array (or null if none).
function normElements(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const e of arr) {
    if (!e || !ALL_TYPES.includes(e.type)) continue;
    if (BAR_TYPES.includes(e.type)) {
      const size = SIZES.includes(e.size) ? e.size : 'large';
      out.push({ type: e.type, size });
    } else {
      out.push({ type: e.type });
    }
  }
  return out.length ? out : null;
}

function loadConfig() {
  try {
    const p = path.join(os.homedir(), '.claude', 'gradient-statusline.config.json');
    const c = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    const baseCommand = typeof c.baseCommand === 'string' && c.baseCommand.trim() ? c.baseCommand : '';
    let elements = normElements(c.elements);
    if (!elements) {
      // Backward-compat: synthesise from the legacy single `mode` field.
      const legacy = { full: 'large', large: 'large', medium: 'medium', compact: 'compact' };
      const size = legacy[c.mode] || 'large';
      elements = [
        { type: 'ctx', size },
        { type: '5h', size },
        { type: '7d', size },
      ];
    }
    return { baseCommand, elements };
  } catch { return { baseCommand: '', elements: defaultElements() }; }
}

function render(raw) {
  const { baseCommand, elements } = loadConfig();
  let prefix = '';
  if (baseCommand) {
    try {
      prefix = cp
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
// Build the indicator string from the ordered elements list. Bars join with
// " | "; consecutive dir/branch elements merge into one powerline run.
function indicators(d, elements) {
  const pieces = []; // { kind: 'bar' | 'pl', str }
  let plRun = null;  // accumulating powerline segments

  const flushPl = () => {
    if (plRun && plRun.length) pieces.push({ kind: 'pl', str: powerline(plRun) });
    plRun = null;
  };

  for (const el of elements) {
    if (el.type === 'dir' || el.type === 'branch') {
      const seg = el.type === 'dir' ? dirSegment(d) : branchSegment(d);
      if (seg) { (plRun = plRun || []).push(seg); }
      continue;
    }
    // bar element
    flushPl();
    const s = barPiece(d, el);
    if (s) pieces.push({ kind: 'bar', str: s });
  }
  flushPl();

  // Join: " | " between two adjacent bars, single space otherwise.
  let out = '';
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) out += (pieces[i - 1].kind === 'bar' && pieces[i].kind === 'bar') ? ' | ' : ' ';
    out += pieces[i].str;
  }
  return out;
}

function barPiece(d, el) {
  let pct, label;
  if (el.type === 'ctx') {
    pct = d.context_window?.used_percentage;
    label = 'ctx';
  } else if (el.type === '5h') {
    pct = d.rate_limits?.five_hour?.used_percentage;
    const r = fmtReset(d.rate_limits?.five_hour?.resets_at, true);
    label = r ? '→' + r : '';
  } else if (el.type === '7d') {
    pct = d.rate_limits?.seven_day?.used_percentage;
    const r = fmtReset(d.rate_limits?.seven_day?.resets_at, false);
    label = r ? '→' + r : '';
  }
  if (!has(pct)) return '';
  const p = Math.round(pct);
  if (el.size === 'compact') return `${label}${makeBox(p)}`;
  const width = el.size === 'medium' ? 5 : 10;
  return `${label}:${makeBar(p, width)}`;
}

// --- powerline segments ----------------------------------------------------
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

const fg = (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const DEFBG = '\x1b[49m';
const RESET = '\x1b[0m';

// Render a run of {bg,fg,text} segments as a powerline block (caps + chevrons).
function powerline(segs) {
  let out = DEFBG + fg(segs[0].bg) + GLYPH.leftCap; // rounded left cap
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    out += bg(s.bg) + fg(s.fg) + ' ' + s.text + ' ';
    if (i < segs.length - 1) {
      // chevron of the current bg, sitting on the next segment's bg
      out += bg(segs[i + 1].bg) + fg(s.bg) + GLYPH.sep;
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

// --- gradient bars ---------------------------------------------------------
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
  const bgc = gradRgb(pct / 100);
  return `\x1b[48;2;${bgc};38;2;255;255;255m${pct}%\x1b[0m`;
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
