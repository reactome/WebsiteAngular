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
import { refusal, submittedDesign, submittedParameters } from './analysis.service';

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

describe('the statistical design a GSA request carries', () => {
  const dataset = (design: object, columns: [string, string[]][]) =>
    ({
      summary: { title: 'A dataset' },
      statisticalDesign: { defaultCovariances: new Set(), covariances: [], ...design },
      annotationColumns: new Map(columns),
    }) as never;
  const columns: [string, string[]][] = [
    ['sample_ids', ['s1', 's2']],
    ['condition', ['a', 'b']],
    ['batch', ['1', '2']],
  ];

  it('names the columns of a complete design, its chosen covariates with them', () => {
    expect(
      submittedDesign(
        dataset(
          {
            analysisGroup: 'condition',
            comparisonGroup1: 'a',
            comparisonGroup2: 'b',
            covariances: [
              { name: 'batch', value: true },
              { name: 'unused', value: false },
            ],
          },
          columns
        )
      )
    ).toEqual({
      analysisGroup: ['a', 'b'],
      samples: ['s1', 's2'],
      comparison: { group1: 'a', group2: 'b' },
      batch: ['1', '2'],
    });
  });

  it('says a design without its groups is not complete, rather than sending it', () => {
    expect(submittedDesign(dataset({ analysisGroup: 'condition' }, columns))).toBe(
      'The statistical design of "A dataset" is not complete'
    );
  });

  it('says so too for a covariate with no column', () => {
    expect(
      submittedDesign(
        dataset(
          {
            analysisGroup: 'condition',
            comparisonGroup1: 'a',
            comparisonGroup2: 'b',
            covariances: [{ name: 'missing', value: true }],
          },
          columns
        )
      )
    ).toBe(
      'The statistical design of "A dataset" names "missing", which its samples have no column for'
    );
  });

  it('names an analysis group the samples have no column for', () => {
    // The default group comes from the service, not the annotation header.
    expect(
      submittedDesign(
        dataset({ analysisGroup: 'tissue', comparisonGroup1: 'a', comparisonGroup2: 'b' }, columns)
      )
    ).toBe(
      'The statistical design of "A dataset" names "tissue", which its samples have no column for'
    );
  });

  it('is refused as a 400 with its reason, never the 503 the form retries', () => {
    const refused = refusal('why');
    expect([refused.status, refused.error]).toEqual([400, { detail: 'why' }]);
  });
});
