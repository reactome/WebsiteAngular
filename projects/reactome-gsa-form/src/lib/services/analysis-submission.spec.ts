/**
 * What a GSA request carries when the reader leaves a field blank.
 *
 * It used to carry the word "undefined". `submitQuery` mapped every parameter
 * through `param.value + ''`, and a parameter seeded from an absent `default`
 * has `value: undefined` — so an unfilled email was submitted as the string
 * `"undefined"`, and the analysis service was asked to deliver a report to an
 * address that cannot exist. Reports arrived; mail did not; nothing said why
 * (#168).
 *
 * The rule is tested rather than the service, because the service needs a store,
 * an HttpClient and a config provider to construct, and none of them have
 * anything to do with the decision being made here.
 */
import { describe, expect, it } from 'vitest';
import { submittedParameters } from './analysis.service';

describe('what a GSA request carries', () => {
  it('leaves out a field the reader never filled in', () => {
    expect(submittedParameters([{ name: 'email', value: undefined } as never])).toEqual([]);
  });

  it('leaves out an empty string, which is a blank box rather than an answer', () => {
    expect(submittedParameters([{ name: 'email', value: '' } as never])).toEqual([]);
  });

  it('keeps false and zero, which are answers', () => {
    expect(
      submittedParameters([
        { name: 'create_reports', value: false } as never,
        { name: 'max_missing_values', value: 0 } as never,
      ])
    ).toEqual([
      { name: 'create_reports', value: 'false' },
      { name: 'max_missing_values', value: '0' },
    ]);
  });

  it('sends what the reader typed', () => {
    expect(submittedParameters([{ name: 'email', value: 'curator@example.org' } as never])).toEqual(
      [{ name: 'email', value: 'curator@example.org' }]
    );
  });
});
