/**
 * Write domain-snapshot.json: what the Java content service's Jackson and
 * Spring Data Neo4j make of each graph-core class, read from the deployed
 * libraries rather than restated (see domain.mjs for how it is used).
 *
 *   JAVA_HOME=<a JDK 21> CONTENT_SERVICE_LIB=<the ContentService webapp's WEB-INF/lib> \
 *     node tools/content-node/snapshot-domain.mjs
 *
 * Two sources, both the libraries themselves:
 *
 *  - snapshot-domain/DomainSnapshot.java, run against the webapp's jars, asks
 *    Jackson for each class's serializer (properties, order, views) and SDN's
 *    mapping context for each class's fields (graph names, relationships,
 *    collection kinds, constructor defaults).
 *  - javap, for what each serialized getter does. A getter whose body -- or,
 *    for one AspectJ wove, its original `_aroundBody` -- is `return this.f`
 *    is recorded as reading field `f`, whatever its name (getISBN reads ISBN,
 *    RegulationReference.getRegulatedBy reads `regulation`). Any other getter
 *    must be one domain.mjs implements; the script stops on one that is not,
 *    so a getter graph-core adds cannot be written as a field it is not.
 *
 * WHEN TO RUN IT: when graph-core changes in the deployed content service --
 * the same trigger as schema.ts and snapshot-schema.mjs. JDK 21 compiles
 * and runs it (--release is left at the JDK's own).
 *
 * THEN: run the diff harness over /data/query/{id} before committing. Jackson
 * puts the getter-only properties (className, schemaClass, inputs...) in the
 * order the JVM lists methods, which differs from one run to the next
 * (domain.mjs, writeDomain). So the order is kept from the committed snapshot
 * for every class whose properties are unchanged (keepVerifiedOrder), and the
 * script names the classes it could not keep: their order is this run's, and
 * only the harness can say whether it is the running Java's. The snapshot
 * committed on 15 Oct 2026 matched Java byte for byte in the default view over
 * 20,279 objects.
 *
 * Shape: `json` maps each concrete class to the properties Jackson writes, as
 * positions in `properties`, each [name, source, views] (+ "D" for a
 * floating-point value). `source` is a field name, or `Class.getter` for a
 * computed getter. `views` is a bit mask of domain.mjs's VIEW. `graph` maps
 * each class SDN knows to its `fields`, as positions in `fields`, each
 * [field, graph property] or [field, type, direction, target, collection,
 * relationship class] -- plus `defaults` and, for a relationship class, the
 * `type` its getType() returns. `interfaces` names the interfaces SDN maps,
 * and `store` lists the concrete classes as
 * [class, static labels] in the order SDN searches them when a relationship's
 * target is an interface (domain.mjs, classFor).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPUTED_GETTERS } from './domain.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'domain-snapshot.json');
const LIB = process.env.CONTENT_SERVICE_LIB;
if (!LIB) {
  console.error("CONTENT_SERVICE_LIB: the deployed ContentService webapp's WEB-INF/lib");
  process.exit(2);
}
const BIN = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '';
const tool = (name) => (BIN ? path.join(BIN, name) : name);
const run = (name, args, cwd) =>
  execFileSync(tool(name), args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const DOMAIN = 'org/reactome/server/graph/domain/';

const work = mkdtempSync(path.join(tmpdir(), 'snapshot-domain-'));
try {
  const jar = readdirSync(LIB).find((name) => /^graph-core-.*\.jar$/.test(name));
  if (!jar) throw new Error(`no graph-core jar in ${LIB}`);
  run('jar', ['xf', path.join(LIB, jar), `${DOMAIN}model`, `${DOMAIN}relationship`], work);
  const classes = ['model', 'relationship'].flatMap((folder) =>
    readdirSync(path.join(work, DOMAIN, folder))
      .filter((name) => name.endsWith('.class') && !name.includes('$'))
      .map((name) => `${DOMAIN}${folder}/${name.slice(0, -6)}`.replaceAll('/', '.'))
  );
  // Has.Util.wrapUniqueElements wraps a plain relationship as this, for composedOf.
  const wrapper = `${DOMAIN}relationship/Has$Default`.replaceAll('/', '.');
  // The content service's own: what /query/enhanced/v2 writes a reference
  // entity as (domain.mjs, summaryEntity). In the webapp's classes, not a jar.
  const CLASSES = path.join(LIB, '..', 'classes');
  const summary = 'org.reactome.server.service.model.graph.SummaryEntity';

  const build = path.join(work, 'build');
  run('javac', [
    '-proc:none',
    '-d',
    build,
    '-cp',
    `${LIB}/*`,
    path.join(HERE, 'snapshot-domain', 'DomainSnapshot.java'),
  ]);
  const dump = JSON.parse(
    run('java', [
      '-cp',
      [build, CLASSES, `${LIB}/*`].join(path.delimiter),
      'DomainSnapshot',
      ...classes,
      wrapper,
      '--serialised-only',
      summary,
    ])
  );

  const bodies = methodBodies(
    run('javap', [
      '-c',
      '-p',
      '-cp',
      [work, CLASSES].join(path.delimiter),
      ...classes,
      wrapper,
      summary,
    ])
  );
  const computed = new Set(COMPUTED_GETTERS);
  const json = {};
  for (const [schemaClass, properties] of Object.entries(dump.json)) {
    json[schemaClass] = properties.map(([name, member, declaredBy, views, floating]) => {
      const key = `${declaredBy}.${member}`;
      const field = fieldRead(bodies, declaredBy, member);
      let source;
      if (computed.has(key)) source = key;
      else if (member === 'getType' && dump.graph[schemaClass]?.type) source = key;
      else if (field) source = field;
      else
        throw new Error(
          `${schemaClass}.${name}: ${key} computes its value; implement it in domain.mjs`
        );
      // Has.Default and SummaryEntity are built in code, not mapped from the graph.
      if (source === field && schemaClass !== 'Default' && schemaClass !== 'SummaryEntity') {
        const mapped = dump.graph[schemaClass]?.fields.some(([fieldName]) => fieldName === field);
        if (!mapped)
          throw new Error(`${schemaClass}.${name}: reads ${field}, which SDN does not map`);
      }
      return floating ? [name, source, views, 'D'] : [name, source, views];
    });
  }
  const unsettled = keepVerifiedOrder(json);
  for (const key of computed) {
    const [declaredBy, member] = key.split('.');
    if (!bodies.has(`${declaredBy}.${member}`))
      throw new Error(`domain.mjs implements ${key}, which graph-core does not have`);
  }

  // Every getter /data/query/{id}/{attributeName} can reach, by the lower
  // case of its name: what it reads (a field), a getter domain.mjs computes,
  // a constant it returns, Object.getClass, or -- for one that takes
  // arguments -- what invoking it with none does. Any other is left as
  // `unported`, named below; service.mjs answers no attribute that reaches one.
  const getters = {};
  const unported = new Set();
  // Only a model class can be the object a request names; a relationship
  // class (HasEvent, ComponentOf...) is reached only through one.
  const modelClasses = new Set(
    classes.filter((name) => name.includes('.model.')).map((name) => name.split('.').pop())
  );
  for (const [schemaClass, methods] of Object.entries(dump.getters)) {
    if (!modelClasses.has(schemaClass)) continue;
    getters[schemaClass] = methods
      .map(([name, declaredBy, parameters, returns, element, projected, fresh]) => {
        const key = `${declaredBy}.${name}`;
        let source;
        if (parameters > 0) source = { arguments: parameters };
        else if (key === 'Object.getClass') source = key;
        else if (computed.has(key)) source = key;
        else if (fieldRead(bodies, declaredBy, name)) source = fieldRead(bodies, declaredBy, name);
        // The constant as Java returns it (DomainSnapshot calls the getter):
        // javap's listing of it escapes quotes and trims trailing spaces.
        else if (constantRead(bodies, declaredBy, name) !== undefined && fresh !== null)
          source = { constant: fresh };
        else {
          source = { unported: key };
          unported.add(key);
        }
        return [name.toLowerCase(), name, source, returns, element, projected];
      })
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  const graph = {};
  for (const [schemaClass, entry] of Object.entries(dump.graph)) {
    const defaults = Object.fromEntries(
      Object.entries(entry.defaults ?? {}).filter(([field]) =>
        entry.fields.some(([name]) => name === field)
      )
    );
    graph[schemaClass] = {
      ...(entry.type ? { type: entry.type } : {}),
      ...(Object.keys(defaults).length ? { defaults } : {}),
      fields: entry.fields,
    };
  }

  // Only concrete classes can be chosen; the rest are kept out of the file.
  const store = dump.store
    .filter(([, kind]) => kind === 'concrete')
    .map(([name, , labels]) => [name, labels]);
  const { interfaces } = dump;

  // Most entries repeat in every subclass, so each distinct one is stored once
  // and classes list their positions: 218KB written out whole, 55KB this way.
  const intern = (table, index) => (entry) => {
    const key = JSON.stringify(entry);
    if (!index.has(key)) index.set(key, table.push(entry) - 1);
    return index.get(key);
  };
  const properties = [];
  const property = intern(properties, new Map());
  const fields = [];
  const field = intern(fields, new Map());
  const jsonByIndex = Object.fromEntries(
    Object.entries(json).map(([name, entries]) => [name, entries.map(property)])
  );
  const graphByIndex = Object.fromEntries(
    Object.entries(graph).map(([name, entry]) => [
      name,
      { ...entry, fields: entry.fields.map(field) },
    ])
  );
  const getterEntries = [];
  const getterEntry = intern(getterEntries, new Map());
  const gettersByIndex = Object.fromEntries(
    Object.entries(getters).map(([name, entries]) => [name, entries.map(getterEntry)])
  );
  // One entry per line, so a change to the model is a readable diff.
  const list = (items) => items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  const map = (object) =>
    Object.entries(object)
      .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      .join(',\n');
  writeFileSync(
    OUT,
    `{\n` +
      `  "properties": [\n${list(properties)}\n  ],\n  "json": {\n${map(jsonByIndex)}\n  },\n` +
      `  "fields": [\n${list(fields)}\n  ],\n  "graph": {\n${map(graphByIndex)}\n  },\n` +
      `  "getterEntries": [\n${list(getterEntries)}\n  ],\n` +
      `  "getters": {\n${map(gettersByIndex)}\n  },\n` +
      `  "interfaces": ${JSON.stringify(interfaces)},\n  "store": [\n${list(store)}\n  ]\n}\n`
  );
  console.log(
    `${OUT}: ${Object.keys(json).length} classes written, ${Object.keys(graph).length} mapped`
  );
  if (unported.size)
    console.log(
      `getters not yet answered under /data/query/{id}/{attributeName}: ${[...unported].sort().join(', ')}`
    );
  if (unsettled.length)
    console.log(
      `property order taken from this JVM, not yet checked against Java: ${unsettled.join(', ')}`
    );
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * Keep each class's property order as the committed snapshot has it, where
 * the class writes the same properties as before.
 *
 * Jackson orders getter-only properties (className, inDisease, inputs...) as
 * the JVM lists methods, and that changes from one run to the next, on any
 * JDK: two runs on the same one put PhysicalEntity's `inDisease` in two
 * places. The committed order is the one the diff harness showed to be the
 * live service's, so a regeneration that only reshuffles must not move it.
 * Returns the classes whose properties changed, whose new order is this run's
 * and has to be checked against Java (see THEN, above).
 */
function keepVerifiedOrder(json) {
  let previous;
  try {
    const stored = JSON.parse(readFileSync(OUT, 'utf8'));
    previous = Object.fromEntries(
      Object.entries(stored.json).map(([name, positions]) => [
        name,
        positions.map((position) => stored.properties[position][0]),
      ])
    );
  } catch {
    return Object.keys(json);
  }
  const unsettled = [];
  for (const [name, properties] of Object.entries(json)) {
    const before = previous[name];
    const same =
      before?.length === properties.length &&
      properties.every(([property]) => before.includes(property));
    if (!same) {
      unsettled.push(name);
      continue;
    }
    properties.sort((a, b) => before.indexOf(a[0]) - before.indexOf(b[0]));
  }
  return unsettled;
}

/** Each method's instructions, by `Class.method`, from javap -c -p over many classes. */
function methodBodies(text) {
  const bodies = new Map();
  for (const section of text.split(/^Compiled from .*$/m).slice(1)) {
    const declaration = section.match(/^[^\n{]*\b(?:class|interface) ([\w.$]+)/m);
    if (!declaration) continue;
    const owner = declaration[1].split('.').pop().split('$').pop();
    const method = /^ {2}[^\n(]*?([\w$]+)\(([^)]*)\)[^\n]*;\n {4}Code:\n((?: {6}[^\n]*\n)*)/gm;
    for (const [, name, parameters, code] of section.matchAll(method)) {
      const instructions = [
        ...code.matchAll(/^\s+\d+: (\w+)(?:[^\n]*\/\/ (?:Field ([\w$]+):|String ([^\n]*)))?/gm),
      ].map(([, op, field, text]) => ({ op, field, text }));
      const key = `${owner}.${name}`;
      // Overloads: keep the one without parameters (a getter), or the first.
      if (!bodies.has(key) || parameters === '') bodies.set(key, instructions);
      if (/_aroundBody\d+$/.test(name)) bodies.set(`${key}#woven`, instructions);
    }
  }
  return bodies;
}

/**
 * Whether a getter only returns one constant (getExplanation's sentences):
 * its text as javap lists it, or undefined. Only the shape is used; the text
 * itself is taken from Java (see `fresh`).
 */
function constantRead(bodies, declaredBy, member) {
  const originals = [...bodies.keys()]
    .filter((key) => key.startsWith(`${declaredBy}.${member}_aroundBody`) && key.endsWith('#woven'))
    .map((key) => bodies.get(key))
    .filter((code) => !code.some(({ op }) => op === 'invokestatic'));
  const code = originals[0] ?? bodies.get(`${declaredBy}.${member}`);
  if (!code || code.length !== 2) return undefined;
  const [load, give] = code;
  return /^ldc(_w)?$/.test(load.op) && give.op === 'areturn' && load.text !== undefined
    ? load.text
    : undefined;
}

/**
 * The field a getter returns unchanged, or undefined if it does anything else.
 * A woven getter's own body calls the aspects; what it did before weaving is
 * the `_aroundBody` method that calls neither the aspects nor another body.
 */
function fieldRead(bodies, declaredBy, member) {
  const originals = [...bodies.keys()]
    .filter((key) => key.startsWith(`${declaredBy}.${member}_aroundBody`) && key.endsWith('#woven'))
    .map((key) => bodies.get(key))
    .filter((code) => !code.some(({ op }) => op === 'invokestatic'));
  const code = originals[0] ?? bodies.get(`${declaredBy}.${member}`);
  if (!code) return undefined;
  const ops = code.map(({ op }) => op).join(' ');
  return /^aload_0 getfield [ailfd]?return$/.test(ops) || ops === 'aload_0 getfield areturn'
    ? code[1].field
    : undefined;
}
