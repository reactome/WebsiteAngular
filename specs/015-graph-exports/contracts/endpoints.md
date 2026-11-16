# Contract: the export endpoints

All are answered by the node content service. The bodies come from spec 010's Java library service (research R10; for SBML, started in this repository's `deploy/java-library/` and reached by node as its client, amended 25 Oct 2026), which runs the same exporters the release runs: `sbml-exporter` and `BioPAX3Exporter`. Node writes the headers, the errors and the cache. **When the library service cannot answer** (down, timed out or refusing), node answers 503 in the service's envelope, never a fallback to another implementation. Each takes its slashed form, and none falls back to Java. **Where they are routed today:** SBML in `dev.conf` and `local.conf` and the dev proxy, on beta only; `routes.conf` (release and production) waits for T068, and `routes.spec.ts` lists it in `NOT_YET_ROUTED` until then. BioPAX waits for T052–T054.

**Two consequences of the body coming from the library service** (the 28 Oct review): its SBML of a pathway with a diagram is a 503 while the graph's release is not yet on the download host, from which it reads the diagram (`DIAGRAM_BASE/{release}/diagram/`); and a `HEAD` makes the whole file, as a `GET` does (Express answers HEAD with the GET handler), within the same two-file share. Java behaves the same on the second.

## SBML

`GET /ContentService/exporter/event/{id}.sbml` and `GET /ContentService/exporter/sbml/{id}.xml`

- `{id}`: a stable id (any version) or a dbId of a Pathway or ReactionLikeEvent.
- **200:** `Content-Type: application/sbml+xml;charset=UTF-8`, `Content-Disposition: attachment; filename="{stId}.sbml"` (both forms). The body is SBML Level 3 Version 1. It has the layout package only when the event has its own diagram drawing a reaction.
- **404:** the service's JSON envelope, message `Identifier '{id}' not found`.
- **400:** the envelope, message `The identifier '{id}' does not correspond to a pathway or reaction`.
- **Limits and caching:** a deep endpoint with its own share of 2 (503 with `Retry-After` past it). Cached per release under spec 011, with path kind `oid`; Java's described `includeRef` and `view` parameters are marked ignored.
- **Under the render budget** in the deployed nginx, like the other exporters.

## BioPAX Level 3

`GET /ContentService/exporter/event/{id}.biopax`

- `{id}`: as for SBML.
- **200:** `Content-Type: application/rdf+xml;charset=UTF-8`, `Content-Disposition: attachment; filename="{stId}.biopax"`. The endpoint opts out of the download guard, because its extension is not in Spring's trusted list and it has no Java counterpart to imitate. The body is BioPAX Level 3 RDF/XML.
- **404 / 400:** as for SBML.
- **Limits and caching:** deep, cached per release.

## The legacy BioPAX link

`GET /ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/{dbId}`

- **301** to `/ContentService/exporter/event/{stId}.biopax`: node resolves the dbId to its stable id, so the reader lands on a stable address (constitution IV). The query is kept, as the fireworks redirect keeps it. A dbId that is no event is a 404 in the envelope. Routed in `routes-core.conf`, so local has it too, and in `proxy.conf.js`.
- Level 2 is not answered: it is out of scope, and nothing on the site links it.

## The site

Both download links (the Pathway Browser's download tab, and the website's detail download bar) point to `/ContentService/exporter/event/{stId}.biopax` once the export ships. The `RESTFUL_API` constant is then deleted. Until then, nginx and the dev proxy route the legacy path to the beta host's own legacy service (research R7).
