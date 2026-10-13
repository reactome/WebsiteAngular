import { describe, expect, it } from 'vitest';
import { articleIndexItem } from './articleIndexItem';

describe('articleIndexItem', () => {
  it('parses the date and gives an article without tags an empty list', () => {
    const item = articleIndexItem({
      title: 'Release 97',
      date: '2026-09-15' as unknown as Date,
      slug: 'release-97',
    });
    expect(item.date).toEqual(new Date('2026-09-15'));
    expect(item.tags).toEqual([]);
  });

  it('leaves out what the index did not have, rather than setting it to undefined', () => {
    const item = articleIndexItem({ title: 'Release 97', date: new Date(0), slug: 'release-97' });
    expect(Object.keys(item)).not.toContain('author');
    expect(Object.keys(item)).not.toContain('excerpt');
  });

  it('keeps the author and excerpt it was given', () => {
    const item = articleIndexItem({
      title: 'Release 97',
      date: new Date(0),
      slug: 'release-97',
      author: 'Reactome',
      excerpt: 'New pathways.',
      tags: ['release'],
    });
    expect(item).toMatchObject({ author: 'Reactome', excerpt: 'New pathways.', tags: ['release'] });
  });
});
