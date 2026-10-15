import { describe, expect, it } from 'vitest';

import { EntityService } from '../../../../../../pathway-browser/src/app/services/entity.service';
import { DetailEntityService } from './detail-entity.provider';

const methods = (type: { prototype: object }): string[] =>
  Object.getOwnPropertyNames(type.prototype).filter(
    (name) =>
      name !== 'constructor' &&
      typeof Object.getOwnPropertyDescriptor(type.prototype, name)?.value === 'function'
  );

// The detail page stands this in for the Pathway Browser's EntityService, and
// the Browser's panels call whatever EntityService has. A method missing here
// is a TypeError on the detail page and nowhere else: "Other Pathways" read
// "Couldn't load the other pathways this takes part in" on every entity's
// page, because getParticipatingPathways was never added here when the panel
// began calling it. `implements Partial<EntityService>` let that through.
describe('DetailEntityService, standing in for EntityService', () => {
  it('has every method EntityService has', () => {
    const own = new Set(methods(DetailEntityService));
    expect(methods(EntityService).filter((name) => !own.has(name))).toEqual([]);
  });
});
