#!/usr/bin/env node
// End-to-end tests for scripts/statusline.js — black-box: spawn the script with
// a temp HOME (config), a statusLine JSON on stdin, optional COLUMNS, and assert
// on the structure of the rendered strip (rounded caps at both ends, the right
// intermediate separators per element combination, graceful drops, right-align).
//
// Zero dependency: run with `node tests/e2e.js` (exit 0 = all pass).

const assert = require('assert');
const cpmod = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'statusline.js');

// Glyphs / colors — must mirror scripts/statusline.js.
const LEFTCAP = String.fromCodePoint(0xe0b6);
const RIGHTCAP = String.fromCodePoint(0xe0b4);
const SEP = String.fromCodePoint(0xe0b0);
const DARK_BG = '48;2;12;12;12'; // black band background

// --- tmp dirs --------------------------------------------------------------
const tmps = [];
function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}
function cleanup() {
  for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
}

// A HOME dir holding the given config object.
function homeWith(config) {
  const home = tmpdir('sb-home-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.claude', 'gradient-statusline.config.json'),
    JSON.stringify(config),
    'utf8',
  );
  return home;
}

// A cwd dir that is a git repo on `branch` (writes a fake .git/HEAD).
function gitDir(branch) {
  const d = tmpdir('sb-git-');
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  fs.writeFileSync(path.join(d, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`, 'utf8');
  return d;
}
// A plain (non-git) cwd dir.
function plainDir() { return tmpdir('sb-plain-'); }

// Build a statusLine JSON.
function data({ cwd, ctx, fiveHour, fiveReset, sevenDay, sevenReset } = {}) {
  const d = {};
  if (cwd) d.workspace = { current_dir: cwd };
  if (ctx !== undefined) d.context_window = { used_percentage: ctx };
  const rl = {};
  if (fiveHour !== undefined) rl.five_hour = { used_percentage: fiveHour, resets_at: fiveReset };
  if (sevenDay !== undefined) rl.seven_day = { used_percentage: sevenDay, resets_at: sevenReset };
  if (Object.keys(rl).length) d.rate_limits = rl;
  return d;
}

// Spawn the script, return stdout. `statusCache` pre-seeds the Claude-status
// cache file. Whenever the config includes the `status` element we also drop a
// fresh lock file so the script's background refresh never spawns a real network
// fetch — these tests stay fully offline.
function run(config, d, { columns, statusCache } = {}) {
  const home = homeWith(config);
  const claudeDir = path.join(home, '.claude');
  if (statusCache !== undefined) {
    fs.writeFileSync(path.join(claudeDir, 'claude-status.cache.json'), JSON.stringify(statusCache), 'utf8');
  }
  const hasStatus = Array.isArray(config.elements) && config.elements.some((e) => e && e.type === 'status');
  if (hasStatus) {
    fs.writeFileSync(path.join(claudeDir, 'claude-status.fetching'), String(Date.now()), 'utf8');
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  if (columns) env.COLUMNS = String(columns); else delete env.COLUMNS;
  const res = cpmod.spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(d),
    env,
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`script exited ${res.status}: ${res.stderr}`);
  return res.stdout;
}

// Status cache helpers.
const DOT = String.fromCodePoint(0xf21e); // nf-fa-heartbeat — the status mark glyph
const freshCache = (indicator, description = '') => ({ indicator, description, fetchedAt: Date.now() });
const staleCache = (indicator) => ({ indicator, description: '', fetchedAt: Date.now() - 60 * 60 * 1000 });

const els = (...types) => ({ baseCommand: '', elements: types.map((type) => ({ type })) });

// --- assertions on rendered output -----------------------------------------
function strip(s) {
  return s
    .replace(/\x1b\]8;[^;]*;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC 8 hyperlink wrappers
    .replace(/\x1b\[[0-9;]*m/g, '');                          // SGR color codes
}
function count(s, glyph) { return strip(s).split(glyph).length - 1; }
function visW(s) { return Array.from(strip(s)).length; }

function startsAndEndsCapped(out, { strips = 1 } = {}) {
  const vis = strip(out);
  const firstNonSpace = vis.replace(/^ */, '')[0];
  assert.strictEqual(firstNonSpace, LEFTCAP, `expected leftCap at start, got ${JSON.stringify(vis.slice(0, 8))}`);
  assert.strictEqual(vis[vis.length - 1], RIGHTCAP, `expected rightCap at end, got ${JSON.stringify(vis.slice(-8))}`);
  assert.strictEqual(count(out, LEFTCAP), strips, `expected ${strips} leftCap(s)`);
  assert.strictEqual(count(out, RIGHTCAP), strips, `expected ${strips} rightCap(s)`);
}

// --- test runner -----------------------------------------------------------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// reset timestamps: fixed values are fine (labels just need to render).
const FIVE = 1700000000;
const SEVEN = 1700400000;
const full = (cwd) => data({ cwd, ctx: 28, fiveHour: 9, fiveReset: FIVE, sevenDay: 14, sevenReset: SEVEN });

test('1. single module (ctx) — capped, no separator', () => {
  const out = run(els('ctx'), full());
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 0, 'no separator for a single segment');
  assert.ok(strip(out).includes('28%'), 'shows ctx %');
});

test('2. dir+branch only — 1 plain chevron, no black band', () => {
  const g = gitDir('feature/x');
  const out = run(els('dir', 'branch'), full(g));
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 1, 'one separator (loc-loc merge)');
  assert.ok(!out.includes(DARK_BG), 'dir/branch merge has no black band');
  assert.ok(strip(out).includes(path.basename(g)), 'shows dir name');
  assert.ok(strip(out).includes('feature/x'), 'shows branch');
});

test('3. three gauges (ctx 5h 7d) — 4 seps, black band present', () => {
  const out = run(els('ctx', '5h', '7d'), full());
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 4, '2 chevrons per gauge transition x2 = 4');
  assert.ok(out.includes(DARK_BG), 'gauge transitions use the black band');
});

test('4. all five, no gap (ctx 5h 7d dir branch) — 7 seps', () => {
  const out = run(els('ctx', '5h', '7d', 'dir', 'branch'), full(gitDir('main')));
  startsAndEndsCapped(out);
  // ctx-5h(2) 5h-7d(2) 7d-dir(2) dir-branch(1) = 7
  assert.strictEqual(count(out, SEP), 7);
});

test('5. order dir branch ctx 5h 7d — 7 seps, first transition merges', () => {
  const g = gitDir('main');
  const out = run(els('dir', 'branch', 'ctx', '5h', '7d'), full(g));
  startsAndEndsCapped(out);
  // dir-branch(1) branch-ctx(2) ctx-5h(2) 5h-7d(2) = 7
  assert.strictEqual(count(out, SEP), 7);
  // the dir->branch boundary is a single plain chevron: between the two location
  // bgs (220 then 180) there must be no black band before the branch segment.
  const vis = strip(out);
  const idxFolder = vis.indexOf(String.fromCodePoint(0xf07b));
  const idxBranch = vis.indexOf(String.fromCodePoint(0xe0a0));
  assert.ok(idxFolder >= 0 && idxBranch > idxFolder, 'dir then branch order');
});

test('6. gap right-align (dir branch gap ctx 5h 7d, COLUMNS=120)', () => {
  const out = run(els('dir', 'branch', 'gap', 'ctx', '5h', '7d'), full(gitDir('main')), { columns: 120 });
  startsAndEndsCapped(out, { strips: 2 }); // two strips => 2 caps each side
  assert.strictEqual(count(out, SEP), 1 + 4, 'left strip 1 + right strip 4');
  assert.strictEqual(visW(out), 120 - 4, 'visible width = COLUMNS - EDGE_RESERVE');
  // a run of padding spaces separates the two strips
  assert.ok(/ {5,}/.test(strip(out)), 'padding spaces between strips');
});

test('7. missing data — only ctx survives', () => {
  const out = run(els('ctx', '5h', '7d'), data({ ctx: 50 })); // no rate_limits
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 0, 'only one segment left');
  assert.ok(strip(out).includes('50%'));
});

test('8. non-git cwd — branch dropped, dir alone', () => {
  const out = run(els('dir', 'branch'), full(plainDir()));
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 0, 'branch dropped, single segment');
  assert.ok(!strip(out).includes(String.fromCodePoint(0xe0a0)), 'no branch glyph');
});

test('9. gap with empty right side — left only, no trailing pad', () => {
  const out = run(els('dir', 'gap', 'branch'), full(plainDir()), { columns: 120 });
  startsAndEndsCapped(out); // single strip (left), right was empty
  assert.ok(!/ $/.test(out), 'no trailing spaces when right side empty');
  assert.ok(visW(out) < 30, 'not padded to full width');
});

test('10. legacy config (mode only) — falls back to 3 gauges', () => {
  const out = run({ baseCommand: '', mode: 'medium' }, full());
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 4, 'ctx 5h 7d fallback => 4 seps');
});

test('11. everything absent — empty output, no orphan cap', () => {
  // only gauges configured but no data at all
  const out = run(els('ctx', '5h', '7d'), {});
  assert.strictEqual(out, '', 'empty string when nothing to show');
});

test('12. invariants across subsets — caps + sep formula', () => {
  const LOC = new Set(['dir', 'branch']);
  const sepFor = (types) => {
    let n = 0;
    for (let i = 0; i < types.length - 1; i++) {
      n += LOC.has(types[i]) && LOC.has(types[i + 1]) ? 1 : 2;
    }
    return n;
  };
  const g = gitDir('main');
  const subsets = [
    ['ctx'], ['dir'], ['branch'], ['5h', '7d'], ['dir', 'ctx'],
    ['ctx', 'dir', 'branch'], ['branch', 'dir'], ['dir', 'branch', '7d'],
    ['5h', 'dir'], ['ctx', '5h', '7d', 'branch'],
  ];
  for (const sub of subsets) {
    const out = run(els(...sub), full(g));
    startsAndEndsCapped(out);
    assert.strictEqual(count(out, SEP), sepFor(sub), `seps for [${sub.join(',')}]`);
    // no cap should appear in the middle of the visible text
    const vis = strip(out);
    assert.strictEqual(vis.slice(1, -1).includes(RIGHTCAP), false, `no mid rightCap in [${sub.join(',')}]`);
  }
});

test('13. status operational (none) — green dot + label shown', () => {
  const out = run(els('status'), data({ ctx: 20 }), { statusCache: freshCache('none', 'All Systems Operational') });
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 0, 'single segment');
  assert.ok(strip(out).includes(DOT), 'shows the status dot');
  assert.ok(strip(out).includes('operational'), 'shows the short lowercase label');
  assert.ok(out.includes('48;2;0;150;0'), 'operational => green background');
  assert.ok(out.includes('\x1b]8;;https://status.claude.com/'), 'dot is an OSC 8 hyperlink');
});

test('14. status incident (critical) — red dot + label, capped', () => {
  const out = run(els('status'), data({ ctx: 20 }), { statusCache: freshCache('critical', 'Partial Outage') });
  startsAndEndsCapped(out);
  assert.strictEqual(count(out, SEP), 0, 'single segment');
  assert.ok(strip(out).includes(DOT), 'shows the status dot');
  assert.ok(strip(out).includes('critical'), 'shows the short lowercase label');
  assert.ok(out.includes('48;2;180;0;0'), 'critical => red background');
  assert.ok(out.includes('\x1b]8;;https://status.claude.com/'), 'dot is an OSC 8 hyperlink');
});

test('15. status stale beyond hard TTL — dot hidden', () => {
  const out = run(els('status'), data({ ctx: 20 }), { statusCache: staleCache('critical') });
  assert.strictEqual(out, '', 'stale cache is treated as unknown -> hidden');
});

test('16. status with gap — width correct despite invisible hyperlink', () => {
  const out = run(els('dir', 'gap', 'status'), full(plainDir()), { columns: 120, statusCache: freshCache('major') });
  startsAndEndsCapped(out, { strips: 2 });
  assert.strictEqual(visW(out), 120 - 4, 'OSC 8 URL must not count toward width');
  assert.ok(strip(out).includes(DOT), 'shows the status dot in the right strip');
});

// --- run -------------------------------------------------------------------
let failures = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`\x1b[32m✓\x1b[0m ${t.name}`);
  } catch (e) {
    failures++;
    console.log(`\x1b[31m✗\x1b[0m ${t.name}`);
    console.log(`    ${e.message}`);
  }
}
cleanup();
console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exit(failures ? 1 : 0);
