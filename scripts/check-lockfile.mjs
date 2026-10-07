/**
 * Fail when `package-lock.json` quietly re-resolves the dependency tree.
 *
 * A first attempt at regenerating the lockfile for the Node 24 move deleted the
 * file and let npm resolve from scratch. Preflight then said:
 *
 *     lockfile in sync (npm ci)          ok
 *     format / types / lint / dead code  ok
 *     unit tests                         ok
 *     diagram + download smoke           ok
 *     All clear. CI should agree.
 *
 * That lockfile carried **207 top-level version changes**: react 18.3.1 -> 19.3.0,
 * @angular-devkit 21.2.24 -> 22.1.8, vite 6.4.3 -> 7.3.6, uuid 8.3.2 -> 14.0.2,
 * and downgrades including clsx 2.1.1 -> 1.2.1 and @types/node 25.2.0 -> 22.20.3.
 * Every gate passed it, because every gate asks whether the app still behaves --
 * and it did, on one machine, on one afternoon. The lockfile that actually
 * shipped changed no package's version at all: 91 optional platform entries
 * added, none removed, none changed.
 *
 * `npm ci --dry-run` does not help here. It compares the lockfile against
 * package.json, and a wholesale re-resolution satisfies package.json perfectly.
 * Nor does review: the diff is around 6,000 lines and a reviewer confirms that it
 * looks like a lockfile, which it does.
 *
 * ## What it compares
 *
 * Package **name -> set of versions**, gathered from every path in `packages`,
 * against the same bag at the merge base.
 *
 * Every path, not just top level. npm hoists: the same package appears at
 * `node_modules/x` in one resolution and at `node_modules/a/node_modules/x` in
 * another. This tree has 2,322 entries of which 482 are nested, so a top-level
 * comparison can report "nothing changed" for a tree that was entirely
 * re-resolved. That is the failure mode this exists to stop, so the naive
 * version of the check would reproduce the bug it is meant to catch.
 *
 * It fails on **loss**: a package gone, or a version no longer present. Additions
 * pass quietly -- that is what installing something looks like. Adding a version
 * while keeping the old one is how npm records a second copy for a peer, which is
 * noise rather than news.
 *
 * ## Deliberately opt-out-able
 *
 * Bumping a dependency is a legitimate thing to do; doing it without noticing is
 * not. `LOCKFILE_BUMP=1` says you meant it.
 *
 * Usage:  node scripts/check-lockfile.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const LOCK = 'package-lock.json';

/**
 * `git` without a shell, so a branch name cannot become an argument.
 *
 * `maxBuffer` is set explicitly because Node defaults it to 1 MiB and this
 * lockfile is already 818 KiB. Crossing that line would make `git show` throw
 * ENOBUFS, which reads exactly like "no lockfile at the base" -- so the check
 * would pass while checking nothing, which is the failure it exists to catch.
 */
function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * name -> Set(versions), across every path in `packages`.
 *
 * The name comes from the path after the last `node_modules/`, which is what
 * makes a hoisted entry and a nested one the same package. The root entry ("")
 * is the project itself and has no name to speak of.
 */
function bag(lock) {
  const out = new Map();
  for (const [where, entry] of Object.entries(lock.packages ?? {})) {
    if (!where || !where.includes('node_modules/')) continue;
    if (!entry?.version) continue;
    const name =
      entry.name ?? where.slice(where.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(entry.version);
  }
  return out;
}

if (!existsSync(LOCK)) {
  console.log('  no package-lock.json; nothing to compare');
  process.exit(0);
}

// The merge base, not `origin/main` itself: on a branch that has not been
// rebased, comparing against the tip reports every dependency change made on
// main since the branch started as though this branch had made it.
//
// `LOCKFILE_BASE` names a ref to compare against instead. It exists so this can
// be tested against a commit chosen on purpose, and so CI could pass the base
// of a pull request without this having to know how CI describes one.
let base = process.env.LOCKFILE_BASE;
for (const candidate of base ? [] : ['origin/main', 'main']) {
  try {
    base = git('merge-base', candidate, 'HEAD');
    break;
  } catch {
    // Not fetched, or no such ref. Try the next.
  }
}
if (!base) {
  console.log('  no merge base with main; nothing to compare');
  process.exit(0);
}

// Prove the base is a commit before asking for a file from it. `git show` says
// "path 'package-lock.json' exists on disk, but not in '<ref>'" for a bogus ref
// and for a commit that genuinely predates the file -- the same sentence, word
// for word -- so the message cannot be used to tell a typo from a fresh repo.
try {
  base = git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
} catch {
  console.error(`\n  ${base} is not a commit, so there is nothing to compare against.`);
  console.error('  Check LOCKFILE_BASE, or fetch the branch it names.\n');
  process.exit(1);
}

let before;
try {
  before = JSON.parse(git('show', `${base}:${LOCK}`));
} catch (error) {
  // Only one reason to carry on quietly: the file genuinely was not there yet.
  // Anything else -- a bad ref, a buffer limit, a corrupt object -- has to be
  // loud, because a silent pass here is indistinguishable from a real check.
  const why = `${error.stderr ?? ''}${error.message ?? ''}`;
  if (/does not exist|exists on disk, but not in|unknown revision/i.test(why)) {
    console.log(`  ${LOCK} is not in ${base.slice(0, 7)}; nothing to compare`);
    process.exit(0);
  }
  console.error(
    `\n  could not read ${LOCK} at ${base.slice(0, 7)}: ${(why || 'unknown error').trim()}`
  );
  process.exit(1);
}

let after;
try {
  after = JSON.parse(readFileSync(LOCK, 'utf8'));
} catch (error) {
  console.error(`\n  ${LOCK} is not valid JSON: ${error.message}`);
  process.exit(1);
}
const was = bag(before);
const now = bag(after);

const removed = [];
const lost = [];
for (const [name, versions] of was) {
  const current = now.get(name);
  if (!current) {
    removed.push(`${name} (was ${[...versions].sort().join(', ')})`);
    continue;
  }
  const gone = [...versions].filter((v) => !current.has(v));
  if (gone.length) {
    lost.push(`${name}: ${gone.sort().join(', ')} -> ${[...current].sort().join(', ')}`);
  }
}

const added = [...now.keys()].filter((name) => !was.has(name)).length;

if (removed.length === 0 && lost.length === 0) {
  const note = added ? `, ${added} package${added === 1 ? '' : 's'} added` : '';
  console.log(`  no dependency lost a version${note}`);
  process.exit(0);
}

const total = removed.length + lost.length;
console.error(
  `\n  ${total} package${total === 1 ? '' : 's'} lost a version against ${base.slice(0, 7)}:\n`
);
for (const line of [
  ...removed.map((r) => `removed  ${r}`),
  ...lost.map((l) => `changed  ${l}`),
].slice(0, 30)) {
  console.error(`    ${line}`);
}
if (total > 30) console.error(`    ... and ${total - 30} more`);

if (process.env.LOCKFILE_BUMP === '1') {
  console.error('\n  LOCKFILE_BUMP=1 is set, so this is a deliberate bump. Allowing it.');
  process.exit(0);
}

console.error(
  '\n  If you meant to change dependencies, re-run with LOCKFILE_BUMP=1 and say so in the\n' +
    '  commit message. If you did not, you probably regenerated the lockfile by deleting\n' +
    '  it; restore it with `git checkout <base> -- package-lock.json` and add packages with\n' +
    '  `npm install <pkg>` instead, which preserves the resolutions it does not need to touch.\n'
);
process.exit(1);
