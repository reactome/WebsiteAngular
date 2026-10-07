import { describe, expect, it } from 'vitest';
import { HierarchyHoverService } from './hierarchy-hover.service';

describe('the hierarchy hover', () => {
  it('follows the row being pointed at', () => {
    const hover = new HierarchyHoverService();
    hover.enter('R-HSA-69620');
    expect(hover.hovered()).toBe('R-HSA-69620');
    hover.leave('R-HSA-69620');
    expect(hover.hovered()).toBeNull();
  });

  it('is not cleared by a late leave from the row before', () => {
    // Moving from one row to the next can deliver the new enter first.
    const hover = new HierarchyHoverService();
    hover.enter('R-HSA-69620');
    hover.enter('R-HSA-69278');
    hover.leave('R-HSA-69620');
    expect(hover.hovered()).toBe('R-HSA-69278');
  });
});
