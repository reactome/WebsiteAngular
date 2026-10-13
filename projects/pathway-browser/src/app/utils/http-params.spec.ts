import { describe, expect, it } from 'vitest';
import { httpParams } from './http-params';

describe('httpParams', () => {
  it('leaves out what is unset: undefined, null and an empty list', () => {
    const params = httpParams({
      resource: undefined,
      species: null,
      types: [],
      pageSize: 20,
      interactors: false,
      sortBy: 'ENTITIES_PVALUE',
    });
    expect(params.toString()).toBe('pageSize=20&interactors=false&sortBy=ENTITIES_PVALUE');
  });

  it('sends a list as one parameter per value, as HttpClient does with a plain object', () => {
    expect(httpParams({ types: ['Protein', 'Complex'] }).toString()).toBe(
      'types=Protein&types=Complex'
    );
  });

  it('has nothing to send for no values', () => {
    expect(httpParams().keys()).toEqual([]);
    expect(httpParams(undefined).keys()).toEqual([]);
  });

  it('does not change the object it was given', () => {
    const values = { resource: undefined, species: '9606' };
    httpParams(values);
    expect(Object.keys(values)).toEqual(['resource', 'species']);
  });
});
