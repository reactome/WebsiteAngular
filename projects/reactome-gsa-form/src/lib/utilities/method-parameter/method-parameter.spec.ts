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
import { Parameter } from '../../model/parameter.model';

const recordedMethods: { name: string; parameters: Parameter[] }[] = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../e2e/fixtures/gsa-methods.json'), 'utf8')
);

const recordedParameters = recordedMethods.flatMap((method) => method.parameters);
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
    const typed = { name: 'notify', type: 'email' } as unknown as Parameter;
    expect(isEmailParameter(typed)).toBe(true);
  });
});
