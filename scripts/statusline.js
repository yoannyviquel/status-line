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

const ALL_TYPES = ['ctx', '5h', '7d', 'model', 'dir', 'branch', 'status', 'pr', 'gap'];

// --- Claude service status (status.claude.com) -----------------------------
// `status` is a colored dot that only appears when something is wrong. It is
// driven by a tiny on-disk cache so the render path never touches the network:
// rendering reads the cache (sync); refreshing it is a detached self-spawn
// (`--refresh-status`) that fetches the statuspage JSON and rewrites the cache.
const STATUS_URL = 'https://status.claude.com/';
// summary.json (not status.json) so we also get the unresolved `incidents` — their
// names carry the affected model (e.g. "Elevated errors on Claude Haiku 4.5"),
// which lets us hide the segment when the incident does not concern the model in use.
const STATUS_API = 'https://status.claude.com/api/v2/summary.json';
// Model families used to decide whether an incident concerns the current model.
const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku'];
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
// Dark band inserted between same-gamme segments for a clean separation.
const DARK_SEP = [12, 12, 12];
// dir / branch: dark grey backgrounds, white text.
const SEG = {
  dir: { bg: [60, 60, 60], fg: [255, 255, 255] },
  branch: { bg: [40, 40, 40], fg: [255, 255, 255] },
  // model: Claude clay/orange background, white text.
  model: { bg: [217, 119, 87], fg: [255, 255, 255] },
};

// --- Segment behavior (declarative traits) ---------------------------------
// Each segment carries a `family`; the separator drawn between two adjacent
// segments is decided by `sepStyle()` from these traits (no hard-coded flags):
//   merge -> plain colored chevron (segments blend; distinct colors)
//   band  -> wide black double-chevron (same gamme / differing families)
// A segment may also set `mergeNext:true` to force a merge into its right
// neighbour regardless of families (e.g. model flowing into the ctx gauge).
const FAMILY = {
  gauge: { sep: 'merge' },   // gauges share the green->red gradient gamme
  loc: { sep: 'merge' },    // dir/branch/model: distinct colors, blend
  status: { sep: 'band' },
  pr: { sep: 'merge' },     // session PR list (second line): blend per status color
};
const SEP_CROSS = 'band';   // between two different families

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
  const d = safeParse(raw);
  let prefix = '';
  if (baseCommand) {
    try {
      prefix = proc
        .execSync(baseCommand, { input: raw, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
        .toString()
        .replace(/\s+$/, '');
    } catch { prefix = ''; }
  }
  const ind = indicators(d, elements);
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
  // Screen too small to right-align (pad <= 0, or COLUMNS unknown): drop the gap and
  // render ONE unified strip from all segments. The two sides become flush — the last
  // left segment (branch) flows into the first right segment (model) via the normal
  // `loc` merge chevron — instead of two split strips with their own caps.
  if (pad < 1) return powerline([...lSegs, ...rSegs]);
  return left + ' '.repeat(pad) + right;
}

function buildSegs(elements, d) {
  const segs = [];
  for (const el of elements) {
    // `pr` expands into one mini-segment per session pull request, in place
    // (e.g. right after `branch`); every other element is a single segment.
    if (el.type === 'pr') { segs.push(...prSegs(d)); continue; }
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
  if (type === 'status') return statusSegment(d);
  return null;
}

// A gauge segment: glyph, then "NN%" (and an optional label), on a bg colored by the %.
function gauge(glyph, label, pct) {
  if (!has(pct)) return null;
  const p = Math.round(pct);
  return { glyph, label, value: String(p), unit: '%', bg: grad(p / 100), fg: GAUGE_FG, family: 'gauge' };
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
  // mergeNext: the orange chevron flows into the segment on its right (ctx gauge).
  return { ...SEG.model, glyph: GLYPH.model, label: name, family: 'loc', mergeNext: true };
}

function dirSegment(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  if (!has(cwd)) return null;
  // Inside a git repo: show the repo (toplevel) name instead of the cwd basename.
  const root = gitRoot(cwd);
  const base = root || String(cwd);
  const name = path.basename(base.replace(/[\\/]+$/, '')) || String(cwd);
  // Clickable: inside a repo -> the remote's web URL; otherwise (or if no remote)
  // -> the directory in the OS file explorer (file:// URL).
  const link = (root && gitRemoteUrl(root)) || fileUrl(base);
  return { ...SEG.dir, glyph: GLYPH.folder, label: name, family: 'loc', link };
}

function branchSegment(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  const br = gitBranch(cwd);
  if (!br) return null;
  return { ...SEG.branch, glyph: GLYPH.branch, label: br, family: 'loc' };
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

// The current model's family (opus / sonnet / haiku) and major.minor version,
// e.g. "Opus 4.8" / "claude-opus-4-8" -> { family: 'opus', version: '4.8' }.
function modelIdent(d) {
  const s = String(d && d.model && (d.model.display_name || d.model.id) || '').toLowerCase();
  const family = MODEL_FAMILIES.find((f) => s.includes(f)) || '';
  const m = family ? /(\d+[.\-]\d+|\d+)/.exec(s.replace(family, ' ')) : null;
  return { family, version: m ? m[1].replace(/-/g, '.') : '' };
}

// Does ONE incident concern the model in use? It concerns us when it names no
// model (general), or names our family with no version (family-wide), or names
// our family with a version equal to ours. It does NOT concern us when it only
// names other families, or our family but only other versions (e.g. a Haiku 4.5
// incident while we run Haiku 4.6).
function incidentConcerns(text, me) {
  const matches = [...String(text || '').toLowerCase().matchAll(/(opus|sonnet|haiku)[\s/-]*(\d+[.\-]\d+|\d+)?/g)];
  if (!matches.length) return true;                  // no model named -> general
  const mine = matches.filter((m) => m[1] === me.family);
  if (!mine.length) return false;                    // names models, none is ours
  const versions = mine.map((m) => m[2]).filter(Boolean).map((v) => v.replace(/-/g, '.'));
  if (!versions.length || !me.version) return true;  // family-wide, or no version to compare
  return versions.includes(me.version);
}

// Show the status segment only if at least one active incident concerns the model
// in use. No per-incident data (older cache / maintenance) or an unknown current
// model both fail open (show).
function statusConcernsModel(c, d) {
  const incidents = Array.isArray(c.incidents) ? c.incidents : [];
  if (!incidents.length) return true;
  const me = modelIdent(d);
  if (!me.family) return true;
  return incidents.some((inc) => incidentConcerns(inc && (inc.text || inc.name) || inc, me));
}

// A colored health mark. It is a problem-only signal: shown only when there is an
// incident — dropped when all systems are operational, when there is no usable
// data (cache missing/stale), and when the incident does not concern the model in
// use (e.g. a Haiku incident while you are on Opus). `mergeNext` so it blends into
// its neighbours with a plain colored chevron (no wide black band), sitting flush
// after `model`. Clickable (OSC 8) to status.claude.com via the `link` field — the
// URL bytes are invisible and visW() strips OSC 8, so the layout math stays exact.
function statusSegment(d) {
  const c = readStatusCache();
  if (!c || c.indicator === 'none') return null;
  if (!statusConcernsModel(c, d)) return null;
  const bgc = STATUS_BG[c.indicator] || STATUS_UNKNOWN_BG;
  const dot = cp(0xf21e); // nf-fa-heartbeat — service-health pulse glyph (Nerd Font)
  // Show the statuspage `description` (user-facing impact, e.g. "Partially Degraded
  // Service") rather than the bare severity word; fall back to the indicator label.
  const label = (c.description || STATUS_LABEL[c.indicator] || 'unknown').toLowerCase();
  return { bg: bgc, fg: GAUGE_FG, glyph: dot, label, family: 'status', mergeNext: true, link: STATUS_URL };
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
          // Capture each unresolved incident's name + latest update bodies so the
          // render path can tell which model family the incident concerns.
          const incidents = Array.isArray(j.incidents) ? j.incidents.map((i) => ({
            text: [i && i.name, ...(((i && i.incident_updates) || []).slice(0, 2).map((u) => u && u.body))]
              .filter(Boolean).join(' ').slice(0, 300),
          })) : [];
          const out = { indicator, description: j?.status?.description || '', incidents, fetchedAt: Date.now() };
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

// --- session pull requests --------------------------------------------------
// PRs created during the session are captured to disk by scripts/pr-capture.js
// (a PostToolUse hook), keyed by the Claude Code `session_id` that this renderer
// also receives on stdin. The `pr` element expands inline (at its position in the
// element order) into one clickable mini-segment per PR (status glyph +
// "#<number>"). Render is read-only — it never writes the cache.
const SESSION_PR_DIR = () => path.join(os.homedir(), '.claude', 'status-line-prs');
const PR_FG = [255, 255, 255];
// Status -> { background color, glyph }. Covers Azure DevOps (active / completed /
// abandoned), GitHub review states, and draft / approved / waiting nuances.
const PR_STATUS = {
  open:      { bg: [40, 110, 180], glyph: 0xea64 }, // blue   — open / active (git-pull-request)
  draft:     { bg: [90, 90, 90],   glyph: 0xea64 }, // grey   — draft
  waiting:   { bg: [170, 140, 0],  glyph: 0xea64 }, // amber  — waiting on author / changes requested
  approved:  { bg: [40, 140, 60],  glyph: 0xea64 }, // green  — approved
  completed: { bg: [120, 70, 160], glyph: 0xea84 }, // purple — merged / completed (git-merge)
  abandoned: { bg: [80, 80, 80],   glyph: 0xea64 }, // grey   — abandoned / closed
};
const PR_DEFAULT = { bg: [40, 110, 180], glyph: 0xea64 };

// Sanitise a session id into a filesystem-safe basename (UUIDs are already safe).
function safeSid(sid) { return String(sid).replace(/[^A-Za-z0-9_-]/g, '_'); }

// Normalise assorted status / review_state spellings to a PR_STATUS key.
function prStatusKey(s) {
  const v = String(s || '').toLowerCase();
  if (/(complet|merg)/.test(v)) return 'completed';
  if (/(abandon|closed|declin)/.test(v)) return 'abandoned';
  if (/draft/.test(v)) return 'draft';
  if (/approv/.test(v)) return 'approved';
  if (/(wait|changes[_-]?requested|rejected)/.test(v)) return 'waiting';
  if (/(active|open|review|pending)/.test(v)) return 'open';
  return v;
}

// All PRs to show this render: the session's captured PRs plus, when present,
// Claude Code's native current-branch PR (`d.pr`). Deduped by URL, in the order
// they were created (captured order first).
function readSessionPrs(d) {
  const out = [];
  const seen = new Set();
  const add = (pr) => {
    if (!pr || !has(pr.url)) return;
    const key = String(pr.url).replace(/\/+$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(pr);
  };
  try {
    const sid = d.session_id;
    if (has(sid)) {
      const c = JSON.parse(fs.readFileSync(path.join(SESSION_PR_DIR(), safeSid(sid) + '.json'), 'utf8'));
      if (c && Array.isArray(c.prs)) c.prs.forEach(add);
    }
  } catch { /* no captured PRs */ }
  if (d.pr && has(d.pr.url)) add({ number: d.pr.number, url: d.pr.url, status: d.pr.review_state || 'open' });
  return out;
}

// One PR mini-segment: status glyph + "#<number>", clickable to the PR URL.
function prSeg(pr) {
  const meta = PR_STATUS[prStatusKey(pr.status)] || PR_DEFAULT;
  const label = has(pr.number) ? '#' + pr.number : 'PR';
  // No mergeNext needed: sepStyle() already merges any edge touching a `pr` segment.
  return { bg: meta.bg, fg: PR_FG, glyph: cp(meta.glyph), label, family: 'pr', link: pr.url };
}

// The session's PRs as inline segments (one per PR), placed wherever `pr` sits in
// the element order (e.g. right after `branch`). Empty when there are none.
function prSegs(d) {
  return readSessionPrs(d).map(prSeg);
}

// --- ANSI / powerline rendering --------------------------------------------
const fg = (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const DEFBG = '\x1b[49m';
const RESET = '\x1b[0m';

// Serialise a structured segment into its display text. Components carry
// glyph/label/value?/unit?; gauges render "<glyph> NN% <label>", location
// segments "<glyph> <name>". A `text` field (status' OSC 8 link) is returned
// verbatim. Output is byte-identical to the previous hand-assembled strings.
function renderText(seg) {
  if (seg.text !== undefined) return seg.text;
  const parts = [];
  if (has(seg.value)) parts.push(seg.value + (seg.unit || ''));
  if (has(seg.label)) parts.push(seg.label);
  const body = parts.length ? `${seg.glyph} ${parts.join(' ')}` : seg.glyph;
  // `link`: wrap the visible body in an OSC 8 hyperlink (ST-terminated) so the
  // segment is clickable where the terminal supports it. The URL bytes are
  // invisible — visW() strips OSC 8, so layout math is unaffected.
  return seg.link ? `\x1b]8;;${seg.link}\x1b\\${body}\x1b]8;;\x1b\\` : body;
}

// Separator style between adjacent segments a -> b (see FAMILY traits):
// a `mergeNext` override wins; else same family uses its declared sep; else band.
function sepStyle(a, b) {
  if (a.mergeNext) return 'merge';
  if (a.family === 'pr' || b.family === 'pr') return 'merge'; // PRs always blend — no wide band
  if (a.family === b.family && FAMILY[a.family]) return FAMILY[a.family].sep;
  return SEP_CROSS;
}

// Render a list of structured segments as a powerline strip:
// rounded left cap, segments joined per sepStyle(), rounded right cap.
function powerline(segs) {
  let out = DEFBG + fg(segs[0].bg) + GLYPH.leftCap;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    out += bg(s.bg) + fg(s.fg) + ' ' + renderText(s) + ' ';
    if (i < segs.length - 1) {
      const next = segs[i + 1];
      const style = sepStyle(s, next);
      if (style === 'merge') {
        // Plain colored chevron: current color points into next, no band.
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

// --- clickable links -------------------------------------------------------
// Web URL of a repo's origin remote, parsed from <root>/.git/config. Converts
// scp-style ssh (git@host:owner/repo) and ssh:// URLs to https and drops a
// trailing .git so the link opens in a browser. '' if no usable remote.
function gitRemoteUrl(root) {
  try {
    const cfg = fs.readFileSync(path.join(root, '.git', 'config'), 'utf8');
    const m = /\[remote "origin"\][^[]*?\burl\s*=\s*([^\r\n]+)/.exec(cfg);
    if (!m) return '';
    let url = m[1].trim();
    if (!url) return '';
    const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url); // git@host:owner/repo(.git)
    if (scp) url = `https://${scp[1]}/${scp[2]}`;
    else url = url.replace(/^ssh:\/\/(?:[^@/]+@)?/, 'https://').replace(/^git:\/\//, 'https://');
    return /^https?:\/\//.test(url) ? url.replace(/\.git$/, '') : '';
  } catch { return ''; }
}

// file:// URL to reveal a path in the OS file explorer. Windows "C:\x" -> "file:///C:/x".
function fileUrl(p) {
  let abs = path.resolve(String(p)).replace(/\\/g, '/');
  if (!abs.startsWith('/')) abs = '/' + abs; // drive-letter paths gain the leading slash
  return 'file://' + encodeURI(abs);
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
