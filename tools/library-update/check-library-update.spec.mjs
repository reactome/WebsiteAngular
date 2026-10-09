import { describe, expect, it } from 'vitest';
import { compare } from './check-library-update.mjs';

const lib = 'node_modules/ngx-reactome-style';
const pinned = (sha) => ({
  version: '0.1.0',
  resolved: `git+ssh://git@github.com/reactome/ngx-reactome-base.git#${sha}`,
});

describe('the library-update guard', () => {
  it('passes a moved library pin', () => {
    const before = { [lib]: pinned('a'), 'node_modules/lodash': { version: '4.17.23' } };
    const after = { [lib]: pinned('b'), 'node_modules/lodash': { version: '4.17.23' } };
    expect(compare(before, after)).toEqual({ updated: [lib], stray: [] });
  });

  it('names anything else that moved with it', () => {
    const before = { [lib]: pinned('a'), 'node_modules/lodash': { version: '4.17.23' } };
    const after = { [lib]: pinned('b'), 'node_modules/lodash': { version: '4.18.1' } };
    expect(compare(before, after).stray).toEqual(['node_modules/lodash']);
  });

  it('counts an entry added or removed as moved', () => {
    expect(compare({}, { 'node_modules/new': { version: '1.0.0' } }).stray).toEqual([
      'node_modules/new',
    ]);
    expect(compare({ 'node_modules/old': { version: '1.0.0' } }, {}).stray).toEqual([
      'node_modules/old',
    ]);
  });

  it('reports nothing when nothing moved', () => {
    expect(compare({ [lib]: pinned('a') }, { [lib]: pinned('a') })).toEqual({
      updated: [],
      stray: [],
    });
  });
});
