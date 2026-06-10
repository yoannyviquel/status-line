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
//   model         : current model display name, on a Claude-orange background.
//   dir           : current directory (git repo name if inside a repo).
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

const ALL_TYPES = ['ctx', '5h', '7d', 'model', 'dir', 'branch', 'status', 'gap'];

// --- Claude service status (status.claude.com) -----------------------------
// `status` is a colored dot that only appears when something is wrong. It is
// driven by a tiny on-disk cache so the render path never touches the network:
// rendering reads the cache (sync); refreshing it is a detached self-spawn
// (`--refresh-status`) that fetches the statuspage JSON and rewrites the cache.
const STATUS_URL = 'https://status.claude.com/';
const STATUS_API = 'https://status.claude.com/api/v2/status.json';
const STATUS_CACHE = () => path.join(os.homedir(), '.claude', 'claude-status.cache.json');
const STATUS_LOCK = () => path.join(os.homedir(), '.claude', 'claude-status.fetching');
const STATUS_SOFT_TTL = 120 * 1000; // refresh the cache at most this often
const STATUS_HARD_TTL = 10 * 60 * 1000; // beyond this the cache is considered unknown
// Columns Claude Code reserves around the status line (~2 left indent + ~2 right);
// deduct so the right strip lands just inside the edge.
const EDGE_RESERVE = 4;

// --- Powerline look (Nerd Font). Tweak freely. -----------------------------
// Glyphs built from code points so the source stays pure-ASCII (some editors
// strip raw Private-Use-Area characters on save).
const cp = (n) => String.fromCodePoint(n);
const GLYPH = {
  folder: cp(0xf07b),    // nf-fa-folder      dir segment icon
  branch: cp(0xe0a0),    // nf-pl-branch      git branch icon
  leftCap: cp(0xe0b6),   // nf-pl-left_soft   rounded left cap (strip opening)
  sep: cp(0xe0b0),       // nf-pl-right_hard  filled chevron between segments
  rightCap: cp(0xe0b4),  // nf-pl-right_soft  filled rounded right cap
  rightThin: cp(0xe0b5), // nf-pl-right_soft_thin  outline rounded right cap
  ctx: cp(0xf1c0),       // nf-fa-database      context gauge icon
  quota: cp(0xf0e4),     // nf-fa-tachometer    quota gauge icon
  model: cp(0xf2db),     // nf-fa-microchip     model segment icon
};
const ARROW = '→'; // "→" reset prefix
// Fallback labels (used when no reset timestamp is provided).
const LABELS = { ctx: 'ctx', fiveHour: ARROW + '5h', sevenDay: ARROW + '7j' };
// Gauge text color (on the completion-colored background).
const GAUGE_FG = [255, 255, 255];
// Dark band inserted between every segment for a clean, homogeneous separator.
const DARK_SEP = [12, 12, 12];
// dir / branch: light backgrounds, dark text.
const SEG = {
  dir: { bg: [220, 220, 220], fg: [40, 40, 40] },
  branch: { bg: [180, 180, 180], fg: [40, 40, 40] },
  // model: Claude clay/orange background, white text.
  model: { bg: [217, 119, 87], fg: [255, 255, 255] },
};

// Background-refresh entry point: do the network work, never read stdin.
if (process.argv.includes('--refresh-status')) {
  refreshStatusCache();
} else {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    try { process.stdout.write(render(raw)); }
    catch { process.stdout.write(indicators(safeParse(raw), defaultElements())); }
    try { maybeRefreshStatus(); } catch { /* never let the refresh trigger break rendering */ }
  });
}

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
  const gi = elements.findIndex((e) => e.type === 'gap');
  if (gi === -1) {
    const segs = buildSegs(elements, d);
    return segs.length ? powerline(segs) : '';
  }
  // `gap`: render a left strip and a right strip, pad between to push the right
  // strip to the terminal's right edge (COLUMNS is set by Claude Code).
  const lSegs = buildSegs(elements.slice(0, gi), d);
  const rSegs = buildSegs(elements.slice(gi + 1), d);
  const left = lSegs.length ? powerline(lSegs) : '';
  const right = rSegs.length ? powerline(rSegs) : '';
  if (!right) return left;
  const cols = parseInt(process.env.COLUMNS || '', 10);
  const pad = cols ? cols - visW(left) - visW(right) - EDGE_RESERVE : 0;
  if (pad < 1) return left ? left + '  ' + right : right;
  return left + ' '.repeat(pad) + right;
}

function buildSegs(elements, d) {
  const segs = [];
  for (const el of elements) {
    const s = segmentFor(el.type, d);
    if (s) segs.push(s);
  }
  return segs;
}

// Visible width: drop ANSI SGR codes and OSC 8 hyperlink wrappers, then count
// remaining code points (each glyph = 1 cell). OSC 8: ESC ] 8 ; ; URL ST ... ESC ] 8 ; ; ST,
// where ST is BEL (\x07) or ESC \. The URL is invisible, so it must not count.
function visW(s) {
  return Array.from(stripAnsi(s)).length;
}

// Strip SGR color codes and OSC 8 hyperlink sequences (keeps the visible text).
function stripAnsi(s) {
  return s
    .replace(/\x1b\]8;[^;]*;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '');
}

function segmentFor(type, d) {
  if (type === 'ctx') return gauge(GLYPH.ctx, '', d.context_window?.used_percentage);
  if (type === '5h') {
    const w = d.rate_limits?.five_hour;
    const r = fmtReset(w?.resets_at, true);
    return gauge(GLYPH.quota, r ? ARROW + r : LABELS.fiveHour, w?.used_percentage);
  }
  if (type === '7d') {
    const w = d.rate_limits?.seven_day;
    const r = fmtReset(w?.resets_at, false);
    return gauge(GLYPH.quota, r ? ARROW + r : LABELS.sevenDay, w?.used_percentage);
  }
  if (type === 'model') return modelSegment(d);
  if (type === 'dir') return dirSegment(d);
  if (type === 'branch') return branchSegment(d);
  if (type === 'status') return statusSegment();
  return null;
}

// A gauge segment: glyph, then "NN%" (and an optional label), on a bg colored by the %.
function gauge(glyph, label, pct) {
  if (!has(pct)) return null;
  const p = Math.round(pct);
  const body = label ? `${p}% ${label}` : `${p}%`;
  return { kind: 'gauge', bg: grad(p / 100), fg: GAUGE_FG, text: `${glyph} ${body}` };
}

function modelSegment(d) {
  let name = d.model?.display_name || d.model?.id;
  if (!has(name)) return null;
  // Drop a trailing context-size note then the version, e.g.
  // "Opus 4.8 (1M context)" -> "Opus 4.8" -> "Opus".
  name = String(name)
    .replace(/\s*\([^)]*context[^)]*\)\s*$/i, '')
    .replace(/\s+v?\d[\d.]*\s*$/, '')
    .trim();
  return { ...SEG.model, group: 'loc', text: `${GLYPH.model} ${name}` };
}

function dirSegment(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  if (!has(cwd)) return null;
  // Inside a git repo: show the repo (toplevel) name instead of the cwd basename.
  const root = gitRoot(cwd);
  const base = root || String(cwd);
  const name = path.basename(base.replace(/[\\/]+$/, '')) || String(cwd);
  return { ...SEG.dir, group: 'loc', text: `${GLYPH.folder} ${name}` };
}

function branchSegment(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  const br = gitBranch(cwd);
  if (!br) return null;
  return { ...SEG.branch, group: 'loc', text: `${GLYPH.branch} ${br}` };
}

// --- Claude service status segment -----------------------------------------
// Background colors by statuspage `indicator`. `none` = operational (green); the
// rest escalate by severity. Unknown indicators fall back to grey.
const STATUS_BG = {
  none: [0, 150, 0],          // green  (all systems operational)
  minor: [170, 170, 0],       // yellow
  major: [200, 120, 0],       // orange
  critical: [180, 0, 0],      // red
  maintenance: [0, 120, 200], // blue
};
const STATUS_UNKNOWN_BG = [100, 100, 100]; // grey
// Short, lowercase label per indicator (not the long statuspage description).
const STATUS_LABEL = {
  none: 'operational',
  minor: 'minor',
  major: 'major',
  critical: 'critical',
  maintenance: 'maintenance',
};

// A colored health mark, clickable (OSC 8 hyperlink) to status.claude.com. It is
// a problem-only signal: shown only when there is an incident — dropped when all
// systems are operational, and when there is no usable data (cache missing/stale).
function statusSegment() {
  const c = readStatusCache();
  if (!c || c.indicator === 'none') return null;
  const bgc = STATUS_BG[c.indicator] || STATUS_UNKNOWN_BG;
  const dot = cp(0xf21e); // nf-fa-heartbeat — service-health pulse glyph (Nerd Font)
  const label = STATUS_LABEL[c.indicator] || 'unknown';
  // OSC 8 hyperlink (ST-terminated) to the status page; clickable where the terminal supports it.
  const link = `\x1b]8;;${STATUS_URL}\x1b\\${dot} ${label}\x1b]8;;\x1b\\`;
  return { bg: bgc, fg: GAUGE_FG, text: link };
}

// Read + validate the status cache. Null if absent, malformed, or older than the
// hard TTL (a stale problem must not linger after it may have been resolved).
function readStatusCache() {
  try {
    const c = JSON.parse(fs.readFileSync(STATUS_CACHE(), 'utf8'));
    if (!c || typeof c.indicator !== 'string' || typeof c.fetchedAt !== 'number') return null;
    if (Date.now() - c.fetchedAt > STATUS_HARD_TTL) return null;
    return c;
  } catch { return null; }
}

// Trigger a detached background refresh when the cache is stale — but only if the
// `status` element is actually enabled, so disabled users pay nothing. A lock
// file rate-limits concurrent refreshes to one per soft-TTL window.
function maybeRefreshStatus() {
  const { elements } = loadConfig();
  if (!elements.some((e) => e.type === 'status')) return;
  const c = readStatusCache();
  if (c && Date.now() - c.fetchedAt < STATUS_SOFT_TTL) return;
  try {
    const st = fs.statSync(STATUS_LOCK());
    if (Date.now() - st.mtimeMs < STATUS_SOFT_TTL) return; // a refresh is already in flight
  } catch { /* no lock */ }
  try { fs.writeFileSync(STATUS_LOCK(), String(Date.now()), 'utf8'); } catch { /* ignore */ }
  try {
    proc.spawn(process.execPath, [__filename, '--refresh-status'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
  } catch { /* ignore — best effort */ }
}

// Fetch status.json and rewrite the cache atomically. Network/parse failures are
// silent: the previous cache (if any) stays in place.
function refreshStatusCache() {
  const https = require('https');
  const done = (ok) => { try { fs.unlinkSync(STATUS_LOCK()); } catch { /* ignore */ } process.exit(ok ? 0 : 0); };
  try {
    const req = https.get(STATUS_API, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return done(false); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (ch) => (body += ch));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const indicator = j?.status?.indicator;
          if (typeof indicator !== 'string') return done(false);
          const out = { indicator, description: j?.status?.description || '', fetchedAt: Date.now() };
          const dest = STATUS_CACHE();
          const tmp = dest + '.' + process.pid + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
          fs.renameSync(tmp, dest);
          done(true);
        } catch { done(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); done(false); });
    req.on('error', () => done(false));
  } catch { done(false); }
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
      if (s.group === 'loc' && next.group === 'loc') {
        // Location segments (dir/branch) merge: plain colored chevron, no band.
        out += bg(next.bg) + fg(s.bg) + GLYPH.sep;
      } else {
        // Black band: current color points into black, then black into next.
        out += bg(DARK_SEP) + fg(s.bg) + GLYPH.sep;
        out += bg(next.bg) + fg(DARK_SEP) + GLYPH.sep;
      }
    }
  }
  out += DEFBG + fg(segs[segs.length - 1].bg) + GLYPH.rightCap + RESET;
  return out;
}

// --- git repo root (no spawn) ----------------------------------------------
// Walk up from `start` to the directory holding .git. Returns its absolute path,
// or '' if not in a repo. The repo name is the basename of this path.
function gitRoot(start) {
  try {
    let dir = path.resolve(String(start));
    let prev = '';
    while (dir && dir !== prev) {
      try { if (fs.existsSync(path.join(dir, '.git'))) return dir; } catch { /* ignore */ }
      prev = dir;
      dir = path.dirname(dir);
    }
  } catch { /* ignore */ }
  return '';
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
