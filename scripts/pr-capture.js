#!/usr/bin/env node
// PostToolUse / SessionEnd hook — capture the session's pull requests for the
// status-line `pr` element (the clickable second-line PR list).
//
// MCP-agnostic: it does NOT key off any specific tool name. On PostToolUse it
// scans the tool input/response text for pull-request URLs (Azure DevOps/TFS,
// GitHub, GitLab) and, when the activity looks like a PR *creation* (not merely
// viewing one), upserts the PR — deduped by URL — into
// ~/.claude/status-line-prs/<session_id>.json. With --purge (wired to
// SessionEnd) it deletes the current session's file.
//
// Defensive like deploy.js: everything in try/catch, ALWAYS exit 0, and never
// write to stdout (a hook's stdout is parsed by Claude Code).
const fs = require('fs');
const os = require('os');
const path = require('path');

const PR_DIR = path.join(os.homedir(), '.claude', 'status-line-prs');
const CONFIG = path.join(os.homedir(), '.claude', 'gradient-statusline.config.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // forget session PR files after 7 days
const MAX_PRS = 50;

function has(v) { return v !== undefined && v !== null && v !== ''; }
function safeSid(sid) { return String(sid).replace(/[^A-Za-z0-9_-]/g, '_'); }
function safeStr(v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return ''; } }
function done() { process.exit(0); }

// Is the `pr` element enabled in the status-line config? If not, do nothing —
// disabled users pay nothing.
function prEnabled() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    return Array.isArray(c.elements) && c.elements.some((e) => e && e.type === 'pr');
  } catch { return false; }
}

// Remove session PR files older than the TTL.
function sweep() {
  try {
    for (const f of fs.readdirSync(PR_DIR)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(PR_DIR, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > TTL_MS) fs.unlinkSync(p); } catch { /* ignore */ }
    }
  } catch { /* no dir yet */ }
}

// Find pull-request URLs (+ number + host) in an arbitrary text blob. The
// patterns are host-shaped, not tool-specific, so any MCP/CLI that surfaces a
// PR URL is covered.
function findPrs(text) {
  const out = [];
  const scan = (re, host) => { let m; while ((m = re.exec(text))) out.push({ url: m[1], number: Number(m[2]), host }); };
  scan(/(https?:\/\/[^\s"'<>]+?\/_git\/[^\s"'<>/]+\/pullrequest\/(\d+))/ig, 'azure');   // Azure DevOps / TFS
  scan(/(https?:\/\/github\.[^\s"'<>]+?\/pull\/(\d+))/ig, 'github');                     // GitHub
  scan(/(https?:\/\/[^\s"'<>]+?\/-\/merge_requests\/(\d+))/ig, 'gitlab');                // GitLab
  return out;
}

// Heuristic: does this tool activity look like a PR *creation* (vs merely
// viewing/listing one)? Generic — checks for creation wording in the response,
// or a create-pull-request shape in the tool name / input.
function looksLikeCreation(haystack, toolName, toolInput) {
  if (/created|successfully created|opened|pull request created|nouvelle\s+pull/i.test(haystack)) return true;
  const meta = String(toolName || '') + ' ' + safeStr(toolInput);
  return /\bpr\s+create\b|create[-_\s]?pull[-_\s]?request|pull[-_\s]?request[-_\s]?create/i.test(meta);
}

// Upsert the found PRs into the session store (dedup by URL, creation order).
function upsert(sid, found) {
  if (!found.length) return;
  fs.mkdirSync(PR_DIR, { recursive: true });
  const file = path.join(PR_DIR, safeSid(sid) + '.json');
  let store = { updatedAt: 0, prs: [] };
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (c && Array.isArray(c.prs)) store = c; } catch { /* new */ }
  const seen = new Set(store.prs.map((p) => String(p.url).replace(/\/+$/, '')));
  for (const f of found) {
    const key = String(f.url).replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    store.prs.push({ number: f.number, url: f.url, host: f.host, status: 'open', addedAt: Date.now() });
  }
  if (store.prs.length > MAX_PRS) store.prs = store.prs.slice(-MAX_PRS);
  store.updatedAt = Date.now();
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
  fs.renameSync(tmp, file); // atomic
}

(function main() {
  try {
    if (!prEnabled()) return done();
    let raw = '';
    process.stdin.on('error', () => done());
    process.stdin.on('data', (c) => (raw += c));
    process.stdin.on('end', () => {
      try {
        const ev = raw ? JSON.parse(raw) : {};
        const sid = ev.session_id;
        if (process.argv.includes('--purge')) {
          // TTL-only cleanup: keep the current session's file so a resume of this
          // session still finds its captured PRs (the sweep removes >7d-old files).
          sweep();
          return done();
        }
        sweep();
        if (!has(sid)) return done();
        const haystack = safeStr(ev.tool_response) + ' ' + safeStr(ev.tool_input);
        const found = findPrs(haystack);
        if (found.length && looksLikeCreation(haystack, ev.tool_name, ev.tool_input)) upsert(sid, found);
        done();
      } catch { done(); }
    });
  } catch { done(); }
})();
