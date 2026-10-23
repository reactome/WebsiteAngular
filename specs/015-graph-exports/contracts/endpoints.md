# Contract: the export endpoints

All are answered by the node content service from the graph database. Their routes are in nginx (`routes.conf`, `local.conf`, `routes-core.conf`) and the dev proxy alike (`routes.spec.ts`), each with its slashed form. None falls back to Java.

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

- **301** to `/ContentService/exporter/event/{dbId}.biopax`, with the query kept, as the fireworks redirect does. Routed in `routes-core.conf`, so local has it too, and in `proxy.conf.js`.
- Level 2 is not answered: it is out of scope, and nothing on the site links it.

## The site

Both download links (the Pathway Browser's download tab, and the website's detail download bar) point to `/ContentService/exporter/event/{stId}.biopax` once the export ships. The `RESTFUL_API` constant is then deleted. Until then, nginx and the dev proxy route the legacy path to the beta host's own legacy service (research R7).
