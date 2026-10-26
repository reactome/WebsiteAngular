// @vitest-environment node
//
// The entity entry's `type` names a class by its own name when the indexer's
// mapping (DocumentBuilder.getType and getReferenceTypes, search-indexer
// 5cea4d6) gives it no other: a physical entity that is neither a set nor
// genome-encoded. A class a release adds would be written with a type the
// contract does not have, so the list is held to the domain snapshot.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type Snapshot = { store: [string, string[]][] };
const snapshot = JSON.parse(
  readFileSync(new URL('../../tools/content-node/domain-snapshot.json', import.meta.url), 'utf8')
) as Snapshot;

/** The classes the indexer names a type by, from each concrete class's ancestors. */
function namedByClass({ store }: Snapshot): string[] {
  const mapped = ['EntitySet', 'GenomeEncodedEntity'];
  return store
    .filter(([, ancestors]) => ancestors.includes('PhysicalEntity'))
    .filter(([, ancestors]) => !mapped.some((other) => ancestors.includes(other)))
    .map(([name]) => name)
    .sort();
}

/** The string literals of a union type alias in a contract module. */
function literals(source: string, alias: string): string[] {
  const file = ts.createSourceFile('search.ts', source, ts.ScriptTarget.Latest, true);
  const found = file.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === alias
  );
  if (!found) return [];
  const members = ts.isUnionTypeNode(found.type) ? found.type.types : [found.type];
  return members
    .flatMap((member) =>
      ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
        ? [member.literal.text]
        : []
    )
    .sort();
}

// Read by a plain path: knip takes `new URL('./search.ts', import.meta.url)`
// for a use of every export the module has, which hid its dead ones.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const contract = readFileSync(path.join(HERE, 'search.ts'), 'utf8');

describe("the entity entry's types", () => {
  it('name by class exactly the classes the indexer names by class', () => {
    expect(literals(contract, 'EntityClassName')).toEqual(namedByClass(snapshot));
  });

  it('fail when a release adds a class the contract does not name', () => {
    const added: Snapshot = {
      store: [...snapshot.store, ['NewEntity', ['NewEntity', 'PhysicalEntity', 'DatabaseObject']]],
    };
    expect(literals(contract, 'EntityClassName')).not.toEqual(namedByClass(added));
  });

  it('are needed for no reference entity: getReferenceTypes names each class it reaches', () => {
    // A reference-entity class outside these would go by its own name too.
    const mapped = [
      'ReferenceGeneProduct',
      'ReferenceDNASequence',
      'ReferenceRNASequence',
      'ReferenceMolecule',
      'ReferenceGroup',
      'ReferenceTherapeutic',
    ];
    const unmapped = snapshot.store
      .filter(([, ancestors]) => ancestors.includes('ReferenceEntity'))
      .filter(([, ancestors]) => !mapped.some((name) => ancestors.includes(name)))
      .map(([name]) => name);
    expect(unmapped).toEqual([]);
  });

  it('leave out sets, genome-encoded entities and the reference entities', () => {
    const names = namedByClass(snapshot);
    for (const mapped of ['DefinedSet', 'CandidateSet', 'EntityWithAccessionedSequence'])
      expect(names).not.toContain(mapped);
    expect(names.some((name) => name.startsWith('Reference'))).toBe(false);
  });
});
