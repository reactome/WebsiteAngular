/**
 * Write rfd-snapshot.json: the path extensions Spring trusts, so the answers
 * that Java would mark `Content-Disposition: inline;filename=f.txt` are marked
 * here too (server.ts, downloadGuard).
 *
 *   CONTENT_SERVICE_LIB=<the ContentService webapp's WEB-INF/lib> \
 *   TOMCAT_LIB=<the Tomcat lib directory holding catalina.jar> \
 *     node tools/content-node/snapshot-rfd.ts
 *
 * Spring 5.3's AbstractMessageConverterMethodProcessor.safeExtension trusts an
 * extension on its own list (SAFE_EXTENSIONS, below), or one whose media type
 * is audio, image or video or ends in +xml. The media type is the servlet
 * container's mapping for `file.<ext>` -- Tomcat's defaults, which catalina.jar
 * carries as MimeTypeMappings.properties -- and, where that has none or says
 * application/octet-stream, spring-web's own mime.types. The two disagree on
 * some (`sub` is text to Tomcat, an image to Spring): Tomcat's wins, as Java
 * answered.
 *
 * WHEN TO RUN IT: when the deployed content service's Spring or Tomcat
 * changes.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'rfd-snapshot.json');
const LIB = process.env['CONTENT_SERVICE_LIB'];
const TOMCAT = process.env['TOMCAT_LIB'];
if (!LIB || !TOMCAT) {
  console.error(
    "CONTENT_SERVICE_LIB: the ContentService webapp's WEB-INF/lib; TOMCAT_LIB: Tomcat's lib directory"
  );
  process.exit(2);
}

/** AbstractMessageConverterMethodProcessor.SAFE_EXTENSIONS, Spring 5.3. */
const SAFE_EXTENSIONS = [
  'txt',
  'text',
  'yml',
  'properties',
  'csv',
  'json',
  'xml',
  'atom',
  'rss',
  'png',
  'jpe',
  'jpeg',
  'jpg',
  'gif',
  'wbmp',
  'bmp',
];

const entry = (jar: string, name: string) =>
  execFileSync('unzip', ['-p', jar, name], { encoding: 'utf8' });
const springWeb = readdirSync(LIB).find((name) => /^spring-web-\d.*\.jar$/.test(name));
if (!springWeb) throw new Error(`no spring-web jar in ${LIB}`);

const tomcat = new Map();
for (const line of entry(
  path.join(TOMCAT, 'catalina.jar'),
  'org/apache/catalina/startup/MimeTypeMappings.properties'
).split('\n')) {
  const text = line.trim();
  if (!text || text.startsWith('#') || !text.includes('=')) continue;
  const at = text.indexOf('=');
  tomcat.set(text.slice(0, at).trim().toLowerCase(), text.slice(at + 1).trim());
}
const spring = new Map();
for (const line of entry(path.join(LIB, springWeb), 'org/springframework/http/mime.types').split(
  '\n'
)) {
  const text = line.trim();
  if (!text || text.startsWith('#')) continue;
  const [type, ...extensions] = text.split(/\s+/);
  for (const extension of extensions)
    if (!spring.has(extension.toLowerCase())) spring.set(extension.toLowerCase(), type);
}

const safeType = (type: string) => {
  const [base = '', subtype = ''] = type.toLowerCase().split('/');
  return ['audio', 'image', 'video'].includes(base) || subtype.endsWith('+xml');
};
const safe = new Set(SAFE_EXTENSIONS);
for (const extension of new Set([...tomcat.keys(), ...spring.keys()])) {
  const container = tomcat.get(extension);
  const type =
    container && container !== 'application/octet-stream' ? container : spring.get(extension);
  if (type && safeType(type)) safe.add(extension);
}

writeFileSync(OUT, `${JSON.stringify({ safe: [...safe].sort() }, null, 1)}\n`);
console.log(`${OUT}: ${safe.size} safe extensions`);
