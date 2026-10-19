// @vitest-environment node
//
// What is on record, and what cannot be checked is counted, never dropped.
import path from 'node:path';
import { expect, it } from 'vitest';
import { recordedAnswers } from './answers.mjs';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

it('keeps successful JSON content answers with a body, and counts the rest', () => {
  const { answers, skipped } = recordedAnswers({
    hars: path.join(FIXTURES, 'har'),
    recorded: path.join(FIXTURES, 'recorded'),
  });
  expect(
    answers.map((a) => [a.method, a.path, a.query.toString(), a.source, JSON.parse(a.body)])
  ).toEqual([
    ['GET', '/data/species/main', '', 'sample.har', [{ dbId: 48887, displayName: 'Homo sapiens' }]],
    // A JSON number, though served as text/plain.
    ['GET', '/data/database/version', '', 'sample.har', 97],
    ['GET', '/search/query', 'query=PTEN&types=Protein', 'sample.har', { results: [] }],
    ['GET', '/data/entity/R-HSA-2/in-depth', 'maxDepth=1', 'in-depth.json', null],
  ]);
  // The 404, the aborted request, the one kept without a body, the citation's
  // text;
  // the AnalysisService answer is not the content API's to count.
  expect(skipped).toEqual({ notOk: 2, noBody: 1, notJson: 1 });
});
