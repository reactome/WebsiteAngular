// @vitest-environment node
//
// The graph's classes in the contract (graph.ts) are held to the domain
// snapshot (research R9): the service writes any class from the snapshot,
// with no type per class, so a contract field renamed or dropped cannot fail
// the writer's build. This holds each class's fields to the properties the
// snapshot writes for it, both ways, and each union of an abstract class to
// its concrete classes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface Snapshot {
  properties: [name: string, source: unknown, views: number, ...rest: unknown[]][];
  json: Record<string, number[]>;
  store: [string, string[]][];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const snapshot = JSON.parse(
  readFileSync(path.join(ROOT, 'tools/content-node/domain-snapshot.json'), 'utf8')
) as Snapshot;
// Read by a plain path, as entity-types.spec.ts reads search.ts: knip takes a
// module read through `new URL(…, import.meta.url)` for a use of all its exports.
const GRAPH = path.join(ROOT, 'projects/contract/graph.ts');
const CORE = path.join(ROOT, 'projects/contract/graph-core.ts');
const MODULES = [GRAPH, CORE];

/** The union of every class, as the enhanced query answers it (Java's DatabaseObject). */
const ROOT_UNION = 'GraphObject';

/** Fields the answer carries that are not a class's properties: JSOG's own. */
const JSOG_FIELDS = new Set(['@id']);

/** What the contract says of each class and each union of classes. */
interface Described {
  /** Each concrete class, by its `schemaClass`, to its fields. */
  classes: Map<string, string[]>;
  /** Each union, by its name, to the classes it holds. */
  unions: Map<string, string[]>;
  /** Each relationship entry (no `schemaClass`, an `element`), by its class's name, to its fields. */
  relationships: Map<string, string[]>;
}

/**
 * The classes, unions and relationship entries the graph's contract modules
 * declare, exported or not, read through the type checker; `changed` stands in
 * for a module's text.
 */
function described(changed: Record<string, string> = {}): Described {
  const host = ts.createCompilerHost({});
  const read = host.readFile.bind(host);
  host.readFile = (name) => changed[path.resolve(name)] ?? read(name);
  const program = ts.createProgram(MODULES, { strict: true, noEmit: true }, host);
  const checker = program.getTypeChecker();
  const schemaClass = (type: ts.Type) => {
    const property = type.getProperty('schemaClass');
    const value = property && checker.getTypeOfSymbol(property);
    return value?.isStringLiteral() ? value.value : undefined;
  };
  const fieldsOf = (type: ts.Type) =>
    checker
      .getPropertiesOfType(type)
      .map((property) => property.name)
      .filter((field) => !JSOG_FIELDS.has(field))
      .sort();
  const classes = new Map<string, string[]>();
  const unions = new Map<string, string[]>();
  const relationships = new Map<string, string[]>();
  // Every class, exported or not: a class no reader imports yet (URL) is
  // still one the answers hold, and the description's.
  const statements = MODULES.flatMap((file) => {
    const module = program.getSourceFile(file);
    if (!module) throw new Error(`no source for ${file}`);
    return [...module.statements];
  });
  for (const statement of statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      const type = checker.getTypeAtLocation(statement.name);
      const name = schemaClass(type);
      if (name !== undefined) classes.set(name, fieldsOf(type));
      else if (type.getProperty('element')) relationships.set(statement.name.text, fieldsOf(type));
    } else if (ts.isTypeAliasDeclaration(statement)) {
      const type = checker.getTypeAtLocation(statement.name);
      // A union cut to one class is no union to the checker, and is held all the same.
      const members = (type.isUnion() ? type.types : [type]).map(schemaClass);
      if (members.every((member): member is string => member !== undefined))
        unions.set(statement.name.text, [...members].sort());
    }
  }
  return { classes, unions, relationships };
}

/** The properties the snapshot writes for a class, in any view. */
const written = (name: string) =>
  (snapshot.json[name] ?? []).map((at) => snapshot.properties[at]?.[0] ?? `#${at}`).sort();

/**
 * The concrete classes below a class: an abstract one's, or, for a union named
 * `Any` and a concrete class (`AnyTaxon`), that class and its subclasses.
 */
const below = (union: string) => {
  if (union === ROOT_UNION)
    return Object.keys(snapshot.json)
      .filter((name) => !isRelationship(name))
      .sort();
  const name = union.startsWith('Any') && union.slice(3) in snapshot.json ? union.slice(3) : union;
  return snapshot.store
    .filter(([, ancestors]) => ancestors.includes(name))
    .map(([concrete]) => concrete)
    .sort();
};

/**
 * A relationship class: stored, but not a DatabaseObject (Input, HasComponent),
 * or the composition entry, which is not stored at all.
 */
function isRelationship(name: string): boolean {
  if (name === 'Default') return true;
  const stored = snapshot.store.find(([concrete]) => concrete === name);
  return stored !== undefined && !stored[1].includes('DatabaseObject');
}

/** Every way the contract and the snapshot disagree. */
function disagreements({ classes, unions, relationships }: Described): string[] {
  const found: string[] = [];
  for (const [name, fields] of relationships) {
    if (!isRelationship(name)) {
      found.push(`${name}: no relationship the snapshot writes`);
      continue;
    }
    const properties = written(name);
    for (const field of fields)
      if (!properties.includes(field)) found.push(`${name}.${field}: not written`);
    for (const property of properties)
      if (!fields.includes(property)) found.push(`${name}.${property}: written, not described`);
  }
  for (const [name, fields] of classes) {
    if (!(name in snapshot.json)) {
      found.push(`${name}: no class the snapshot writes`);
      continue;
    }
    const properties = written(name);
    for (const field of fields)
      if (!properties.includes(field)) found.push(`${name}.${field}: not written`);
    for (const property of properties)
      if (!fields.includes(property)) found.push(`${name}.${property}: written, not described`);
  }
  for (const [name, members] of unions)
    if (JSON.stringify(members) !== JSON.stringify(below(name)))
      found.push(
        `${name}: holds ${members.join(', ')}; the snapshot has ${below(name).join(', ')}`
      );
  return found;
}

const contract = readFileSync(GRAPH, 'utf8');
const core = readFileSync(CORE, 'utf8');
/** The contract with one change to a module: graph.ts unless another is named. */
const swap = (from: string, to: string, file = GRAPH) => {
  const text = file === GRAPH ? contract : core;
  if (!text.includes(from)) throw new Error(`the contract no longer has: ${from}`);
  return described({ [file]: text.replace(from, to) });
};

describe("the graph's classes in the contract", () => {
  const now = described();

  it('are read: classes and unions both', () => {
    expect([...now.classes.keys()]).toContain('Person');
    expect([...now.unions.keys()]).toContain('Publication');
  });

  it('are all read: one class for each `schemaClass` the modules write, and each relationship', () => {
    const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;
    expect(now.classes.size).toBe(
      count(contract, /^ {2}schemaClass: '/gm) + count(core, /^ {2}schemaClass: '/gm)
    );
    expect(now.relationships.size).toBe(count(core, /^ {2}element: /gm));
  });

  it('describe every class the enhanced query can answer, as one union', () => {
    expect(now.unions.get(ROOT_UNION)).toEqual(below(ROOT_UNION));
    expect([...now.classes.keys()].sort()).toEqual(below(ROOT_UNION));
  });

  it('fail on a relationship field the snapshot writes and the contract leaves out', () => {
    expect(
      disagreements(swap("  type: 'input';\n  stoichiometry: number;", "  type: 'input';", CORE))
    ).toEqual(['Input.stoichiometry: written, not described']);
  });

  it('fail on the union of every class missing one', () => {
    expect(disagreements(swap('  | Reaction<R>\n', '', CORE))).toContain(
      `${ROOT_UNION}: holds ${below(ROOT_UNION)
        .filter((name) => name !== 'Reaction')
        .join(', ')}; the snapshot has ${below(ROOT_UNION).join(', ')}`
    );
  });

  it('fail on a union of a class and its subclasses that misses one', () => {
    expect(
      disagreements(
        swap(
          'AnyTaxon<R extends Ref> = Taxon<R> | Species<R>;',
          'AnyTaxon<R extends Ref> = Taxon<R>;'
        )
      )
    ).toEqual(['AnyTaxon: holds Taxon; the snapshot has Species, Taxon']);
  });

  it('describe exactly what the snapshot writes for each class, and each union exactly its classes', () => {
    expect(disagreements(now)).toEqual([]);
  });

  it('fail on a field the snapshot does not write', () => {
    expect(disagreements(swap('  surname: string;', '  lastName: string;'))).toEqual([
      'Person.lastName: not written',
      'Person.surname: written, not described',
    ]);
  });

  it('fail on a field the snapshot writes and the contract leaves out', () => {
    expect(disagreements(swap('  isbn?: string;\n', ''))).toEqual([
      'Book.isbn: written, not described',
    ]);
  });

  it('fail on a union that misses one of its classes', () => {
    expect(
      disagreements(
        swap(
          'LiteratureReference<R> | Book<R> | UrlPublication<R>;',
          'LiteratureReference<R> | Book<R>;'
        )
      )
    ).toEqual([
      'Publication: holds Book, LiteratureReference; the snapshot has Book, LiteratureReference, URL',
    ]);
  });

  it('fail on a class the snapshot does not have', () => {
    expect(disagreements(swap("schemaClass: 'Book';", "schemaClass: 'Pamphlet';"))).toContain(
      'Pamphlet: no class the snapshot writes'
    );
  });
});
