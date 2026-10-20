/**
 * The endpoints the content service answers, and the shape each is declared
 * in (spec 014, data-model.md). Until the families move out of service.ts
 * the list is service.ts's, typed there as `Endpoint[]`; once they do, the
 * registry assembles it here, and routing, endpointFor, the parity harness,
 * the invalid-input corpus and the specs read it from here.
 */
import type { Request as ExpressRequest } from 'express';

/** What a handler answers: a status, and the body and headers to write with it. */
export interface Answer {
  status: number;
  type?: string;
  body?: unknown;
  serialised?: string;
  headers?: Record<string, string>;
}

/** A handler, and whether it is called once at start (`cached` sets it). */
// An answer, or a promise of one: the server awaits either.
export type Handler = ((request: Request) => Answer | Promise<Answer>) & { warms?: boolean };

/**
 * The request as handlers read it: Express's, any part of which may be
 * absent -- specs call handlers with a stand-in carrying only what each reads,
 * and the warm-up with `{ params: {} }` -- with readBody's mark on a body too
 * large to read.
 */
export type Request = Partial<ExpressRequest> & { tooLarge?: boolean };

/** One route the service answers (spec 014, research R4: the fields the 88 use). */
export interface Endpoint {
  /** The route under /ContentService, `{name}` for a path variable. */
  path: string;
  handler: Handler;
  /** Absent: GET (and HEAD). */
  method?: 'post';
  /** The id the parity harness and the invalid-input corpus fill `{id}` with. */
  sample?: string;
  /** Values for path variables other than `{id}`. */
  samplePath?: Record<string, string>;
  /** A POST's body for the harness. */
  sampleBody?: string;
  /** The harness uses only `sample`, never the ids it is given. */
  samplesOnly?: boolean;
  /** Differences from Java this endpoint declares; the harness reports them as intended. */
  differs?: RegExp[];
  // Function properties, not methods: a method's parameter is checked
  // bivariantly, so `(java: SomeShape[]) => …` would pass for `unknown` and
  // claim a shape nothing checks. Java's JSON comes in unknown; an endpoint
  // that assumes its shape says so with a cast where it reads it.
  /** A transformation of Java's answer this endpoint's answer is meant to equal. */
  normalise?: (java: unknown) => unknown;
  /** The key a list's items are compared by when their order is not part of the answer. */
  unordered?: (item: unknown) => unknown;
  /** A deep query: it takes a share of the pool (the deep-query limit). */
  deep?: boolean;
}
