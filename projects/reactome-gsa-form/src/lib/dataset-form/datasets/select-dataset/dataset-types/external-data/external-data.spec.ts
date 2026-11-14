import { describe, expect, it } from 'vitest';
import { loadParameters } from './external-data.component';
import type { Parameter } from '../../../../../model/parameter.model';

const parameter = (name: string, value?: Parameter['value']): Parameter => ({
  id: name,
  name,
  default: '',
  description: '',
  display_name: name,
  scope: 'dataset',
  type: 'string' as Parameter['type'],
  ...(value === undefined ? {} : { value }),
});

describe('the parameters an import sends', () => {
  it('sends each value as its text', () => {
    expect(loadParameters([parameter('dataset_id', 'E-MTAB-1'), parameter('k', 3)])).toEqual([
      { name: 'dataset_id', value: 'E-MTAB-1' },
      { name: 'k', value: '3' },
    ]);
  });

  // An empty field threw here, and the Import button did nothing; it still
  // sends nothing, without the error.
  it('sends nothing while a field is empty', () => {
    expect(loadParameters([parameter('dataset_id'), parameter('k', 3)])).toBeUndefined();
  });
});
