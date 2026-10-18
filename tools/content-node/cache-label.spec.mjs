// @vitest-environment node
//
// The caching label each answer carries (cache-label.mjs), row by row from
// specs/011-api-cache-headers/contracts/cache-labels.md. A label that let
// an error, a POST or someone's token through as `public` would have
// Cloudflare keep it until the next release's purge, and hand it to
// everyone who asked.
import { describe, expect, it } from 'vitest';
import { CACHEABLE, defaultLabel, label } from './cache-label.mjs';

const attributes = '/ContentService/data/schema/{id}/attributes';
const of = (overrides) =>
  label({
    method: 'GET',
    endpoint: attributes,
    originalUrl: '/ContentService/data/schema/Pathway/attributes',
    status: 200,
    ...overrides,
  });

describe('label', () => {
  it('is public, kept at the edge until purged and an hour in a browser, for a standard GET or HEAD answered 200', () => {
    expect(CACHEABLE).toBe('public, max-age=3600, s-maxage=31536000');
    expect(of({})).toEqual({ cacheControl: CACHEABLE, rule: 'standard' });
    expect(of({ method: 'HEAD' })).toEqual({ cacheControl: CACHEABLE, rule: 'standard' });
  });

  it('is private, whatever else holds, for a request carrying a token', () => {
    expect(of({ originalUrl: '/ContentService/data/schema/Pathway/attributes?token=abc' })).toEqual(
      {
        cacheControl: 'private, no-store',
        rule: 'token',
      }
    );
    expect(of({ method: 'POST', status: 500, originalUrl: '/x?a=1&token=' })).toEqual({
      cacheControl: 'private, no-store',
      rule: 'token',
    });
  });

  it('is private for an endpoint that takes one person’s data, and not stored for one marked never', () => {
    expect(
      of({
        endpoint: '/ContentService/exporter/diagram/{id}',
        originalUrl: '/ContentService/exporter/diagram/R-HSA-1',
      })
    ).toEqual({ cacheControl: 'private, no-store', rule: 'endpoint' });
    expect(
      of({
        endpoint: '/ContentService/interactors/psicquic/resources',
        originalUrl: '/ContentService/interactors/psicquic/resources',
      })
    ).toEqual({ cacheControl: 'no-store', rule: 'endpoint' });
  });

  it('is not stored for any other method, or any status but 200', () => {
    expect(of({ method: 'POST' })).toEqual({ cacheControl: 'no-store', rule: 'method' });
    expect(of({ method: 'OPTIONS' })).toEqual({ cacheControl: 'no-store', rule: 'method' });
    for (const status of [204, 301, 400, 404, 405, 500, 503])
      expect([status, of({ status })]).toEqual([
        status,
        { cacheControl: 'no-store', rule: 'status' },
      ]);
  });

  it('is not stored, naming what failed, for a URL not in standard form', () => {
    expect(
      of({ originalUrl: '/ContentService/data/schema/Pathway/attributes?utm_source=x' })
    ).toEqual({
      cacheControl: 'no-store',
      rule: 'parameter:utm_source',
    });
    expect(of({ originalUrl: '/ContentService/data/schema/pathway/attributes' })).toEqual({
      cacheControl: 'no-store',
      rule: 'path:id',
    });
    expect(of({ originalUrl: '/ContentService/data/schema/Pathway/attributes/' })).toEqual({
      cacheControl: 'no-store',
      rule: 'form',
    });
  });

  it('does not take a parameter merely named like a token', () => {
    expect(
      of({ originalUrl: '/ContentService/data/schema/Pathway/attributes?tokens=1' }).rule
    ).toBe('parameter:tokens');
    expect(of({ originalUrl: '/ContentService/data/schema/Pathway/attributes?Token=1' }).rule).toBe(
      'parameter:Token'
    );
  });
});

describe('defaultLabel, for an answer that never reached an endpoint', () => {
  it('is not stored, or private when a token came', () => {
    expect(defaultLabel('/ContentService//x')).toEqual({
      cacheControl: 'no-store',
      rule: 'default',
    });
    expect(defaultLabel('/ContentService/x?token=1')).toEqual({
      cacheControl: 'private, no-store',
      rule: 'token',
    });
    expect(defaultLabel('/ContentService/x?%74oken=1')).toEqual({
      cacheControl: 'private, no-store',
      rule: 'token',
    });
  });
});
