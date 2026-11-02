#!/usr/bin/env node
/**
 * ArtiCode Academy — Git Sync Check (Claude Code hook, CH-0071)
 *
 * Purpose
 *   Two developers push to the same GitHub repository (CLAUDE.md "Parallel work",
 *   roadmap §5b, ADR-060). This hook keeps every Claude Code session aware of the
 *   remote WITHOUT ever changing the working tree: it never pushes, merges,
 *   rebases or checks anything out. Read-only by design.
 *
 * SessionStart (startup | resume | clear | fork)
 *   1. `git fetch origin --prune` (retry with `http.sslBackend=schannel` on Windows
 *      when the default TLS backend fails — KI-035, Avast interception).
 *   2. Report, as context for Claude and as a one-line notice for the user:
 *        - whether origin/main moved since the last fetch (+ the new commits and
 *          whether they touch the lockfile / migrations / seed / permission catalog),
 *        - remote branches that appeared or disappeared (the other lane's work),
 *        - the local state: branch, commits not pushed, "never pushed", local main
 *          ahead of origin/main (forbidden since CH-0070), behind origin/main,
 *          uncommitted changes.
 *   A failed fetch (offline, TLS) is reported and the report falls back to the
 *   last fetched state. Nothing is blocked.
 *
 * Stop
 *   Local-only (no network, fast): reminds the user ONCE per distinct state when
 *   the current branch has commits that are not on the remote, has never been
 *   pushed, is local main ahead of origin/main, or is behind origin/main as of the
 *   last fetch. The "state" is branch + HEAD + upstream + origin/main, stored in
 *   <git-dir>/claude-git-sync.json, so the reminder repeats only after a new
 *   commit, a branch switch or a fetch that moved origin/main. Uncommitted files
 *   are deliberately NOT reported at Stop (a dirty tree mid-task is normal).
 *
 * Safety properties
 *   - Never blocks (always exit 0; no `decision: block`, no `continue: false`).
 *   - Never runs a git command that writes to the working tree or to refs other
 *     than the remote-tracking refs updated by `fetch`.
 *   - Fail-open: any internal error prints to stderr and exits 0.
 *
 * Manual test (from the project root, Git Bash):
 *   echo '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' | node .claude/hooks/git-sync-check.mjs
 *   echo '{"hook_event_name":"Stop","session_id":"manual","stop_hook_active":false}'   | node .claude/hooks/git-sync-check.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR
  ? resolve(process.env.CLAUDE_PROJECT_DIR)
  : resolve(SCRIPT_DIR, '..', '..');

const REMOTE = 'origin';
const MAIN = 'main';
const TAG = '[git-sync]';
const FETCH_TIMEOUT_MS = 12_000; // per attempt; the hook timeout in settings.json is 30 s
const GIT_TIMEOUT_MS = 10_000;
const MAX_LOG_LINES = 10;

/** Paths whose change on origin/main needs a local follow-up after merging. */
const FOLLOW_UP_PATHS = [
  'backend/package-lock.json',
  'backend/prisma/migrations',
  'backend/prisma/seed.ts',
  'backend/src/authorization',
  'frontend/package-lock.json',
];

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

function git(args, { timeout = GIT_TIMEOUT_MS } = {}) {
  const r = spawnSync('git', args, {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
  });
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    error: r.error,
  };
}

function gitDir() {
  const r = git(['rev-parse', '--git-dir']);
  return r.ok ? resolve(PROJECT_DIR, r.out) : null;
}

function sha(ref) {
  const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.ok ? r.out : null;
}

function short(s) {
  return s ? s.slice(0, 7) : '?';
}

function count(range) {
  const r = git(['rev-list', '--count', range]);
  return r.ok ? Number(r.out) : null;
}

function shortLog(range, max) {
  const r = git(['log', '--oneline', '--no-decorate', `--max-count=${max + 1}`, range]);
  if (!r.ok || !r.out) return [];
  const lines = r.out.split('\n');
  if (lines.length > max) return [...lines.slice(0, max), `… (${count(range) ?? '?'} in total)`];
  return lines;
}

function remoteBranches() {
  const r = git(['for-each-ref', '--format=%(refname:short)', `refs/remotes/${REMOTE}`]);
  if (!r.ok) return [];
  return r.out.split('\n').filter(Boolean).filter((b) => b !== `${REMOTE}/HEAD`);
}

function currentBranch() {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.out : null; // 'HEAD' when detached
}

function upstreamOf() {
  const r = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  return r.ok && r.out ? r.out : null;
}

function dirtyCount() {
  const r = git(['status', '--porcelain', '--untracked-files=normal']);
  return r.ok ? r.out.split('\n').filter(Boolean).length : 0;
}

function changedFollowUpPaths(range) {
  const r = git(['diff', '--name-only', range, '--', ...FOLLOW_UP_PATHS]);
  return r.ok ? r.out.split('\n').filter(Boolean) : [];
}

function fetchRemote() {
  let r = git(['fetch', REMOTE, '--prune', '--quiet'], { timeout: FETCH_TIMEOUT_MS });
  if (r.ok) return { ok: true, via: 'default' };
  if (process.platform === 'win32') {
    const r2 = git(['-c', 'http.sslBackend=schannel', 'fetch', REMOTE, '--prune', '--quiet'], {
      timeout: FETCH_TIMEOUT_MS,
    });
    if (r2.ok) return { ok: true, via: 'schannel' };
    r = r2;
  }
  const reason = (r.err || (r.error && r.error.message) || 'unknown error').split('\n')[0];
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// Local state (no network)
// ---------------------------------------------------------------------------

function localState() {
  const branch = currentBranch();
  const head = sha('HEAD');
  const upstream = upstreamOf();
  const originMain = sha(`${REMOTE}/${MAIN}`);
  const remindable = []; // reported at Stop (once per state) and at SessionStart
  const informational = []; // reported at SessionStart only

  if (branch === 'HEAD') {
    informational.push('detached HEAD — check out a branch before working');
  }

  if (branch && branch !== 'HEAD') {
    if (branch === MAIN) {
      if (originMain) {
        const ahead = count(`${REMOTE}/${MAIN}..HEAD`);
        if (ahead > 0) {
          remindable.push(
            `local main is ${ahead} commit(s) ahead of ${REMOTE}/${MAIN} — since CH-0070 nothing goes to main directly: move them to a task branch (git switch -c frontend/<task> | backend/<task>) and open a PR`,
          );
        }
        const behind = count(`HEAD..${REMOTE}/${MAIN}`);
        if (behind > 0) {
          remindable.push(
            `local main is ${behind} commit(s) behind ${REMOTE}/${MAIN} → git merge --ff-only ${REMOTE}/${MAIN}`,
          );
        }
      }
    } else {
      if (upstream) {
        const unpushed = count(`${upstream}..HEAD`);
        if (unpushed > 0) {
          remindable.push(`branch ${branch} has ${unpushed} commit(s) not pushed to ${upstream}`);
        }
      } else {
        const beyond = originMain ? count(`${REMOTE}/${MAIN}..HEAD`) : null;
        remindable.push(
          `branch ${branch} has never been pushed (no upstream${beyond != null ? `; ${beyond} commit(s) beyond ${REMOTE}/${MAIN}` : ''}) — push it when the developer says so, then open a PR`,
        );
      }
      if (originMain) {
        const behind = count(`HEAD..${REMOTE}/${MAIN}`);
        if (behind > 0) {
          remindable.push(
            `branch ${branch} is ${behind} commit(s) behind ${REMOTE}/${MAIN} → git rebase ${REMOTE}/${MAIN} before pushing`,
          );
        }
      }
    }
  }

  const dirty = dirtyCount();
  if (dirty > 0) informational.push(`${dirty} uncommitted change(s) in the working tree`);

  return { branch, head, upstream, originMain, remindable, informational };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function sessionStart() {
  const before = { originMain: sha(`${REMOTE}/${MAIN}`), branches: remoteBranches() };
  const fetched = fetchRemote();
  const lines = [];

  if (!fetched.ok) {
    lines.push(
      `fetch from ${REMOTE} FAILED (${fetched.reason}) — offline or TLS problem; the report below uses the last fetched state`,
    );
  } else {
    const after = { originMain: sha(`${REMOTE}/${MAIN}`), branches: remoteBranches() };

    if (after.originMain && before.originMain !== after.originMain) {
      const range = before.originMain ? `${before.originMain}..${after.originMain}` : after.originMain;
      const n = before.originMain ? count(range) : null;
      lines.push(`${REMOTE}/${MAIN} MOVED to ${short(after.originMain)} (${n ?? '?'} new commit(s)):`);
      for (const l of shortLog(range, MAX_LOG_LINES)) lines.push(`  ${l}`);
      const followUp = before.originMain ? changedFollowUpPaths(range) : [];
      if (followUp.length) {
        lines.push(
          `  touches ${followUp.join(', ')} → after merging run the follow-ups from CLAUDE.md "Parallel work" (npx -y npm@11 ci / npm run prisma:deploy / prisma:seed, then restart start:dev)`,
        );
      }
    } else {
      lines.push(`${REMOTE}/${MAIN} unchanged (${short(after.originMain)})`);
    }

    const added = after.branches.filter((b) => !before.branches.includes(b));
    const removed = before.branches.filter((b) => !after.branches.includes(b));
    if (added.length) lines.push(`NEW remote branch(es): ${added.join(', ')}`);
    if (removed.length) lines.push(`remote branch(es) gone (merged or deleted): ${removed.join(', ')}`);
    const open = after.branches.filter((b) => b !== `${REMOTE}/${MAIN}`);
    lines.push(open.length ? `open remote branches: ${open.join(', ')}` : 'no open remote branches besides main');
    if (fetched.via === 'schannel') lines.push('(fetch needed http.sslBackend=schannel — KI-035)');
  }

  const st = localState();
  lines.push(
    `local: branch ${st.branch ?? '?'} @ ${short(st.head)}${st.upstream ? ` (upstream ${st.upstream})` : ''}`,
  );
  lines.push(...st.remindable, ...st.informational);
  return lines;
}

function stateFile() {
  const dir = gitDir();
  return dir ? join(dir, 'claude-git-sync.json') : null;
}

function stop() {
  const st = localState();
  if (st.remindable.length === 0) return null;

  const fingerprint = [st.branch, st.head, st.upstream, st.originMain].join(':');
  const file = stateFile();
  if (file) {
    try {
      if (existsSync(file)) {
        const prev = JSON.parse(readFileSync(file, 'utf8'));
        if (prev && prev.fingerprint === fingerprint) return null; // already reminded for this state
      }
    } catch {
      /* ignore a corrupt state file */
    }
    try {
      writeFileSync(file, JSON.stringify({ fingerprint, at: new Date().toISOString() }));
    } catch {
      /* read-only .git? then we just remind every time */
    }
  }
  return st.remindable;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const input = readStdinJson();
  const event = input.hook_event_name || process.argv[2] || '';

  if (!existsSync(join(PROJECT_DIR, '.git')) && !gitDir()) return; // not a git checkout

  if (event === 'SessionStart') {
    const lines = sessionStart();
    const text = lines.join('\n');
    process.stdout.write(
      JSON.stringify({
        systemMessage: `${TAG} ${lines.join(' · ')}`,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `${TAG} remote state at session start (read-only fetch; nothing was merged):\n${text}`,
        },
      }),
    );
    return;
  }

  if (event === 'Stop') {
    const lines = stop();
    if (lines && lines.length) {
      process.stdout.write(JSON.stringify({ systemMessage: `${TAG} ${lines.join(' · ')}` }));
    }
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${TAG} internal error (ignored): ${err && err.message ? err.message : err}\n`);
}
process.exitCode = 0;
