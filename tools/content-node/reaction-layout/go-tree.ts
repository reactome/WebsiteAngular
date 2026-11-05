/**
 * The compartment tree of a reaction layout, as reaction-exporter's
 * GoTreeFactory builds it from the graph (research D22, step 1): the GO
 * cellular components and how they surround one another, then, for the
 * compartments a reaction's glyphs sit in, the branch of that tree that joins
 * them.
 *
 * Its choices follow the iteration order of Java's hash sets of GO terms,
 * which hash as their id does (GoTerm.hashCode): JavaHashMap keyed by the id
 * gives the same order. A TreeSet of terms is a list sorted by id.
 */
import { JavaHashMap } from '../java-hashmap.ts';
import { read } from '../graph.ts';
import { JavaNullPointerException as NullPointerException } from './model.ts';

const EXTRACELLULAR_REGION_ID = 'GO:0005576';
const CELLULAR_COMPONENT_ID = 'GO:0005575';

/**
 * RelationshipType.values(), in declaration order: getIncomingTerms and
 * getOutgoingTerms ask each in turn, though only surrounded_by is ever made.
 */
const RELATIONSHIP_TYPES = [
  'adjacent_to',
  'attached_to',
  'attaches_to',
  'boundary_part_of',
  'bounded_by',
  'bounds',
  'completely_bounded_by',
  'complex_of',
  'contained_by',
  'continuous_with',
  'derived_from',
  'derives_from',
  'extrinsic_to',
  'has_part',
  'inner_part_of',
  'inwards_of',
  'lacks_part',
  'located_in',
  'lumen_of',
  'outer_part_of',
  'outwards_of',
  'part_of',
  'partially_bounded_by',
  'partially_enclosed_by',
  'perforates',
  'spans',
  'subclass',
  'surrounded_by',
  'component_of',
] as const;
type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
type Direction = 'OUTGOING' | 'INCOMING';

/** A set of GO terms, in Java's HashSet order: keyed by id, as GoTerm.equals is. */
export class TermSet {
  readonly #map: JavaHashMap<string, GoTerm>;

  constructor(capacity?: number) {
    this.#map = new JavaHashMap<string, GoTerm>(capacity === undefined ? {} : { capacity });
  }

  /** new HashSet<>(collection): sized for it, then filled in its order. */
  static of(terms: Iterable<GoTerm>, size: number): TermSet {
    const set = new TermSet(JavaHashMap.capacityFor(size));
    for (const term of terms) set.add(term);
    return set;
  }

  /** HashSet.add: a term already there (by id) stays as it was. */
  add(term: GoTerm) {
    if (!this.#map.has(term.id)) this.#map.set(term.id, term);
  }

  has(term: GoTerm) {
    return this.#map.has(term.id);
  }

  get size() {
    return this.#map.size;
  }

  [Symbol.iterator]() {
    return this.#map.values();
  }
}

/** ontology.GoTerm: an id, a name, its relationships and, in the master tree, its parents. */
export class GoTerm {
  readonly id: string;
  readonly name: string;
  /** Per direction and type, the related terms sorted by id (a TreeSet). */
  readonly #relationships = new Map<Direction, Map<RelationshipType, GoTerm[]>>();
  /** instanceOf, in the order it was read (an ArrayList). */
  readonly parents: GoTerm[] = [];
  readonly children = new TermSet();

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  /** The copy constructor: id and name, no relationships, parents or children. */
  copy(): GoTerm {
    return new GoTerm(this.id, this.name);
  }

  /** GoTerm.getAccession: the id with every "GO:" removed. */
  get accession() {
    return this.id.replaceAll('GO:', '');
  }

  addParent(parent: GoTerm) {
    this.parents.push(parent);
    parent.children.add(this);
  }

  /** createRelationship: this one way, the other term the opposite way, each kept sorted. */
  createRelationship(direction: Direction, type: RelationshipType, term: GoTerm) {
    insertSorted(this.#related(direction, type), term);
    insertSorted(term.#related(direction === 'OUTGOING' ? 'INCOMING' : 'OUTGOING', type), this);
  }

  #related(direction: Direction, type: RelationshipType): GoTerm[] {
    let byType = this.#relationships.get(direction);
    if (!byType) this.#relationships.set(direction, (byType = new Map()));
    let terms = byType.get(type);
    if (!terms) byType.set(type, (terms = []));
    return terms;
  }

  /**
   * getRelationships: a new HashSet of this term's own, then -- outgoing --
   * its parents' outgoing ones, or -- incoming -- its children's incoming
   * ones and, repeatedly, the children of every term gathered.
   */
  relationships(direction: Direction, type: RelationshipType): TermSet {
    const own = this.#relationships.get(direction)?.get(type) ?? [];
    const terms = TermSet.of(own, own.length);
    if (direction === 'OUTGOING') {
      for (const parent of this.parents)
        for (const term of parent.relationships(direction, type)) terms.add(term);
    } else {
      for (const child of this.children)
        for (const term of child.relationships(direction, type)) terms.add(term);
      let size: number;
      do {
        size = terms.size;
        for (const term of [...terms]) for (const child of term.children) terms.add(child);
      } while (terms.size > size);
    }
    return terms;
  }

  incomingTerms(): TermSet {
    return this.#allTypes('INCOMING');
  }

  outgoingTerms(): TermSet {
    return this.#allTypes('OUTGOING');
  }

  #allTypes(direction: Direction): TermSet {
    const terms = new TermSet();
    for (const type of RELATIONSHIP_TYPES)
      for (const term of this.relationships(direction, type)) terms.add(term);
    return terms;
  }
}

/** A TreeSet's add: kept sorted by id (String.compareTo), a term already there not added again. */
function insertSorted(terms: GoTerm[], term: GoTerm) {
  let at = 0;
  while (at < terms.length && compareJava((terms[at] as GoTerm).id, term.id) < 0) at += 1;
  if (terms[at]?.id === term.id) return;
  terms.splice(at, 0, term);
}

/** String.compareTo: by UTF-16 code unit, then length. */
function compareJava(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let at = 0; at < length; at += 1) {
    const difference = a.charCodeAt(at) - b.charCodeAt(at);
    if (difference) return difference;
  }
  return a.length - b.length;
}

/** One GO_CellularComponent as the master tree reads it. */
export interface CellularComponent {
  id: string;
  name: string;
  instanceOf: string[];
  surroundedBy: string[];
}

/**
 * The cellular components, each with what it is an instance of and what
 * surrounds it, in their relationships' `order` -- SchemaService.getByClass
 * and the lazy loading of the two lists.
 */
export async function readCellularComponents(): Promise<CellularComponent[]> {
  return read<CellularComponent>(
    `MATCH (c:GO_CellularComponent)
     OPTIONAL MATCH (c)-[i:instanceOf]->(p:GO_CellularComponent)
     WITH c, p, i ORDER BY i.order
     WITH c, [x IN collect(p) | x.databaseName + ':' + x.accession] AS instanceOf
     OPTIONAL MATCH (c)-[s:surroundedBy]->(q:GO_CellularComponent)
     WITH c, instanceOf, q, s ORDER BY s.order
     RETURN c.databaseName + ':' + c.accession AS id, c.displayName AS name, instanceOf,
            [x IN collect(q) | x.databaseName + ':' + x.accession] AS surroundedBy`
  );
}

/**
 * ReactomeCompartmentFactory.getMasterTree, then GoTreeFactory's two fixes:
 * the cellular component surrounded by the extracellular region, and the
 * extracellular region's own parents cleared (its parents keep it as a child).
 */
export function masterTree(components: CellularComponent[]): JavaHashMap<string, GoTerm> {
  const tree = new JavaHashMap<string, GoTerm>();
  for (const component of components)
    tree.set(component.id, new GoTerm(component.id, component.name));
  for (const component of components) {
    const term = tree.get(component.id) as GoTerm;
    for (const parent of component.instanceOf) {
      const found = tree.get(parent);
      // A null parent in Java; the graph has none (instanceOf is to a component).
      if (found) term.addParent(found);
    }
    for (const surrounding of component.surroundedBy) {
      const found = tree.get(surrounding);
      if (found) term.createRelationship('OUTGOING', 'surrounded_by', found);
    }
  }
  const cellularComponent = tree.get(CELLULAR_COMPONENT_ID);
  const extracellularRegion = tree.get(EXTRACELLULAR_REGION_ID);
  if (cellularComponent && extracellularRegion) {
    cellularComponent.createRelationship('OUTGOING', 'surrounded_by', extracellularRegion);
    extracellularRegion.parents.length = 0;
  }
  return tree;
}

/**
 * getTreeWithIntermediateNodes: the terms for `ids`, each joined to the
 * master tree by its best branch, and the tree's root -- the first term with
 * nothing around it, moved down while it holds exactly one term and is none
 * of those asked for. No ids is the extracellular region alone.
 */
export function treeWithIntermediateNodes(
  master: JavaHashMap<string, GoTerm>,
  ids: string[]
): GoTerm {
  const tree = new JavaHashMap<string, GoTerm>();
  const asked = ids.length ? ids : [EXTRACELLULAR_REGION_ID];
  const terms = asked.map((id) => {
    const term = master.get(id);
    // new GoTerm(null) is Java's NullPointerException.
    if (!term) throw new NullPointerException();
    return term.copy();
  });
  for (const term of terms) tree.set(term.id, term);
  for (const term of terms) addToHierarchy(master, tree, term, terms);
  let root: GoTerm | undefined;
  for (const term of tree.values())
    if (!term.outgoingTerms().size) {
      root = term;
      break;
    }
  if (!root) throw new NullPointerException();
  return findRoot(root, terms);
}

function findRoot(root: GoTerm, terms: GoTerm[]): GoTerm {
  if (terms.some((term) => term.id === root.id)) return root;
  const incoming = [...root.incomingTerms()];
  if (incoming.length !== 1) return root;
  return findRoot(incoming[0] as GoTerm, terms);
}

function addToHierarchy(
  master: JavaHashMap<string, GoTerm>,
  tree: JavaHashMap<string, GoTerm>,
  term: GoTerm,
  terms: GoTerm[]
) {
  const asked = (branch: GoTerm[]) =>
    branch.filter((parent) => terms.some((other) => other.id === parent.id)).length;
  // Stream.min: the first branch no other beats -- most terms asked for, then shortest.
  let best: GoTerm[] | undefined;
  for (const branch of branches(term, master)) {
    if (
      !best ||
      asked(branch) > asked(best) ||
      (asked(branch) === asked(best) && branch.length < best.length)
    )
      best = branch;
  }
  if (!best) return;
  let aux = term;
  for (const masterParent of best) {
    let parent = tree.get(masterParent.id);
    if (!parent) tree.set(masterParent.id, (parent = masterParent.copy()));
    aux.createRelationship('OUTGOING', 'surrounded_by', parent);
    aux = parent;
  }
}

/** getBranches: every path up the master tree from `term`, nearest term first. */
function branches(term: GoTerm, master: JavaHashMap<string, GoTerm>): GoTerm[][] {
  const found: GoTerm[][] = [];
  const masterTerm = master.get(term.id);
  if (!masterTerm) throw new NullPointerException();
  for (const parent of masterTerm.outgoingTerms()) {
    const above = branches(parent, master);
    for (const branch of above) {
      branch.unshift(parent);
      found.push(branch);
    }
    if (!above.length) found.push([parent]);
  }
  return found;
}
