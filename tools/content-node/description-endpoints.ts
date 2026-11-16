/**
 * The API description (spec 016, T028): projects/contract/openapi.json, the
 * OpenAPI document generated from the shared contract, with each operation,
 * its parameters and its errors as Java documents them
 * (tools/contract/generate.ts). The site's API page reads it. Java's own,
 * /ContentService/v3/api-docs, is still Java's: this is at a URL of its own,
 * so nothing Java answers changes. Read once, on the first request; the file
 * is in the image beside the service (deploy/content-node/Dockerfile).
 */
import { readFileSync } from 'node:fs';
import type { Endpoint } from './endpoint.ts';

const DESCRIPTION = new URL('../../projects/contract/openapi.json', import.meta.url);

let description: string | undefined;

export const descriptionEndpoints: Endpoint[] = [
  {
    path: '/ContentService/openapi.json',
    // No sample: Java has no such URL, so the parity harness has nothing to
    // compare it with. description-endpoints.spec.ts holds it.
    samplesOnly: true,
    handler: () => ({
      status: 200,
      type: 'application/json',
      serialised: (description ??= readFileSync(DESCRIPTION, 'utf8')),
    }),
  },
];
