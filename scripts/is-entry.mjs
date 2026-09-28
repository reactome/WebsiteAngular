/**
 * Whether the module at `moduleUrl` is the script node was asked to run.
 *
 * The checkers export their logic for tests and run it only when executed. The
 * usual test, `import.meta.url === pathToFileURL(process.argv[1]).href`, is
 * false whenever the path to the script goes through a symlink: node resolves
 * the module's own URL to the real file, and argv[1] is left as typed. The
 * check then never runs, prints nothing, and exits 0 -- a gate that passes by
 * not looking. Both sides are compared as real paths.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isEntry(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
