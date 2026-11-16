import { describe, expect, it } from 'vitest';
import { noEntriesMessage } from './search.component';

// A search that finds nothing answers 404 with its reasons in `messages`; the
// page shows the first, and its own words for anything else.
describe('noEntriesMessage', () => {
  it("shows the search's first message", () => {
    expect(noEntriesMessage({ messages: ['No entries found for query: xyz', 'other'] })).toBe(
      'No entries found for query: xyz'
    );
  });

  it('falls back where there is no message to show', () => {
    for (const body of [
      null,
      'Not Found',
      {},
      { messages: [] },
      { messages: [''] },
      { messages: [3] },
    ]) {
      expect(noEntriesMessage(body), JSON.stringify(body)).toBe('No entries found');
    }
  });
});
