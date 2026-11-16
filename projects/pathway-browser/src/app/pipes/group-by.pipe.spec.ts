import { describe, expect, it } from 'vitest';
import { GroupByPipe } from './group-by.pipe';

describe('GroupByPipe', () => {
  const pipe = new GroupByPipe();

  it('groups by a dotted path, in the order each key is first met', () => {
    const items = [
      { id: 1, species: { name: 'Homo sapiens' } },
      { id: 2, species: { name: 'Mus musculus' } },
      { id: 3, species: { name: 'Homo sapiens' } },
    ];
    expect(pipe.transform(items, 'species.name')).toEqual([
      { key: 'Homo sapiens', value: [items[0], items[2]] },
      { key: 'Mus musculus', value: [items[1]] },
    ]);
  });

  it('puts an item the path does not reach under undefined', () => {
    const items = [{ species: null }, {}, { species: { name: 'Gallus gallus' } }];
    expect(pipe.transform(items, 'species.name')).toEqual([
      { key: undefined, value: [items[0], items[1]] },
      { key: 'Gallus gallus', value: [items[2]] },
    ]);
  });

  it("reads a text's own properties on the way, as optional indexing does", () => {
    const items = [{ name: 'abc' }, { name: 'xyz' }, { name: 'ab' }];
    expect(pipe.transform(items, 'name.length')).toEqual([
      { key: 3, value: [items[0], items[1]] },
      { key: 2, value: [items[2]] },
    ]);
  });

  it('gives no groups for no property', () => {
    expect(pipe.transform([{ a: 1 }], '')).toEqual([]);
  });
});
