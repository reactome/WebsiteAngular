#!/usr/bin/env node
/**
 * The library-update workflow's guard: after `npm update` of the
 * ngx-reactome-base libraries, only their own lockfile entries may differ from
 * the committed lockfile. Anything else moving is npm re-resolving the tree,
 * which a pin update must never carry in with it (see check-lockfile.mjs for
 * what that cost once).
 *
 * Exits 1 naming the stray entries; otherwise prints what moved, if anything.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isEntry } from '../../scripts/is-entry.mjs';

export const LIBRARIES = ['ngx-reactome-cytoscape-style', 'ngx-reactome-style'];

/** Lockfile entries that differ, split into the libraries' and the rest. */
export function compare(before, after, libraries = LIBRARIES) {
  const allowed = new Set(libraries.map((l) => `node_modules/${l}`));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const moved = [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return {
    updated: moved.filter((k) => allowed.has(k)),
    stray: moved.filter((k) => !allowed.has(k)),
  };
}

if (isEntry(import.meta.url)) {
  const before = JSON.parse(execFileSync('git', ['show', 'HEAD:package-lock.json'])).packages;
  const after = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages;
  const { updated, stray } = compare(before, after);
  if (stray.length) {
    console.error(`npm update changed more than the libraries:\n  ${stray.join('\n  ')}`);
    process.exit(1);
  }
  console.log(updated.length ? `Updated: ${updated.join(', ')}` : 'Already on the newest builds.');
}
