/**
 * Which parameter counts as an e-mail address.
 *
 * The validator and the rendered field used to answer this differently. The
 * validator asked `type === 'email' || name.includes('email')`; the template
 * switched on `type` alone. GSAServer sends the address as `type: "string"`, so
 * the validator attached and the template rendered the plain-string branch --
 * which carries no `mat-error`. A malformed address turned the field red with
 * no message, and was submitted anyway (#241).
 *
 * Both now go through `isEmailParameter`, so they cannot disagree again.
 *
 * The rendering itself is not asserted here: this component has an external
 * templateUrl, which the vitest setup cannot compile (see the note in
 * vitest.config.ts). The recorded payload is used rather than a hand-written
 * parameter so that a change in what GSAServer actually sends breaks this.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isEmailParameter } from './method-parameter.component';

type RecordedParameter = { name: string; type: string };

const isRecordedParameter = (p: unknown): p is RecordedParameter =>
  typeof p === 'object' &&
  p !== null &&
  'name' in p &&
  typeof p.name === 'string' &&
  'type' in p &&
  typeof p.type === 'string';

/** A recorded method's parameters; a method or parameter of another shape fails the load. */
function parametersOf(method: unknown): RecordedParameter[] {
  const parameters: unknown =
    typeof method === 'object' && method !== null && 'parameters' in method
      ? method.parameters
      : undefined;
  if (!Array.isArray(parameters) || !parameters.every(isRecordedParameter))
    throw new Error('e2e/fixtures/gsa-methods.json holds a method without named, typed parameters');
  return parameters;
}

const recordedMethods: unknown = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../e2e/fixtures/gsa-methods.json'), 'utf8')
);
if (!Array.isArray(recordedMethods))
  throw new Error('e2e/fixtures/gsa-methods.json is not a list of methods');

const recordedParameters = recordedMethods.flatMap(parametersOf);
const recordedEmail = recordedParameters.find((parameter) => parameter.name === 'email');

// Fail loudly at load rather than asserting on an optional in every test: if
// the recording no longer carries an address field, these tests are meaningless
// and should say so rather than pass.
if (!recordedEmail) throw new Error('e2e/fixtures/gsa-methods.json has no "email" parameter');

describe('which GSA parameter holds an e-mail address', () => {
  it('finds the address in what GSAServer actually sends', () => {
    expect(isEmailParameter(recordedEmail)).toBe(true);
  });

  it("is not identified by its type, which is the bug: the server says 'string'", () => {
    // Guards the fix rather than the symptom. If this ever reads 'email', the
    // type-only test the template used to do would have been right all along.
    expect(recordedEmail.type).toBe('string');
  });

  it('leaves every other recorded parameter alone', () => {
    const matched = recordedParameters.filter(isEmailParameter).map((parameter) => parameter.name);
    expect([...new Set(matched)]).toEqual(['email']);
  });

  it('still recognises a type of email, should the server ever send one', () => {
    const typed = { name: 'notify', type: 'email' };
    expect(isEmailParameter(typed)).toBe(true);
  });
});
