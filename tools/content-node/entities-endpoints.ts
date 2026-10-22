/**
 * The physical entity endpoints (spec 014, research R1, a family): an
 * event's participants (/data/participants/*), an entity's other forms
 * and component-of (/data/entity/*), and complexes
 * (/data/complex*), with the helpers only they use. Moved unchanged from
 * service.ts.
 */
import type { Endpoint } from './endpoint.ts';
import { javaError, neo4jFailureMessage, notFound, only } from './answers.ts';
import { pathId, queryValues, rawSegment, springPrimitiveBoolean } from './spring.ts';
import { graphCoreId } from './objects.ts';
import { read } from './graph.ts';
import type { Props } from './objects.ts';
import { referenceEntityJson } from './reference-entities.ts';
import type { Failure } from './answers.ts';

/**
 * The driver's Value.asString() as graph-core calls it on a reference
 * entity's fields: a missing value is not left out but written as the text
 * "null", because NullValue.asString() returns that.
 */
function asJavaString(value) {
  return value === null || value === undefined ? 'null' : String(value);
}

/**
 * The relationships Java's participants queries follow from the event. The
 * dbId query also follows RNAMarker and proteinMarker and the stable-id one
 * does not -- a difference in graph-core, kept, because it shows: for a Cell
 * the dbId form reaches its RNA markers and the stable-id form returns [].
 */
export function participantsFrom(byDbId) {
  return byDbId
    ? 'hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|RNAMarker|proteinMarker|regulator'
    : 'hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator';
}

/**
 * graph-core's Participant as Java writes it: the entity's dbId, name and
 * class (a missing name or class left out -- asString(null) there), then its
 * reference entities in ParticipantRefEntities' field order.
 */
export function participantJson(row) {
  return {
    peDbId: row.peDbId,
    ...only(row, ['displayName', 'schemaClass']),
    refEntities: (row.refEntities ?? []).map((ref) => ({
      dbId: ref.dbId,
      stId: asJavaString(ref.stId),
      identifier: asJavaString(ref.identifier),
      schemaClass: asJavaString(ref.schemaClass),
      displayName: asJavaString(ref.displayName),
      icon: asJavaString(ref.icon),
      url: asJavaString(ref.url),
    })),
  };
}

/** EntityWithAccessionedSequence.getClassName: by the reference type. */
const EWAS_CLASS_NAMES = {
  ReferenceGeneProduct: 'Protein',
  ReferenceDNASequence: 'DNA Sequence',
  ReferenceRNASequence: 'RNA Sequence',
};

/** The stored fields, in the order Jackson writes them for every class here. */
const PHYSICAL_ENTITY_FIELDS = [
  'dbId',
  'displayName',
  'stId',
  'stIdVersion',
  'definition',
  'maxDepth',
  'name',
  'speciesName',
  'systematicName',
  // Each class's own, after PhysicalEntity's; no node has two classes' worth.
  'isChimeric',
  'stoichiometryKnown',
  'isOrdered',
  'maxUnitCount',
  'minUnitCount',
  'endCoordinate',
  'referenceType',
  'startCoordinate',
];

/**
 * The classes whose getClassName graph-core overrides, and what it says. Jackson
 * writes an overridden className before inDisease; DatabaseObject's own -- the
 * simple class name -- comes last.
 */
const PHYSICAL_ENTITY_CLASS_NAMES = {
  GenomeEncodedEntity: 'Genes and Transcripts',
  SimpleEntity: 'Chemical Compound',
  CandidateSet: 'Set',
  DefinedSet: 'Set',
  OpenSet: 'Set',
};

/**
 * A physical entity as graph-core serialises a bare node. Measured from Java
 * over every class (17 Oct 2026; Cell, which nothing contains, from
 * graph-core's getters), and the class names from graph-core's getters:
 *
 * - an EWAS is named by its reference type (Protein, DNA Sequence, RNA
 *   Sequence), and anything else -- an isoform's -- falls back to
 *   GenomeEncodedEntity's "Genes and Transcripts";
 * - a GenomeEncodedEntity is "Genes and Transcripts", a SimpleEntity a
 *   "Chemical Compound", and every set a "Set";
 * - a complex, polymer, drug, cell or other entity has no override, so
 *   DatabaseObject's simple class name, and Jackson writes it last rather
 *   than before inDisease.
 *
 * `isInDisease` is written as `inDisease`; `oldStId` never (@JsonIgnore).
 */
export function physicalEntityJson(node) {
  const head = only(node, PHYSICAL_ENTITY_FIELDS);
  const tail = only({ inDisease: node.isInDisease, schemaClass: node.schemaClass }, [
    'inDisease',
    'schemaClass',
  ]);
  if (node.schemaClass === 'EntityWithAccessionedSequence') {
    const className = EWAS_CLASS_NAMES[node.referenceType] ?? 'Genes and Transcripts';
    return { ...head, className, ...tail };
  }
  const className = PHYSICAL_ENTITY_CLASS_NAMES[node.schemaClass];
  if (className) return { ...head, className, ...tail };
  return { ...head, ...tail, ...(node.schemaClass && { className: node.schemaClass }) };
}

export const entitiesEndpoints: Endpoint[] = [
  {
    path: '/ContentService/data/participants/{id}/referenceEntities',
    // A reaction with 141 reference entities of four classes.
    sample: 'R-HSA-5672965',
    /**
     * The reference entities -- the proteins, genes, chemicals and drugs --
     * behind every participant of an event, all the way down. The Pathway
     * Browser's molecule list and the IDG page ask for it.
     *
     * Java's one query (graph-core ReferenceEntityRepository
     * .getParticipatingReferenceEntities), kept as written so the rows come in
     * Java's order. The id is read as everywhere else; a REACT_ id is swapped
     * for its stable id first, as getIdentifier does.
     *
     * Not a 404 when nothing is found, which is Java's contract and not ours to
     * change: an unknown id is `[]`, and an id that is neither a stable id nor
     * a dbId is a 200 with no body at all (the controller returns null).
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const id = await graphCoreId(raw);
      if (!id) return { status: 200, body: undefined };
      const { object, params } = id;
      const rows = await read<{ m: Props; labels: string[] }>(
        `MATCH (n:DatabaseObject${object})-[:hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|referenceEntity|proteinMarker|RNAMarker*]->(m:ReferenceEntity)
         RETURN DISTINCT m, labels(m) AS labels`,
        params
      );
      return {
        status: 200,
        body: rows.map((row) => referenceEntityJson(row.m, row.labels)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/participants/{id}/participatingPhysicalEntities',
    // A reaction's participants, sets and small molecules among them.
    sample: 'R-HSA-5672965',
    /**
     * Every physical entity taking part in an event, all the way down through
     * its sub-events, catalysts and regulators, written whole.
     *
     * graph-core's PhysicalEntityRepository.getParticipatingPhysicalEntities,
     * kept as written so the rows come in Java's order; the id is read as
     * graph-core reads it (graphCoreId). Java's contract, as for
     * /referenceEntities: nothing found is `[]`, and an id that is neither a
     * stable id nor a dbId is a 200 with no body (the service returns null).
     */
    handler: async (request) => {
      const id = await graphCoreId(pathId(rawSegment(request, 4)));
      if (!id) return { status: 200, body: undefined };
      const rows = await read<{ m: Props }>(
        `MATCH (n:DatabaseObject${id.object})-[:hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator*]->(m:PhysicalEntity) RETURN Distinct(m)`,
        id.params
      );
      return {
        status: 200,
        body: rows.map((row) => physicalEntityJson(row.m)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/participants/{id}',
    // A reaction with five participants of four classes.
    sample: 'R-HSA-5672965',
    /**
     * Every physical entity taking part in an event, all the way down, each
     * with the reference entities behind it. The Pathway Browser's molecule
     * list asks for it.
     *
     * Java's two queries (graph-core ParticipantRepository.getParticipants),
     * one per kind of id, kept as written -- they differ: the dbId one also
     * follows RNAMarker and proteinMarker from the event. The id is read as
     * everywhere else; a REACT_ id is swapped for its stable id first.
     *
     * Java's contract, as for /referenceEntities: an unknown id is [], an id
     * that is neither a stable id nor a dbId a 200 with no body.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const id = await graphCoreId(raw);
      if (!id) return { status: 200, body: undefined };
      const { params, byDbId } = id;
      const object = byDbId ? '{dbId: toInteger($id)}' : '{stId: $id}';
      const from = participantsFrom(byDbId);
      const rows = await read<{
        peDbId: number;
        displayName: string | null;
        schemaClass: string;
        refEntities: Props[];
      }>(
        `MATCH (n:DatabaseObject${object})-[:${from}*]->(m:PhysicalEntity)
         OPTIONAL MATCH (m)-[:referenceEntity]->(re1:ReferenceEntity)
         OPTIONAL MATCH (m)-[:hasMember|hasComponent|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe:PhysicalEntity)-[:referenceEntity]->(re2:ReferenceEntity)
         WITH DISTINCT m,
              CASE WHEN re1 IS NULL THEN re2 ELSE re1 END AS re,
              CASE WHEN pe IS NULL THEN m.schemaClass ELSE pe.schemaClass END AS icon
         WHERE NOT re IS NULL
         RETURN m.dbId AS peDbId,
                m.displayName AS displayName,
                m.schemaClass AS schemaClass,
                COLLECT(DISTINCT({
                       dbId: re.dbId,
                       stId: re.stId,
                       displayName: re.displayName,
                       identifier: CASE WHEN re.variantIdentifier IS NOT NULL THEN re.variantIdentifier ELSE re.identifier END,
                       url: re.url,
                       schemaClass: re.schemaClass,
                       icon: icon
                })) AS refEntities`,
        params
      );
      return { status: 200, body: rows.map(participantJson), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/entity/{id}/otherForms',
    // PTEN: 120 other forms, all proteins.
    sample: 'R-HSA-199420',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/entity\/[^/]+\/otherForms: \.url: /],
    /**
     * The other physical entities made from the same reference entity -- the
     * same protein modified, in another compartment, or another species' form.
     * The details panel and the entity popup show them.
     *
     * Java's query (graph-core PhysicalEntityRepository.getOtherFormsOf), kept
     * as written. The id is read as everywhere else; a REACT_ id is swapped for
     * its stable id first. Nothing found -- an unknown id, one with no other
     * forms, one that is not an entity -- is Java's 404.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      const id = await graphCoreId(raw);
      if (!id) return missing();
      const { object, params } = id;
      const rows = await read<{ k: Props }>(
        `MATCH (n:PhysicalEntity${object})-[:referenceEntity]->(m:ReferenceEntity)<-[:referenceEntity]-(k)
         WHERE NOT n=k RETURN k`,
        params
      );
      if (rows.length === 0) return missing();
      return {
        status: 200,
        body: rows.map((row) => physicalEntityJson(row.k)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/entity/{id}/componentOf',
    // PTEN: the reactions it comes out of and goes into, and the complexes and
    // sets it is part of.
    sample: 'R-HSA-199420',
    differs: [/^\/ContentService\/data\/entity\/[^/]+\/componentOf: \.url: /],
    /**
     * What an entity or event is directly part of -- the reactions, complexes,
     * sets and pathways above it -- one group per relationship, each with the
     * names, stable ids, classes and species of its members, '' for what one
     * lacks. The details page's "Component of" table.
     *
     * graph-core's ComponentOfLinkageRepository.getComponentsOf, kept as
     * written: the groups and their members come in the order Neo4j gives
     * them, unsorted (ComponentOf.sortByName is never called). The id is read as graph-core reads it
     * (graphCoreId); none found, or part of nothing, is Java's 404.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      const id = await graphCoreId(raw);
      if (!id) return missing();
      const rows = await read<{
        type: string;
        schemaClasses: string[];
        names: string[];
        stIds: string[];
        species: string[];
      }>(
        `MATCH (n:DatabaseObject${id.object})<-[r:hasEvent|input|output|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker]-(m)
         RETURN DISTINCT(TYPE(r)) AS type,
                COLLECT(COALESCE(m.schemaClass, '')) AS schemaClasses,
                COLLECT(COALESCE(m.displayName, '')) AS names,
                COLLECT(COALESCE(m.stId, '')) AS stIds,
                COLLECT(COALESCE(m.speciesName, '')) as species`,
        id.params
      );
      if (rows.length === 0) return missing();
      return {
        status: 200,
        // ComponentOf's fields in declaration order; none is ever empty.
        body: rows.map(({ type, names, stIds, schemaClasses, species }) => ({
          type,
          names,
          stIds,
          schemaClasses,
          species,
        })),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/complex/{id}/subunits',
    // A set: 354 entities under it -- complexes, sets, proteins and small molecules.
    sample: 'R-HSA-5672601',
    differs: [/^\/ContentService\/data\/complex\/[^/]+\/subunits(\?\S*)?: \.url: /],
    /**
     * Everything a complex or set is made of, all the way down; with
     * excludeStructures, only what is neither a complex nor a set.
     *
     * graph-core's PhysicalEntityRepository.getPhysicalEntitySubunits and
     * getPhysicalEntitySubunitsNoStructures, kept as written; the id is read
     * as graph-core reads it (graphCoreId), and none found, or nothing under
     * it, is Java's 404. excludeStructures is a primitive boolean that
     * defaults to false, bound before anything is looked up.
     *
     * graph-core's stable-id NoStructures query fails in Java: its parameter
     * reaches Neo4j without the name the query reads. So excludeStructures
     * with a stable id (a REACT_ one too) is Java's 500, said here without
     * running the subunits query; with a dbId it works.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const exclude = springPrimitiveBoolean(queryValues(request, 'excludeStructures'), false);
      if (exclude.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', exclude.error);
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      const id = await graphCoreId(raw);
      if (!id) return missing();
      if (exclude.value && !id.byDbId) {
        const failure = {
          code: 'Neo.ClientError.Statement.ParameterMissing',
          message: 'Expected parameter(s): stId',
        };
        return javaError(
          request,
          500,
          'INTERNAL_SERVER_ERROR',
          // Its own code is in the list, so this is a message.
          neo4jFailureMessage(failure, [failure.code]) as string
        );
      }
      const noStructures = exclude.value ? ' WHERE NOT (pe:Complex) AND NOT(pe:EntitySet)' : '';
      const rows = await read<{ pe: Props }>(
        `MATCH (:PhysicalEntity${id.object})-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe:PhysicalEntity)${noStructures} RETURN DISTINCT pe`,
        id.params
      );
      if (rows.length === 0) return missing();
      return {
        status: 200,
        body: rows.map((row) => physicalEntityJson(row.pe)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/complexes/{resource}/{identifier}',
    // EGFR: 181 complexes.
    samplePath: { resource: 'UniProt', identifier: 'P00533' },
    differs: [/^\/ContentService\/data\/complexes\/[^/]+\/[^/]+: \.url: /],
    /**
     * The complexes an identifier in an outside resource is part of: the
     * reference entities with that identifier in that resource, the
     * entities made from them, and every complex above those.
     *
     * graph-core's PhysicalEntityRepository.getComplexesFor, kept as written.
     * The resource reaches Neo4j as Java passes it, a regular expression
     * matched against the database's name: `UniProt` matches, `uniprot` does
     * not, `(?i)uniprot` does, and one Neo4j cannot read is Java's 500 with
     * Neo4j's message. None found is Java's 404, naming the identifier first.
     */
    handler: async (request) => {
      const resource = pathId(rawSegment(request, 4));
      const identifier = pathId(rawSegment(request, 5));
      let rows;
      try {
        rows = await read<{ c: Props }>(
          'MATCH (rd:ReferenceDatabase)<-[:referenceDatabase]-(n{identifier:$identifier}) WHERE rd.displayName =~ $resource WITH DISTINCT n MATCH (n)<-[:referenceEntity|referenceSequence|crossReference|referenceGene*]-(pe:PhysicalEntity) WITH DISTINCT pe MATCH (c:Complex)-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe) RETURN DISTINCT c',
          { identifier, resource }
        );
      } catch (caught) {
        const failure = caught as Failure | undefined;
        const message = /^Invalid Regex/.test(failure?.message ?? '')
          ? neo4jFailureMessage(failure, ['Neo.ClientError.Statement.SemanticError'])
          : undefined;
        if (message) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', message);
        throw caught;
      }
      if (rows.length === 0)
        return notFound(request, `No complexes found for (${identifier}, ${resource})`);
      return {
        status: 200,
        body: rows.map((row) => physicalEntityJson(row.c)),
        type: 'application/json',
      };
    },
  },
];
