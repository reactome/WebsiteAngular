// @vitest-environment node
//
// One description per answer (spec 016, FR-003): an answer in the contract is
// not described again by the site or the pathway browser, under its own name
// or under the name a reader re-exports it as. An alias of the contract's type
// is a name, not a description, and is allowed.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT = path.join(ROOT, 'projects/contract');
const READERS = ['projects/website-angular/src', 'projects/pathway-browser/src'];

/** Every non-spec TypeScript module under a directory, by repository path. */
function modules(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const file of readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts') || file.endsWith('.d.ts')) continue;
    const where = path.posix.join(dir, file.split(path.sep).join('/'));
    found[where] = readFileSync(path.join(ROOT, where), 'utf8');
  }
  return found;
}

const parse = (name: string, source: string) =>
  ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);

/** The contract's exported interfaces and types. */
function contractNames(contract: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [file, source] of Object.entries(contract))
    for (const statement of parse(file, source).statements)
      if (
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        names.add(statement.name.text);
  return names;
}

/** The names readers re-export the contract's types as (`export type { A as B } from '…/contract/…'`). */
function readerAliases(readers: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [file, source] of Object.entries(readers))
    for (const statement of parse(file, source).statements)
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        /\/contract\/[^/]+\.ts$/.test(statement.moduleSpecifier.text) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      )
        for (const element of statement.exportClause.elements) names.add(element.name.text);
  return names;
}

/**
 * A type that describes an answer's shape itself, rather than naming another
 * type: an object type, a mapped type, or either inside a union, an
 * intersection, parentheses, an array or a wrapper (`Readonly<{…}>`).
 */
const describesShape = (type: ts.TypeNode): boolean =>
  ts.isTypeLiteralNode(type) ||
  ts.isMappedTypeNode(type) ||
  (ts.isParenthesizedTypeNode(type) && describesShape(type.type)) ||
  (ts.isArrayTypeNode(type) && describesShape(type.elementType)) ||
  (ts.isUnionTypeNode(type) && type.types.some(describesShape)) ||
  (ts.isIntersectionTypeNode(type) && type.types.some(describesShape)) ||
  (ts.isTypeReferenceNode(type) && (type.typeArguments ?? []).some(describesShape));

/** A declaration's name with the namespaces it sits in: `Search.Icon.Entry`. */
function qualifiedName(node: ts.Node & { name: ts.Identifier }): string {
  const parts = [node.name.text];
  // A source file's parent is undefined at run time, whatever its type says.
  for (
    let at = node.parent as ts.Node | undefined;
    at !== undefined;
    at = at.parent as ts.Node | undefined
  )
    if (ts.isModuleDeclaration(at)) parts.unshift(at.name.text);
  return parts.join('.');
}

/** The name a type reference names, its last part: `GroupedResult` of `GroupedResult<E>`. */
/**
 * The readers' wrappers that name a contract type as a reader holds it:
 * `Resolved<X>` is X with its JSOG references resolved (research R9).
 */
const WRAPPERS = new Set(['Resolved']);

/**
 * The type an alias names: a reference's own name, the type a wrapper wraps,
 * or, for an intersection or a union, its first member's (the contract's type,
 * then the reader's named additions: `Resolved<Publication<…>> & CurationPublication`;
 * or the contract's types it joins: `Resolved<PhysicalEntity<…> | SummaryEntity<…>>`).
 */
const referenced = (type: ts.TypeNode): string | null => {
  if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) {
    const [first] = type.types;
    return first ? referenced(first) : null;
  }
  if (!ts.isTypeReferenceNode(type)) return null;
  const name = ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.right.text;
  const [wrapped] = type.typeArguments ?? [];
  return WRAPPERS.has(name) && wrapped ? referenced(wrapped) : name;
};

/**
 * The names readers give the contract's types by aliasing them in their own
 * code (`type SearchResult = GroupedResult<…>`, the pathway browser's
 * `Search.Entry`), by qualified name, following aliases of aliases. A type
 * imported from the contract under another name counts as the contract's.
 */
function localAliases(readers: Record<string, string>, contract: Set<string>): Set<string> {
  const known = new Set(contract);
  for (const [file, source] of Object.entries(readers))
    for (const statement of parse(file, source).statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        /\/contract\/[^/]+\.ts$/.test(statement.moduleSpecifier.text)
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const element of bindings.elements) known.add(element.name.text);
      }
  const aliases = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [file, source] of Object.entries(readers)) {
      const visit = (node: ts.Node) => {
        if (ts.isTypeAliasDeclaration(node)) {
          const target = referenced(node.type);
          const name = qualifiedName(node);
          if (target !== null && known.has(target) && !aliases.has(name)) {
            aliases.add(name);
            known.add(node.name.text);
            grew = true;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(file, source));
    }
  }
  return aliases;
}

/**
 * The readers' aliases, written down: a name stays protected when its alias
 * is turned into a description, which a list read from the code alone would
 * lose along with the alias. The spec holds this list to the code both ways.
 */
const READER_ALIASES = [
  // The graph's classes (T025): the pathway browser's resolved, the site's plain.
  'PlainTopLevelPathway',
  'DatabaseObject',
  // Unions and views of them the pathway browser names (a selection, a fragment
  // change, an ontology term's link, the description tab's tree data).
  'OntologyTerm',
  'TreeData',
  'TreeNode',
  'FragmentModification',
  'SelectableObject',
  'AbstractModifiedResidue',
  'CandidateSet',
  'CatalystActivity',
  'CatalystActivityReference',
  'Cell',
  'ChemicalDrug',
  'Complex',
  'DefinedSet',
  'EntitySet',
  'EntityWithAccessionedSequence',
  'FragmentDeletionModification',
  'FragmentInsertionModification',
  'FragmentReplacedModification',
  'GenomeEncodedEntity',
  'GroupModifiedResidue',
  'InterChainCrosslinkedResidue',
  'IntraChainCrosslinkedResidue',
  'MarkerReference',
  'ModifiedNucleotide',
  'ModifiedResidue',
  'NegativeGeneExpressionRegulation',
  'NegativeRegulation',
  'NonsenseMutation',
  'OtherEntity',
  'PhysicalEntity',
  'Polymer',
  'PositiveGeneExpressionRegulation',
  'PositiveRegulation',
  'ProteinDrug',
  'ReferenceDNASequence',
  'ReferenceEntity',
  'ReferenceGeneProduct',
  'ReferenceGroup',
  'ReferenceIsoform',
  'ReferenceMolecule',
  'ReferenceRNASequence',
  'ReferenceSequence',
  'ReferenceTherapeutic',
  'Regulation',
  'RegulationReference',
  'Relationship.HasCompartment',
  'Relationship.HasModifiedResidue',
  'ReplacedResidue',
  'Requirement',
  'SimpleEntity',
  'SummaryEntity',
  'BlackBoxEvent',
  'CellDevelopmentStep',
  'CellLineagePath',
  'Depolymerisation',
  'Event',
  'FailedReaction',
  'NegativePrecedingEvent',
  'Pathway',
  'Polymerisation',
  'Reaction',
  'ReactionLikeEvent',
  'TopLevelPathway',
  // The pathway browser's local names for its own relationship types (T025e).
  'HasCompartment',
  'HasModifiedResidue',
  'Anatomy',
  'CellType',
  'Compartment',
  'Disease',
  'Figure',
  'GO_BiologicalProcess',
  'GO_MolecularFunction',
  'ListedSpecies',
  'PsiMod',
  'ReviewStatus',
  'Species',
  'Summation',
  'Taxon',
  'Book',
  'DatabaseIdentifier',
  'InstanceEdit',
  'LiteratureReference',
  'Person',
  'PersonAffiliation',
  'PersonPublication',
  'Publication',
  'ReferenceDatabase',
  'ResultGroup',
  'Search.Entry',
  'Search.Facet',
  'Search.Icon.Entry',
  'Search.Icon.Result',
  'Search.PathwayOf',
  'Search.Result',
  'SearchResult',
  'ShownGroup',
];

/**
 * The pathway browser's own descriptions of graph classes the contract has,
 * pending their readers' move (T025d, T025e). Held exactly: a new one fails.
 */
const PENDING: string[] = [
  // Empty since T025e: every graph class the pathway browser reads is the contract's.
];

/** Declarations that share a contract name but describe something else, and why. */
const NAMESAKES: Record<string, string> = {
  'projects/website-angular/src/app/about/release-calendar/release-calendar.component.ts: interface Release':
    "the site's release calendar, written in its own content; not the graph's Release",
  'projects/pathway-browser/src/app/model/analysis.model.ts: interface Analysis.Pathway':
    "a pathway of an analysis result, the analysis service's answer",
  'projects/pathway-browser/src/app/reacfoam/svg-exporter.service.ts: interface SvgDecoration.Output':
    'an output arrow drawn on an exported species overview',
};

/** Every declaration in the readers that describes, again, an answer the contract has. */
function secondDescriptions(readers: Record<string, string>, names: Set<string>): string[] {
  const found: string[] = [];
  // A contract name or a re-export's is protected wherever it is declared; an
  // alias's, by its qualified name.
  const isProtected = (node: ts.Node & { name: ts.Identifier }) =>
    names.has(node.name.text) || names.has(qualifiedName(node));
  for (const [file, source] of Object.entries(readers)) {
    const visit = (node: ts.Node) => {
      if (ts.isInterfaceDeclaration(node) && isProtected(node))
        found.push(`${file}: interface ${qualifiedName(node)}`);
      if (ts.isClassDeclaration(node) && node.name && isProtected({ ...node, name: node.name }))
        found.push(`${file}: class ${node.name.text}`);
      if (ts.isTypeAliasDeclaration(node) && isProtected(node) && describesShape(node.type))
        found.push(`${file}: type ${qualifiedName(node)}`);
      ts.forEachChild(node, visit);
    };
    visit(parse(file, source));
  }
  return found;
}

const contract = Object.fromEntries(
  readdirSync(CONTRACT)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => [file, readFileSync(path.join(CONTRACT, file), 'utf8')])
);
const readers = Object.assign({}, ...READERS.map(modules)) as Record<string, string>;
const contractOwn = contractNames(contract);
const aliases = localAliases(readers, contractOwn);
const names = new Set([...contractOwn, ...readerAliases(readers), ...READER_ALIASES]);

describe('one description per answer', () => {
  it('knows the contract by its names and the names readers give it', () => {
    // The site reads the search entry's view as SearchEntry.
    expect([...names]).toEqual(
      expect.arrayContaining(['SearchEntryView', 'SearchEntry', 'FacetCount'])
    );
  });

  it("lists the readers' aliases exactly, so one turned into a description is still caught", () => {
    expect([...aliases].sort()).toEqual([...READER_ALIASES].sort());
  });

  it('finds no answer described again by the site or the pathway browser, but those pending and the namesakes', () => {
    expect(secondDescriptions(readers, names).sort()).toEqual(
      [...PENDING, ...Object.keys(NAMESAKES)].sort()
    );
  });

  it('refuses an interface or an object type under a contract name, and allows an alias', () => {
    expect(
      secondDescriptions(
        {
          'a.ts': 'export interface SearchEntry { dbId: number }',
          'b.ts': 'type FacetCount = { name: string; count: number };',
          'c.ts': 'export namespace Search { export interface IconEntry { stId: string } }',
          'd.ts': "import type { FacetCount as F } from '../contract/search.ts';\ntype Facet = F;",
          'e.ts': 'type ResultGroup = Group<SearchEntryView>;',
          'f.ts': 'type Facet = Readonly<{ name: string }>;',
          'g.ts': 'type IconEntry = { [K in "a" | "b"]: string };',
          'h.ts': 'export namespace Search { export interface Entry { dbId: string } }',
          'i.ts': 'export class SearchEntry { dbId = 0; }',
          'j.ts': 'type FacetCount = ({ name: string })[];',
          'k.ts': 'type Facet = Record<string, FacetCount>;',
        },
        new Set(['SearchEntry', 'FacetCount', 'IconEntry', 'Facet', 'ResultGroup', 'Search.Entry'])
      )
    ).toEqual([
      'a.ts: interface SearchEntry',
      'b.ts: type FacetCount',
      'c.ts: interface Search.IconEntry',
      'f.ts: type Facet',
      'g.ts: type IconEntry',
      'h.ts: interface Search.Entry',
      'i.ts: class SearchEntry',
      'j.ts: type FacetCount',
    ]);
  });
});
