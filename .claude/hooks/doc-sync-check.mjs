#!/usr/bin/env node
/**
 * ArtiCode Academy — Documentation Sync Guard (Claude Code hook)
 *
 * Purpose
 *   Reduce documentation drift by verifying, when Claude Code finishes a turn,
 *   that any source-code change made during that turn was accompanied by an
 *   update to docs/PROJECT_DOCUMENTATION.md.
 *
 * How it works (deterministic, git-independent)
 *   SessionStart  -> take a content-hash snapshot of all watched files and store
 *                    it in .claude/.doc-sync/<session_id>.json  (the "baseline").
 *   Stop          -> take a fresh snapshot and compare it with the baseline:
 *                    - no watched code changed             -> allow stop, refresh baseline
 *                    - code changed AND master doc changed -> allow stop, refresh baseline
 *                    - code changed, master doc unchanged  -> BLOCK ONCE with an
 *                      actionable message (baseline is kept so the next Stop can
 *                      see whether the doc was updated)
 *                    - stop_hook_active === true (Claude is already continuing
 *                      because of a previous block)        -> allow stop, warn the
 *                      user via systemMessage, refresh baseline (prevents loops)
 *
 * Safety properties
 *   - Fail-open: any internal error prints to stderr and exits 0 (never blocks).
 *   - Never modifies documentation or source files.
 *   - Only compares against a baseline taken inside the current session, so
 *     pre-existing uncommitted changes are never flagged.
 *   - State lives in .claude/.doc-sync/ which carries its own .gitignore.
 *
 * Manual test (from the project root, Git Bash):
 *   echo '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' | node .claude/hooks/doc-sync-check.mjs
 *   echo '{"hook_event_name":"Stop","session_id":"manual","stop_hook_active":false}'   | node .claude/hooks/doc-sync-check.mjs
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR
  ? resolve(process.env.CLAUDE_PROJECT_DIR)
  : resolve(SCRIPT_DIR, '..', '..');

/** The single authoritative project reference. */
const MASTER_DOC = 'docs/PROJECT_DOCUMENTATION.md';

/** Where per-session baselines are stored. */
const STATE_DIR = join(PROJECT_DIR, '.claude', '.doc-sync');

/** Directories never walked. */
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'out', '.git', '.vite', '.tmp',
  '.turbo', '.next', '.cache', '.doc-sync', '.idea', '.vscode',
]);

/** Top-level entries that are documentation / tooling, not application code. */
const IGNORE_TOP_LEVEL = new Set(['docs', '.claude', 'CLAUDE.md']);

/** File name patterns that are never considered application code. */
const IGNORE_FILE =
  /(^|[\\/])(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|\.env(\.[^\\/]*)?|[^\\/]*\.tsbuildinfo|[^\\/]*\.log|[^\\/]*\.md)$/i;

/** Files whose change counts as an application change (by extension or exact name). */
const CODE_FILE =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|html|css|scss|sass|less|sql|prisma|graphql|gql|ya?ml|toml|env\.example)$/i;
const CODE_NAMES = new Set(['Dockerfile', '.dockerignore', '.prettierrc', '.editorconfig']);

/** Baselines older than this are swept away to keep the state folder small. */
const STATE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Maximum changed files listed in the block message. */
const MAX_LISTED = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStdinJson() {
  try {
    if (process.stdin.isTTY) return {};
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function sha1(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

function isCodeFile(relPath) {
  const base = relPath.split(/[\\/]/).pop();
  if (IGNORE_FILE.test(relPath)) return false;
  if (CODE_NAMES.has(base)) return true;
  return CODE_FILE.test(relPath);
}

/** Recursively hash every watched file under PROJECT_DIR. */
function snapshot() {
  const files = {};
  const stack = [PROJECT_DIR];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(PROJECT_DIR, abs).split('\\').join('/');
      const top = rel.split('/')[0];
      if (IGNORE_TOP_LEVEL.has(top)) continue;
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        stack.push(abs);
      } else if (entry.isFile() && isCodeFile(rel)) {
        try {
          files[rel] = sha1(readFileSync(abs));
        } catch {
          /* unreadable file: skip */
        }
      }
    }
  }
  const docAbs = join(PROJECT_DIR, MASTER_DOC);
  const doc = existsSync(docAbs) ? sha1(readFileSync(docAbs)) : null;
  return { takenAt: new Date().toISOString(), doc, files };
}

function stateFile(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return join(STATE_DIR, `${safe}.json`);
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const gi = join(STATE_DIR, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n!.gitignore\n');
}

function sweepOldState() {
  try {
    const now = Date.now();
    for (const name of readdirSync(STATE_DIR)) {
      if (!name.endsWith('.json')) continue;
      const p = join(STATE_DIR, name);
      if (now - statSync(p).mtimeMs > STATE_MAX_AGE_MS) unlinkSync(p);
    }
  } catch {
    /* best effort */
  }
}

function writeBaseline(sessionId, snap) {
  ensureStateDir();
  writeFileSync(stateFile(sessionId), JSON.stringify(snap));
  sweepOldState();
}

function readBaseline(sessionId) {
  const p = stateFile(sessionId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function diffFiles(before, after) {
  const changed = [];
  for (const [k, v] of Object.entries(after)) {
    if (!(k in before)) changed.push(`${k} (added)`);
    else if (before[k] !== v) changed.push(`${k} (modified)`);
  }
  for (const k of Object.keys(before)) {
    if (!(k in after)) changed.push(`${k} (removed)`);
  }
  return changed.sort();
}

function buildBlockReason(changed, docExists) {
  const listed = changed
    .slice(0, MAX_LISTED)
    .map((c) => `  - ${c}`)
    .join('\n');
  const more =
    changed.length > MAX_LISTED ? `\n  ... and ${changed.length - MAX_LISTED} more` : '';
  const docLine = docExists
    ? `${MASTER_DOC} was NOT modified during this turn.`
    : `${MASTER_DOC} does not exist. Create it (see CLAUDE.md).`;
  return [
    '[doc-sync-guard] Source files changed in this session but the master documentation was not updated.',
    '',
    `Changed since the last verified baseline (${changed.length} file(s)):`,
    listed + more,
    '',
    docLine,
    '',
    'Before finishing, apply CLAUDE.md RULE 18:',
    '  1. Review the files listed above.',
    '  2. Update the affected current-state sections of docs/PROJECT_DOCUMENTATION.md',
    '     (modules, API, database, configuration, feature status matrix, known issues).',
    '  3. Append an accurate entry to section 19 (PROJECT CHANGE HISTORY).',
    '  4. Report the documentation status in your final message.',
    '',
    'If these changes genuinely require no documentation update (e.g. whitespace/formatting only,',
    'or they were made by the user and not by you), state that explicitly in your final report and',
    'finish again. This guard blocks at most once per turn and will not loop.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const input = readStdinJson();
  const event = input.hook_event_name || process.argv[2] || '';
  const sessionId = input.session_id || process.argv[3] || 'manual';

  if (event === 'SessionStart') {
    // On context compaction the session continues; keep the existing baseline
    // so changes made before compaction are still verified at the next Stop.
    if (input.source === 'compact' && readBaseline(sessionId)) return;
    writeBaseline(sessionId, snapshot());
    return;
  }

  if (event !== 'Stop') {
    // Unknown / unsupported event: do nothing (fail-open).
    return;
  }

  const baseline = readBaseline(sessionId);
  const current = snapshot();

  if (!baseline) {
    // First Stop of a session that had no SessionStart baseline (e.g. the hook
    // was installed mid-session). Establish the baseline and allow the stop.
    writeBaseline(sessionId, current);
    return;
  }

  const changed = diffFiles(baseline.files || {}, current.files);
  const docChanged = baseline.doc !== current.doc;

  if (changed.length === 0 || docChanged) {
    writeBaseline(sessionId, current);
    return;
  }

  if (input.stop_hook_active === true) {
    // Already continued once because of this guard: never loop. Let the user
    // know the documentation is still potentially out of sync.
    writeBaseline(sessionId, current);
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          `[doc-sync-guard] ${changed.length} source file(s) changed this turn but ` +
          `${MASTER_DOC} was not updated. Allowing stop to avoid a loop. Please review.`,
      }),
    );
    return;
  }

  // Block once. Baseline is intentionally NOT refreshed so that the next Stop
  // can verify whether the documentation was updated for the same change set.
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: buildBlockReason(changed, current.doc !== null),
    }),
  );
}

try {
  main();
} catch (err) {
  // Never block Claude because of a bug in this guard.
  process.stderr.write(`[doc-sync-guard] internal error (ignored): ${err && err.message}\n`);
  process.exitCode = 0;
}
