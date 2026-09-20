/**
 * Compare the node port against the Java service, response by response.
 *
 * This is the safety net the port depends on. Reimplementing queries against a
 * graph is not hard to do plausibly and very hard to do identically: a nested
 * projection that differs by one field renders a page that looks right and is
 * wrong. So no endpoint is switched on in `proxy.conf.js` until this reports no
 * differences over a corpus.
 *
 *   npm run content:diff                    # every implemented endpoint
 *   npm run content:diff -- --ids R-HSA-109606,R-HSA-73894
 *   npm run content:diff -- --path /ContentService/data/database/version
 *
 * Java is the reference. Where they differ, the node side is wrong until someone
 * shows otherwise -- which has to be argued in a commit message, not assumed at
 * a terminal.
 */
import { endpoints } from './service.mjs';

const JAVA = process.env.JAVA_CONTENT_SERVICE || 'http://localhost:8080';
const NODE = process.env.NODE_CONTENT_SERVICE || 'http://127.0.0.1:4400';

function flag(name, fallback = '') {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? (process.argv[at + 1] ?? fallback) : fallback;
}

/** Fetch one path from both, as text plus content type. */
async function fetchBoth(path) {
  const get = async (base) => {
    const response = await fetch(base + path, { redirect: 'follow' });
    return {
      status: response.status,
      type: (response.headers.get('content-type') || '').split(';')[0].trim(),
      body: await response.text(),
    };
  };
  const [java, node] = await Promise.all([get(JAVA), get(NODE)]);
  return { java, node };
}

/**
 * Where two responses differ, described so a person can act on it.
 *
 * JSON is compared as data rather than as text: key order and whitespace are not
 * part of the contract, and treating them as differences would bury the ones
 * that matter.
 *
 * An endpoint may declare differences it means to have, as `differs` -- a list
 * of patterns. Parity is the default and a deliberate improvement has to be
 * written down next to the code that makes it, so that "the diff is green"
 * keeps meaning "nothing changed that nobody chose".
 *
 * An endpoint whose response is a JSON array in no particular order may also
 * give `unordered`, a key for each element. Both sides are then sorted by that
 * key before comparing, and the fact that the order differs is reported as a
 * single problem the endpoint can declare. Without this, declaring "order is
 * not part of the contract" means writing a pattern that matches every
 * element-level difference -- which would hide a wrong count as readily as a
 * shuffled one, and turn the safety net into a green light. Sorting instead
 * keeps all 999 entries compared field by field.
 */
function differences(path, java, node, endpoint) {
  const problems = [];
  if (java.status !== node.status) {
    problems.push(`status ${node.status}, java says ${java.status}`);
  }
  if (java.type !== node.type) {
    problems.push(`content-type "${node.type}", java says "${java.type}"`);
  }

  const asJson = (side) => {
    try {
      return JSON.parse(side.body);
    } catch {
      return undefined;
    }
  };
  const javaJson = asJson(java);
  const nodeJson = asJson(node);

  if (javaJson !== undefined && nodeJson !== undefined) {
    if (endpoint?.unordered && Array.isArray(javaJson) && Array.isArray(nodeJson)) {
      const by = endpoint.unordered;
      const order = (list) => list.map((item) => JSON.stringify(by(item)));
      if (String(order(javaJson)) !== String(order(nodeJson))) {
        problems.push(`order differs from java's`);
      }
      const sorted = (list) =>
        [...list].sort((a, b) => (JSON.stringify(by(a)) < JSON.stringify(by(b)) ? -1 : 1));
      problems.push(...compare(sorted(javaJson), sorted(nodeJson), ''));
    } else {
      problems.push(...compare(javaJson, nodeJson, ''));
    }
  } else if (java.body.trim() !== node.body.trim()) {
    problems.push(`body "${node.body.slice(0, 60)}", java says "${java.body.slice(0, 60)}"`);
  }

  return problems.map((p) => `${path}: ${p}`);
}

/**
 * Deep comparison that names the field rather than dumping both documents.
 *
 * It stops at a ceiling so a wholly different response does not print a novel,
 * but the ceiling is well above the handful shown. It used to be twelve, and
 * that was a hole: `/content/toc` declares thirteen intended differences, so
 * comparison stopped before reaching them and a real difference at the five
 * hundredth pathway could never have been reported. Declared differences must
 * not be able to crowd out undeclared ones.
 */
const CEILING = 2000;
function compare(expected, actual, at, found = []) {
  if (found.length > CEILING) return found;
  const where = at || '(root)';

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      found.push(`${where}: one is an array and the other is not`);
      return found;
    }
    if (expected.length !== actual.length) {
      found.push(`${where}: ${actual.length} items, java has ${expected.length}`);
    }
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
      compare(expected[i], actual[i], `${at}[${i}]`, found);
    }
    return found;
  }

  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (!(key in actual)) found.push(`${at}.${key}: missing (java has it)`);
      else if (!(key in expected)) found.push(`${at}.${key}: extra (java does not have it)`);
      else compare(expected[key], actual[key], `${at}.${key}`, found);
    }
    return found;
  }

  if (expected !== actual) {
    found.push(`${where}: ${JSON.stringify(actual)}, java says ${JSON.stringify(expected)}`);
  }
  return found;
}

/** The paths to compare: every implemented endpoint, expanded over any ids given. */
function paths() {
  const only = flag('path');
  const ids = flag('ids')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const chosen = only ? endpoints.filter((e) => e.path === only) : endpoints;

  return chosen.flatMap((endpoint) =>
    endpoint.path.includes('{id}')
      ? ids.map((id) => endpoint.path.replace('{id}', id))
      : [endpoint.path]
  );
}

async function main() {
  const list = paths();
  if (!list.length) {
    console.log('  nothing to compare');
    return;
  }
  console.log(`  comparing ${list.length} path(s)`);
  console.log(`    java: ${JAVA}`);
  console.log(`    node: ${NODE}\n`);

  const problems = [];
  // One at a time. Both services read the same database, and this must not be
  // what makes the site slow while curators are testing.
  for (const path of list) {
    try {
      const { java, node } = await fetchBoth(path);
      const endpoint = endpoints.find((e) => path.startsWith(e.path.split('{')[0]));
      const found = differences(path, java, node, endpoint);
      const declared = endpoint?.differs ?? [];
      const expected = found.filter((problem) => declared.some((rule) => rule.test(problem)));
      const unexpected = found.filter((problem) => !expected.includes(problem));
      problems.push(...unexpected);
      console.log(`  ${unexpected.length ? '✗' : '✓'} ${path}`);
      for (const problem of unexpected.slice(0, 12)) console.log(`      ${problem}`);
      if (unexpected.length > 12) {
        console.log(`      ... and ${unexpected.length - 12} more`);
      }
      if (expected.length) {
        // Said out loud rather than hidden. A declared difference that stops
        // appearing is news too -- it means the improvement was lost.
        console.log(`      (${expected.length} declared difference(s), as intended)`);
      }
    } catch (failure) {
      problems.push(`${path}: ${failure.message}`);
      console.log(`  ✗ ${path}\n      ${failure.message}`);
    }
  }

  console.log(
    `\n  ${list.length - new Set(problems.map((p) => p.split(':')[0])).size} of ${list.length} identical`
  );
  process.exitCode = problems.length ? 1 : 0;
}

await main();
