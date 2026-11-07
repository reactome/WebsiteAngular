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

/** Fields the answer carries that are not a class's properties: JSOG's own. */
const JSOG_FIELDS = new Set(['@id']);

/** What the contract says of each class and each union of classes. */
interface Described {
  /** Each concrete class, by its `schemaClass`, to its fields. */
  classes: Map<string, string[]>;
  /** Each union, by its name, to the classes it holds. */
  unions: Map<string, string[]>;
}

/** The classes and unions a contract module declares, exported or not, read through the type checker. */
function described(file: string, source = readFileSync(file, 'utf8')): Described {
  const host = ts.createCompilerHost({});
  const read = host.readFile.bind(host);
  host.readFile = (name) => (path.resolve(name) === file ? source : read(name));
  const program = ts.createProgram([file], { strict: true, noEmit: true }, host);
  const checker = program.getTypeChecker();
  const module = program.getSourceFile(file);
  if (!module) throw new Error(`no source for ${file}`);
  const schemaClass = (type: ts.Type) => {
    const property = type.getProperty('schemaClass');
    const value = property && checker.getTypeOfSymbol(property);
    return value?.isStringLiteral() ? value.value : undefined;
  };
  const classes = new Map<string, string[]>();
  const unions = new Map<string, string[]>();
  // Every class, exported or not: a class no reader imports yet (URL) is
  // still one the answers hold, and the description's.
  for (const statement of module.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      const type = checker.getTypeAtLocation(statement.name);
      const name = schemaClass(type);
      if (name !== undefined)
        classes.set(
          name,
          checker
            .getPropertiesOfType(type)
            .map((property) => property.name)
            .filter((field) => !JSOG_FIELDS.has(field))
            .sort()
        );
    } else if (ts.isTypeAliasDeclaration(statement)) {
      const type = checker.getTypeAtLocation(statement.name);
      if (!type.isUnion()) continue;
      const members = type.types.map(schemaClass);
      if (members.every((member): member is string => member !== undefined))
        unions.set(statement.name.text, [...members].sort());
    }
  }
  return { classes, unions };
}

/** The properties the snapshot writes for a class, in any view. */
const written = (name: string) =>
  (snapshot.json[name] ?? []).map((at) => snapshot.properties[at]?.[0] ?? `#${at}`).sort();

/** The concrete classes below an abstract one. */
const below = (name: string) =>
  snapshot.store
    .filter(([, ancestors]) => ancestors.includes(name))
    .map(([concrete]) => concrete)
    .sort();

/** Every way the contract and the snapshot disagree. */
function disagreements({ classes, unions }: Described): string[] {
  const found: string[] = [];
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
const swap = (from: string, to: string) => {
  if (!contract.includes(from)) throw new Error(`the contract no longer has: ${from}`);
  return described(GRAPH, contract.replace(from, to));
};

describe("the graph's classes in the contract", () => {
  const now = described(GRAPH);

  it('are read: classes and unions both', () => {
    expect([...now.classes.keys()]).toContain('Person');
    expect([...now.unions.keys()]).toContain('Publication');
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
        swap('LiteratureReference<R> | Book<R> | URL<R>;', 'LiteratureReference<R> | Book<R>;')
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
