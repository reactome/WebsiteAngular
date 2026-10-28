# Contract: the checks

Each check is shown failing on wrong output before it is trusted (constitution III).

## SBML comparison (FR-002, FR-003)

`sbml-exporter`'s `ci/compare.py` (its spec 001, T016), which compares two folders of SBML, wherever the files came from: the exporter's own run, or the website's answer. It replaces the tool this spec first planned here.

- **The model:** element by element with today's relational file of the same release: compartments, species, reactions, reactants, products and modifiers (role, stoichiometry), names, SBO terms, notes, annotations and identifier URLs. Set aside: the generation note's timestamp, element order (today's is HashSet order; elements are matched by id) and the layout, compared below.
- **The layout:** the glyph sets, ids, roles, order and targets exactly, compared with today's file. Coordinates are compared by meaning: today's equal the diagram's plus one offset, except at the nodes Java resized, which are listed.
- **Inputs:** the 30-event sample (pathways of several sizes, reactions, disease and inferred events), drawn once from a private graph of the same release (research R8).
- **Output:** each difference, by element path. Personal values (vCard names) appear as hashes.
- **Shown failing:** on a file with a species reference removed, a sboTerm changed, and a glyph moved (the glyph once the layout is compared, its T021).

## BioPAX comparison (FR-005, FR-009)

A tool that canonicalises two BioPAX files to multisets of (class, property, target-key) triples and lists the differences.

- **How:** each `rdf:ID` is replaced with a content key: DB_ID for events and entities, db+id for xrefs, term for vocabularies, recursive content for features, steps and stoichiometry.
- **Differences** found in [differences.md](differences.md) are reported as accepted. Anything else fails the check.
- **Personal values:** `bp:author` and the curation comments are hashed.
- **Shown failing:** on a file with one participant's stoichiometry changed, and one xref removed.

## Validators (FR-008)

**In each exporter's own CI** (T042, T051): the format's validator over the exporter's output for a small fixture graph. This replaces the first plan's job here, which built exports from recorded rows; the exporters are Java libraries that need a graph.

**Here**, over the comparison runs' output (T034, T041, T050):

1. **SBML:** python-libsbml 5.21.2, `checkConsistency()` with the units and modelling-practice categories off. The job fails on any error or fatal; warnings are allowed.
2. **BioPAX:** the BioPAX validator 6.0.0 (cached by version and sha1, JDK 17), run once over the directory. The job fails on any `ERROR` in its XML reports, because its exit code is always 0.
3. **Shown failing:** on a file whose glyph points at a missing species (libSBML), and on a file with an unknown property (the BioPAX validator).

## Routes

`deploy/nginx/routes.spec.ts`:

- the node endpoints route to node in each table that serves them, and the dev proxy agrees (SBML: `dev.conf` and `local.conf` only, in `NOT_YET_ROUTED` for the deployed table until T068);
- SBGN and the event PDF stay in Java, and are listed among Java's neighbours;
- the render budget covers `.sbml` and `.biopax` once they are routed in the deployed table (T068, T052).
