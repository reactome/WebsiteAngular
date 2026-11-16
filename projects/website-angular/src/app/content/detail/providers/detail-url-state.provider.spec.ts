import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DetailUrlState } from './detail-url-state.provider';

// "Other Pathways" on a content page called navigateTo, which DetailUrlState
// did not have: every click on one threw. A content page is not inside a
// pathway, so going to one is opening it in the Pathway Browser.
describe('DetailUrlState.navigateTo', () => {
  it("opens the pathway in the Pathway Browser, with this page's object selected", async () => {
    const navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        DetailUrlState,
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: 'R-HSA-109796' }) },
            fragment: of(null),
            queryParamMap: of(convertToParamMap({})),
          },
        },
      ],
    });
    const state = TestBed.inject(DetailUrlState);
    await state.navigateTo('R-HSA-5673001');
    expect(navigate).toHaveBeenCalledWith(['/PathwayBrowser', 'R-HSA-5673001'], {
      queryParams: { select: 'R-HSA-109796' },
    });
  });
});
