/**
 * Write case-snapshot.json: Character.toUpperCase and toLowerCase for every
 * UTF-16 unit that either changes, as the content service's JVM has them --
 * what String.CASE_INSENSITIVE_ORDER compares by (service.mjs,
 * caseInsensitive).
 *
 *   JAVA=<the java the content service runs on> node tools/content-node/snapshot-case.mjs
 *
 * JavaScript's own case mapping is not used: it is the full mapping (ß is SS,
 * İ is i plus a dot) and the Unicode version of Node's ICU, which maps
 * characters the service's JVM leaves alone -- 168 of them on 15 Oct 2026.
 *
 * WHEN TO RUN IT: when the content service's JVM changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'case-snapshot.json');
const JAVA = process.env.JAVA;
if (!JAVA) {
  console.error('JAVA: the java executable the content service runs on');
  process.exit(2);
}

const dir = mkdtempSync(path.join(tmpdir(), 'case-'));
try {
  const source = path.join(dir, 'Cases.java');
  writeFileSync(
    source,
    `public class Cases { public static void main(String[] a) {
       StringBuilder b = new StringBuilder();
       for (int c = 0; c < 0x10000; c++)
         b.append(Integer.toHexString(Character.toUpperCase((char) c))).append(' ')
          .append(Integer.toHexString(Character.toLowerCase((char) c))).append('\\n');
       System.out.print(b); } }`
  );
  // A single source file runs without compiling first (JDK 11+).
  const lines = execFileSync(JAVA, [source], { encoding: 'utf8', maxBuffer: 1 << 24 })
    .trim()
    .split('\n');
  const upper = [];
  const lower = [];
  lines.forEach((line, unit) => {
    const [up, low] = line.split(' ').map((hex) => parseInt(hex, 16));
    if (up !== unit) upper.push(unit, up);
    if (low !== unit) lower.push(unit, low);
  });
  writeFileSync(OUT, `${JSON.stringify({ upper, lower })}\n`);
  console.log(`${OUT}: ${upper.length / 2} upper and ${lower.length / 2} lower mappings`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
