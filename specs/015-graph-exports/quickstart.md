# Quickstart: validating the graph-based exports

Run from the repository root. Host-specific settings (database addresses, credentials, store locations) come from the deployment's environment, never from this repository. Requests against the shared graph are small, sequential and spaced (FR-014). The release's published bulk files are fetched from its download directory, one at a time, and kept outside the repository.

## 1. The unit and route checks

```sh
npx vitest run tools/exports-compare tools/content-node deploy/nginx
```

Expected:

- the routes' specs pass, with the export URLs routed to node;
- the comparison tools' own specs pass, including the cases that must fail;
- `routes.spec.ts` shows the new routes to node in the deployed and local tables, with SBGN and the event PDF still in Java.

## 2. The validators (as CI runs them)

Each exporter's own CI runs its validator over its output for a small fixture graph (T042, T051). Here, the validators run over each comparison's output (T034, T041, T050). Expected: 0 errors from each; libSBML's warnings are allowed.

## 3. SBML against the reference

1. Get today's relational files for the 30-event sample from a ContentService of the same release that is not production, one event at a time (research R1). They stay outside the repository: they hold personal names.
2. Run the fixed `sbml-exporter` over each event, from the private graph copy (or, once switched, ask the website).
3. Run `sbml-exporter`'s `ci/compare.py` over the two folders.

Expected: the model matches element by element apart from element order, the generation note's timestamp and what the layout changes in the model (FR-002). The layout has the same glyphs, ids, roles and order as today's file. The coordinate differences are only those [differences.md](contracts/differences.md) lists.

## 4. BioPAX against today's file

1. For a sample of events, take today's legacy BioPAX once from the beta host's own legacy service (`/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/{dbId}` on its Tomcat), spaced. The files stay outside the repository: they hold personal names.
2. Run `BioPAX3Exporter` over the same events, from the private graph copy (or, once switched, ask the website).
3. Run the BioPAX comparison tool.

Expected: no difference outside [differences.md](contracts/differences.md).

## 5. On beta, before and after switching a route

- Deploy the content service and spec 010's library service, then ask for a reaction's and a pathway's SBML and BioPAX through nginx. Stop the library service and check both answer 503 in the envelope.
- **Expected:**
  - 200 with the [contract](contracts/endpoints.md)'s headers;
  - the second ask is served from the cache;
  - the legacy BioPAX URL answers 301 to the new one;
  - SBGN still comes from Java;
  - the parity harness (`diff.ts`) reports SBML's status, headers and errors equal to Java's.

## 6. The site's links

Once BioPAX ships, check both download links (the Pathway Browser's download tab and the website's detail download bar). Expected: a `.biopax` file, never an HTML page.
