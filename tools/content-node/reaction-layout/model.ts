/**
 * The glyphs of a reaction layout, as reaction-exporter's model holds them
 * (research D22). Every glyph takes the next id from one counter, and Java's
 * hash sets of glyphs hash Objects.hash(id): GlyphSet gives their order.
 */
import { JavaHashMap } from '../java-hashmap.ts';
import { Bounds } from './bounds.ts';
import type { Segment } from './sizes.ts';

/** EntityRole, by the name the query gives it. */
export type EntityRole = 'input' | 'output' | 'catalyst' | 'negative' | 'positive';

/** A participant's role: its type and stoichiometry (model.Role). */
export interface Role {
  type: EntityRole;
  n: number;
}

/** AbstractGlyph's counter, for one request: ids from `first` on. */
export class GlyphIds {
  #next: number;

  constructor(first = 1) {
    this.#next = first;
  }

  next(): number {
    return this.#next++;
  }
}

/** A HashSet of glyphs: keyed by id, hashed as Objects.hash(id). */
export class GlyphSet<G extends { id: number }> {
  readonly #map: JavaHashMap<number, G>;

  constructor(capacity?: number) {
    this.#map = new JavaHashMap<number, G>({
      hash: JavaHashMap.longObjectsHash,
      ...(capacity === undefined ? {} : { capacity }),
    });
  }

  /** new HashSet<>(collection): sized for it, then filled in its order. */
  static of<G extends { id: number }>(glyphs: G[]): GlyphSet<G> {
    const set = new GlyphSet<G>(JavaHashMap.capacityFor(glyphs.length));
    for (const glyph of glyphs) set.add(glyph);
    return set;
  }

  add(glyph: G) {
    if (!this.#map.has(glyph.id)) this.#map.set(glyph.id, glyph);
  }

  has(glyph: G) {
    return this.#map.has(glyph.id);
  }

  delete(glyph: G) {
    return this.#map.delete(glyph.id);
  }

  get size() {
    return this.#map.size;
  }

  [Symbol.iterator]() {
    return this.#map.values();
  }
}

/** A compartment as the graph holds it: what CompartmentGlyph(Compartment) reads. */
export interface CompartmentData {
  dbId: number;
  schemaClass: string;
  displayName: string;
  accession: string;
}

export class CompartmentGlyph {
  readonly kind = 'compartment';
  readonly id: number;
  /** Absent for a compartment only the GO tree supplies. */
  readonly dbId: number | undefined;
  readonly schemaClass: string | undefined;
  readonly name: string;
  readonly accession: string;
  parent: CompartmentGlyph | undefined;
  readonly bounds = new Bounds();
  readonly children = new GlyphSet<CompartmentGlyph>();
  readonly contained = new GlyphSet<ContainedGlyph>();

  constructor(
    ids: GlyphIds,
    from: CompartmentData | { name: string; accession: string; dbId?: never }
  ) {
    this.id = ids.next();
    if ('displayName' in from) {
      this.dbId = from.dbId;
      this.schemaClass = from.schemaClass;
      this.name = from.displayName;
      this.accession = from.accession;
    } else {
      this.dbId = undefined;
      this.schemaClass = undefined;
      this.name = from.name;
      this.accession = from.accession;
    }
  }

  /** setParent: a second parent is the library's own RuntimeException. */
  setParent(parent: CompartmentGlyph) {
    if (this.parent)
      throw new JavaRuntimeException(
        'Trying to assign more than one parent to a compartment tree node'
      );
    this.parent = parent;
  }
}

export class ReactionGlyph {
  readonly kind = 'reaction';
  readonly id: number;
  compartment: CompartmentGlyph | undefined;
  readonly bounds = new Bounds();
  /** The backbone: a segment out of each side (setSize), later the connectors' joins. */
  readonly segments: Segment[] = [];

  readonly data: ReactionData;

  constructor(ids: GlyphIds, data: ReactionData) {
    this.id = ids.next();
    this.data = data;
  }
}

/** What ReactionGlyph reads from the reaction-like event. */
export interface ReactionData {
  dbId: number;
  stId: string;
  schemaClass: string;
  displayName: string;
  isInDisease: boolean | null;
  category: string | null;
  speciesName: string | null;
  compartments: CompartmentData[];
}

/** A translational modification, as AttachmentGlyph reads it. */
export interface AttachmentData {
  dbId: number;
  schemaClass: string;
  label: string | null;
}

export class AttachmentGlyph {
  readonly id: number;
  readonly bounds = new Bounds();

  readonly data: AttachmentData;

  constructor(ids: GlyphIds, data: AttachmentData) {
    this.id = ids.next();
    this.data = data;
  }
}

/** What EntityGlyph.setPhysicalEntity reads from a physical entity. */
export interface EntityData {
  dbId: number;
  stId: string;
  names: string[] | null;
  inDisease: boolean | null;
  schemaClass: string;
  labels: string[];
  compartments: CompartmentData[];
  /** The labels of its one reference entity, if it has exactly one. */
  referenceLabels: string[] | null;
  referenceTrivial: boolean | null;
  modifiedResidues: (AttachmentData & { labels: string[] })[];
}

export type ContainedGlyph = EntityGlyph | ReactionGlyph;

export class EntityGlyph {
  readonly kind = 'entity';
  readonly id: number;
  roles: Role[] = [];
  drug = false;
  readonly crossed = false;
  dashed = false;
  dbId!: number;
  stId!: string;
  name!: string;
  inDisease!: boolean | null;
  schemaClass!: string;
  compartments!: CompartmentData[];
  attachments: AttachmentGlyph[] = [];
  renderableClass!: string;
  trivial = false;
  compartment: CompartmentGlyph | undefined;
  /** A copy starts with bounds of its own, as Java's copy constructor gives it. */
  readonly bounds = new Bounds();

  constructor(ids: GlyphIds, copyOf?: EntityGlyph) {
    this.id = ids.next();
    if (!copyOf) return;
    // The copy constructor: everything but roles and connectors, with new
    // attachments, each taking an id.
    Object.assign(this, {
      dbId: copyOf.dbId,
      stId: copyOf.stId,
      name: copyOf.name,
      inDisease: copyOf.inDisease,
      schemaClass: copyOf.schemaClass,
      compartments: copyOf.compartments,
      compartment: copyOf.compartment,
      dashed: copyOf.dashed,
      drug: copyOf.drug,
      trivial: copyOf.trivial,
      renderableClass: copyOf.renderableClass,
    });
    this.attachments = copyOf.attachments.map(
      (attachment) => new AttachmentGlyph(ids, attachment.data)
    );
  }

  /** getIdentifier: crossed is never set, so it is always false here. */
  get identifier() {
    return `${this.stId}:${this.crossed}:${this.dashed}`;
  }

  /** isDisease: dashed, or the entity's flag -- a null flag unboxed is Java's NullPointerException. */
  get disease(): boolean {
    if (this.dashed) return true;
    if (this.inDisease === null) throw new JavaNullPointerException();
    return this.inDisease;
  }
}

/** A Java exception the service answers with its message (handleUnclassified). */
export class JavaRuntimeException extends Error {}

/** Java's NullPointerException, answered with the service's fixed 500. */
export class JavaNullPointerException extends Error {
  constructor() {
    super('NullPointerException');
  }
}
