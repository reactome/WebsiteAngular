import { describe, expect, it } from 'vitest';
import type { DatabaseObject } from '../../model/graph/database-object.model';
import type { JsogObject } from '../../utils/JSOGDeserializer';
import { moleculesOf } from './molecules-of';

// #762: the entity popup's Molecules tab read the enhanced query plain, where
// an object the answer has already written comes again as its bare dbId -- and
// dropped those, so a component written elsewhere first went missing. Asked
// with includeRef, it comes as {"@ref": …}, which moleculesOf resolves.

const answer = (fields: object) => fields as unknown as JsogObject<DatabaseObject>;

describe("the entity popup's molecules", () => {
  it('lists a component the answer wrote earlier, resolved from its reference', () => {
    const molecules = moleculesOf(
      answer({
        '@id': '1',
        dbId: 100,
        stId: 'R-HSA-100',
        displayName: 'A complex',
        schemaClass: 'Complex',
        // Written here first...
        positivelyRegulates: [
          {
            '@id': '2',
            dbId: 200,
            stId: 'R-HSA-200',
            displayName: 'TP53',
            schemaClass: 'EntityWithAccessionedSequence',
          },
        ],
        // ...so the components list refers back to it.
        hasComponent: [
          { '@ref': '2' },
          {
            '@id': '3',
            dbId: 300,
            stId: 'R-HSA-300',
            displayName: 'ATP',
            schemaClass: 'SimpleEntity',
          },
        ],
      })
    );
    expect(molecules.map((m) => [m.stId, m.displayName, m.schemaClass])).toEqual([
      ['R-HSA-200', 'TP53', 'EntityWithAccessionedSequence'],
      ['R-HSA-300', 'ATP', 'SimpleEntity'],
    ]);
  });

  it('lists members and candidates as well as components', () => {
    const molecules = moleculesOf(
      answer({
        '@id': '1',
        dbId: 100,
        schemaClass: 'CandidateSet',
        hasMember: [{ '@id': '2', dbId: 200, displayName: 'One' }],
        hasCandidate: [{ '@id': '3', dbId: 300, displayName: 'Two' }],
      })
    );
    expect(molecules.map((m) => m.displayName)).toEqual(['One', 'Two']);
  });

  it('lists the entity itself when it has none, so the tab is never blank', () => {
    const molecules = moleculesOf(
      answer({ '@id': '1', dbId: 100, displayName: 'ATP', schemaClass: 'SimpleEntity' })
    );
    expect(molecules.map((m) => m.displayName)).toEqual(['ATP']);
  });
});
