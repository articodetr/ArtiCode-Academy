// PMFA-T05 (part of TEST-231; roadmap §4o, D-R120, ADR-073) — the import
// boundaries of platform two-step verification, read from the sources:
//   (i)  the academy files the platform shares — the pure TOTP, sealing and
//        recovery-code helpers of src/auth/mfa/, and the pure rules PMFA-T02
//        reuses (mfa.rules.ts with localized-text.ts) — import nothing but
//        `node:*` modules and each other;
//   (ii) no file of src/platform/auth/mfa/ imports the academy Prisma client
//        (src/generated/prisma/) or anything of src/prisma/ — not even a type —
//        nor, `import type` aside, an academy service, module or controller or
//        an academy MFA file other than those pure helpers; and the runtime
//        import graph that starts in that folder never reaches any of them
//        either. The one academy service the platform shares by design is the
//        stateless Argon2id PasswordService (ADR-073 — PlatformAuthModule
//        provides it), the one file of src/prisma/ it reaches the client-free
//        database-checks.ts (through PlatformPrismaService, ADR-073).
// Spec files are not scanned: they never run in the platform process, and some
// import an academy service on purpose to compare (platform-token.service.spec.ts).
// The ADR-073 check of the session files stays in platform-sessions.rules.spec.ts.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** backend/src */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MFA_DIR = join(SRC, 'platform', 'auth', 'mfa');

/** The academy files the platform may import for MFA (D-R120) — all pure: `node:*` and each other only. */
const SHARED_PURE_FILES = [
  'auth/mfa/totp.ts',
  'auth/mfa/secret-box.ts',
  'auth/mfa/recovery-codes.ts',
  'auth/mfa/mfa.rules.ts',
  'authorization/localized-text.ts',
];
/** The one academy service the platform shares by design: Argon2id hashing without state (ADR-073). */
const SHARED_SERVICES = ['auth/password.service.ts'];
/** The one file of src/prisma/ the platform reaches — the database helpers moved out of the academy PrismaService (ADR-073). */
const SHARED_PRISMA_FILES = ['prisma/database-checks.ts'];
/** The production files of the platform MFA folder today (PMFA-T01, T02, T04) — a rename must not empty the scan. */
const KNOWN_MFA_FILES = [
  'platform/auth/mfa/platform-mfa-core.service.ts',
  'platform/auth/mfa/platform-mfa.controller.ts',
  'platform/auth/mfa/platform-mfa.dto.ts',
  'platform/auth/mfa/platform-mfa.service.ts',
  'platform/auth/mfa/platform-mfa-reset.ts',
];

/**
 * A static `import … from '…'`, `import '…'`, `export … from '…'` at the start
 * of a line (Prettier's layout; a commented-out import starts with `//`). The
 * clause may span lines but never holds a quote, `;`, `(`, `)` or `=`, so the
 * pattern cannot run through a class or function body.
 */
const STATIC_IMPORT = /^[ \t]*(?:import|export)\s+(type\s+)?(?:[^'"`;()=]*?\bfrom\s*)?(['"])([^'"\n]+)\2/gm;
/** `import('…')` and `require('…')` anywhere (a match in a comment can only make the check stricter). */
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\1/g;

interface ImportRef {
  specifier: string;
  /** `import type …` / `export type … from` — erased at runtime. */
  typeOnly: boolean;
}

function importsIn(source: string): ImportRef[] {
  return [
    ...[...source.matchAll(STATIC_IMPORT)].map((match) => ({ specifier: match[3]!, typeOnly: match[1] !== undefined })),
    ...[...source.matchAll(DYNAMIC_IMPORT)].map((match) => ({ specifier: match[2]!, typeOnly: false })),
  ];
}

const importsOf = (file: string): ImportRef[] => importsIn(readFileSync(file, 'utf8'));

/** A path under src/ with forward slashes. */
const fromSrc = (file: string): string => relative(SRC, file).split(sep).join('/');

const isRelative = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../');

/** The file a relative specifier names (`.js` → the `.ts` source), or null when it names none. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const target = resolve(dirname(fromFile), specifier);
  for (const candidate of [target.replace(/\.js$/, '.ts'), target, join(target, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Why a RUNTIME import of this file (a path under src/) crosses into the academy, or null. */
function academyReason(path: string): string | null {
  if (path.startsWith('generated/prisma/')) return 'the academy Prisma client';
  if (path.startsWith('prisma/') && !SHARED_PRISMA_FILES.includes(path)) return 'the academy PrismaService';
  if (path.startsWith('platform/') || path.startsWith('generated/platform/')) return null;
  if (path.startsWith('auth/mfa/') && !SHARED_PURE_FILES.includes(path)) return 'an academy MFA file other than the shared pure helpers (D-R120)';
  if (/\.(service|module|controller)\.ts$/.test(path) && !SHARED_SERVICES.includes(path)) return 'an academy service, module or controller (ADR-073)';
  return null;
}

/** The production .ts files of the platform MFA folder, at any depth. */
function platformMfaFiles(): string[] {
  return readdirSync(MFA_DIR, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .map((name) => join(MFA_DIR, name))
    .sort();
}

describe('platform MFA import boundaries (PMFA-T05, TEST-231)', () => {
  it('reads every kind of import statement — and nothing that is not one', () => {
    const sample = [
      "// import { Hidden } from './commented-out.js';",
      "import { a } from './a.js';",
      "import type { B } from './b.js';",
      'import {',
      '  c,',
      '  d,',
      "} from './cd.js';",
      "import Default, * as all from 'some-package';",
      "import './side-effect.js';",
      "export { e } from './e.js';",
      "export type { F } from './f.js';",
      "export * from './g.js';",
      "export const NOT_AN_IMPORT = 'from here';",
      'export class Holder {',
      "  constructor(private readonly origin: string) {} // copied from './not-an-import.js'",
      '}',
      "const later = await import('./h.js');",
      "const legacy = require('./i.js');",
    ].join('\n');
    expect(importsIn(sample).map((ref) => `${ref.typeOnly ? 'type ' : ''}${ref.specifier}`)).toEqual([
      './a.js',
      'type ./b.js',
      './cd.js',
      'some-package',
      './side-effect.js',
      './e.js',
      'type ./f.js',
      './g.js',
      './h.js',
      './i.js',
    ]);
  });

  it('(i) the shared academy helpers (totp, secret-box, recovery-codes, mfa.rules, localized-text) import only node:* modules and each other', () => {
    const violations: string[] = [];
    const seen: Record<string, string[]> = {};
    for (const path of SHARED_PURE_FILES) {
      const file = join(SRC, path);
      const refs = importsOf(file);
      seen[path] = refs.map((ref) => ref.specifier);
      for (const ref of refs) {
        if (ref.specifier.startsWith('node:')) continue;
        const target = isRelative(ref.specifier) ? resolveRelative(file, ref.specifier) : null;
        if (target === null || !SHARED_PURE_FILES.includes(fromSrc(target))) {
          violations.push(`${path} imports '${ref.specifier}'${ref.typeOnly ? ' (type)' : ''}`);
        }
      }
    }
    expect(violations).toEqual([]);
    // The scan really reads them: the three crypto helpers each import node:crypto, the rules their localized-text helper.
    for (const path of ['auth/mfa/totp.ts', 'auth/mfa/secret-box.ts', 'auth/mfa/recovery-codes.ts']) expect(seen[path], path).toContain('node:crypto');
    expect(seen['auth/mfa/mfa.rules.ts']).toContain('../../authorization/localized-text.js');
  });

  it('(ii) no file of src/platform/auth/mfa/ imports the academy Prisma client, src/prisma/, an academy service, module or controller, or a non-pure academy MFA file', () => {
    const files = platformMfaFiles();
    expect(files.map(fromSrc)).toEqual(expect.arrayContaining(KNOWN_MFA_FILES));
    const violations: string[] = [];
    const unresolved: string[] = [];
    let academyImports = 0;
    for (const file of files) {
      for (const ref of importsOf(file)) {
        if (!isRelative(ref.specifier)) continue;
        const target = resolveRelative(file, ref.specifier);
        if (target === null) {
          unresolved.push(`${fromSrc(file)}: '${ref.specifier}'`);
          continue;
        }
        const path = fromSrc(target);
        if (!path.startsWith('platform/')) academyImports += 1;
        // Not even a type: the platform has its own client (src/generated/platform) and PlatformPrismaService.
        const reason =
          path.startsWith('generated/prisma/') || path.startsWith('prisma/')
            ? 'the academy database layer'
            : ref.typeOnly
              ? null
              : academyReason(path);
        if (reason) violations.push(`${fromSrc(file)} imports '${ref.specifier}' → ${path} (${reason})`);
      }
    }
    expect(unresolved).toEqual([]);
    expect(violations).toEqual([]);
    // The scan sees the shared imports the folder does have (totp, secret-box, …), so a pass is not an empty scan.
    expect(academyImports).toBeGreaterThan(0);
  });

  it('(ii) the runtime import graph that starts in src/platform/auth/mfa/ never reaches the academy client, PrismaService, or an academy service, module or controller', () => {
    const roots = platformMfaFiles();
    const parentOf = new Map<string, string | null>(roots.map((file) => [file, null]));
    const queue = [...roots];
    const violations: string[] = [];
    const unresolved: string[] = [];
    const chainOf = (file: string): string => {
      const chain: string[] = [];
      for (let at: string | null | undefined = file; at; at = parentOf.get(at)) chain.unshift(fromSrc(at));
      return chain.join(' → ');
    };
    while (queue.length > 0) {
      const file = queue.shift()!;
      const path = fromSrc(file);
      const reason = academyReason(path);
      if (reason) violations.push(`${chainOf(file)} (${reason})`);
      // The generated platform client imports only its own runtime; it is not walked.
      if (path.startsWith('generated/')) continue;
      for (const ref of importsOf(file)) {
        if (ref.typeOnly || !isRelative(ref.specifier)) continue;
        const target = resolveRelative(file, ref.specifier);
        if (target === null) unresolved.push(`${path}: '${ref.specifier}'`);
        else if (!parentOf.has(target)) {
          parentOf.set(target, file);
          queue.push(target);
        }
      }
    }
    expect(unresolved).toEqual([]);
    expect(violations).toEqual([]);
    // The walk goes past the folder: a file reached only through another one, and the platform's own client.
    expect([...parentOf.keys()].map(fromSrc)).toEqual(
      expect.arrayContaining(['authorization/localized-text.ts', 'platform/prisma/platform-prisma.service.ts', 'generated/platform/client.ts']),
    );
  });
});
