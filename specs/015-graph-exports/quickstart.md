# Quickstart: validating the graph-based exports

Run from the repository root. Host-specific settings (database addresses, credentials, store locations) come from the deployment's environment, never from this repository. Requests against the shared graph are small, sequential and spaced (FR-011).

## 1. The unit and route checks

```sh
npx vitest run tools/content-node deploy/nginx
```

Expected:

- the SBML and BioPAX writer specs pass;
- the comparison tools' own specs pass, including the cases that must fail;
- `routes.spec.ts` shows the new routes to node in the deployed and local tables, with SBGN and the event PDF still in Java.

## 2. The validators (as CI runs them)

The `exports` job in `.github/workflows/tests.yml`: it builds the sample files from the recorded fixtures, then runs libSBML's consistency check and the BioPAX validator over them. Expected: 0 errors from each. libSBML's warnings are allowed.

## 3. SBML against the reference

1. Generate the reference files once, for the 30-event sample, with the corrected graph-only converter (research R1). Run it against a private graph database of the same release where possible (research R8). The references stay outside the repository: they hold personal names.
2. Ask the node service for each event's SBML.
3. Run the SBML comparison tool over the pairs.

Expected: the model is identical apart from the generation note. The layout has the same glyphs, ids, roles and order as today's file. The coordinate differences are only those [differences.md](contracts/differences.md) lists.

## 4. BioPAX against today's file

1. For a sample of events, take today's legacy BioPAX once from reactome.org, spaced.
2. Ask the node service for the same events.
3. Run the BioPAX comparison tool.

Expected: no difference outside [differences.md](contracts/differences.md).

## 5. On beta, before and after switching a route

- Deploy the content service, then ask for a reaction's and a pathway's SBML and BioPAX through nginx.
- **Expected:**
  - 200 with the [contract](contracts/endpoints.md)'s headers;
  - the second ask is served from the cache;
  - the legacy BioPAX URL answers 301 to the new one;
  - SBGN still comes from Java;
  - the parity harness (`diff.ts`) reports SBML's status, headers and errors equal to Java's.

## 6. The site's links

Once BioPAX ships, check both download links (the Pathway Browser's download tab and the website's detail download bar). Expected: a `.biopax` file, never an HTML page.
