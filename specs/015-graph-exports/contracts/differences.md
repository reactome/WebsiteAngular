# Accepted differences

Each way the new exports differ from their reference, with the reason. An export switches only when every difference its sample shows is here. Additions found during the work are recorded with the pull request that finds them.

SBML's model is compared with today's relational file of the same release (decided 24 Oct 2026; there is no separate corrected-converter reference any more). The one list for SBML is `sbml-exporter`'s [`specs/001-graph-only-sbml/differences.md`](https://github.com/reactome/sbml-exporter/blob/graph-only/specs/001-graph-only-sbml/differences.md), which its T016 creates; the rows below move there then. The generation note's timestamp is set aside, as it differs on every answer, today's too.

## SBML, from today's relational file

| Difference                                                                                                          | Reason                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A reaction's model names its first parent pathway, with its notes and annotations, not "No parent pathway detected" | The graph-only converter's form                                             |
| Species and reactions in the queries' order, and metaids to match                                                   | Today's order is HashSet order, which cannot be reproduced                  |
| Complex identifiers and URLs as the graph-only converter builds them, and EC numbers in query order                 | The graph-only converter's form                                             |
| Reaction literature includes the direct references, with the graph's `url`                                          | The graph-only converter's form                                             |
| Layout coordinates are the diagram's own, not offset                                                                | The offset is the curator tool's origin, stored nowhere else                |
| Node sizes are the stored ones, so 10 of R-HSA-69620's 153 nodes, and the 14 edges ending on them, differ           | Java resized them to fit their text with font metrics, which nothing stores |
| A label's size is its node's box                                                                                    | The same font metrics                                                       |

## BioPAX, from today's file

| Difference                                                                 | Reason                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Element order and `rdf:ID` numbers                                         | Today's come from Java HashMap order, which is not reproducible even Java against Java |
| One EC number per molecular function                                       | The graph keeps one (research R4)                                                      |
| Book chapter authors                                                       | Not in the graph                                                                       |
| Every cross-reference and disease of an entity is written                  | Today's converter stops at the first one it has already written                        |
| `application/rdf+xml`, a `{stId}.biopax` download name, 404 and 400 errors | Today's is `text/plain` with no name, and its errors are 200 text bodies               |
| The URL, and a 301 from the legacy one                                     | Java's ContentService has no BioPAX URL                                                |
