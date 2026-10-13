import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { MatIconRegistry } from '@angular/material/icon';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DetailComponent } from './detail.component';
import { DetailDataService } from '../../../services/detail-data.service';
import { DataStateService } from '../../../../../pathway-browser/src/app/services/data-state.service';
import { IconService } from '../../../../../pathway-browser/src/app/services/icon.service';

// A reader who arrives on a dbId -- an old link, a bookmark from the GWT site --
// is moved to the stable id, which is the address worth keeping: a dbId is not
// stable across releases.
describe('DetailComponent addresses', () => {
  let params: BehaviorSubject<ParamMap>;
  let fetch: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  /** `respond`, when given, answers each fetch instead of `answer`. */
  function open(
    id: string,
    answer: object | undefined,
    respond: (asked: string) => Observable<object | undefined> = () => of(answer)
  ) {
    params = new BehaviorSubject(convertToParamMap({ id }));
    fetch = vi.fn(respond);
    navigate = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: Router, useValue: { navigate } },
        { provide: DetailDataService, useValue: { fetchEnhancedData: fetch } },
        { provide: DataStateService, useValue: { selectedElement: signal(undefined) } },
        {
          provide: IconService,
          useValue: {
            getSpeciesIcons: () => [],
            getGeneralIcons: () => [],
            getReactomeSubjectIcons: () => ({}),
          },
        },
        {
          provide: MatIconRegistry,
          useValue: { registerFontClassAlias: () => {}, addSvgIcon: () => {} },
        },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new DetailComponent());
    component.ngOnInit();
    return component;
  }

  it('moves a dbId address to the stable id, replacing it in history', () => {
    open('70486', { dbId: 70486, stId: 'R-HSA-70486' });
    expect(navigate).toHaveBeenCalledWith(['/content/detail', 'R-HSA-70486'], {
      replaceUrl: true,
      queryParamsHandling: 'preserve',
      preserveFragment: true,
    });
  });

  it('moves a versioned stable id to the plain one', () => {
    open('R-HSA-70486.4', { dbId: 70486, stId: 'R-HSA-70486' });
    expect(navigate).toHaveBeenCalledWith(['/content/detail', 'R-HSA-70486'], expect.anything());
  });

  it('does not fetch the same object again when the address changes to it', () => {
    const component = open('70486', { dbId: 70486, stId: 'R-HSA-70486' });
    params.next(convertToParamMap({ id: 'R-HSA-70486' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(component.obj()).toEqual({ dbId: 70486, stId: 'R-HSA-70486' });
    expect(component.loading()).toBe(false);
  });

  it('leaves a stable id address alone', () => {
    open('R-HSA-70486', { dbId: 70486, stId: 'R-HSA-70486' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves the address alone for an object that has no stable id', () => {
    open('48887', { dbId: 48887 });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores an answer for an address the reader has already left', () => {
    // A slow object, and the reader moves on before it arrives: its late
    // answer must neither show nor move the address back to it.
    const pending = new Map<string, Subject<object>>();
    const component = open('70486', undefined, (asked) => {
      const answer = new Subject<object>();
      pending.set(asked, answer);
      return answer;
    });
    params.next(convertToParamMap({ id: 'R-HSA-69620' }));
    pending.get('70486')?.next({ dbId: 70486, stId: 'R-HSA-70486' });
    expect(navigate).not.toHaveBeenCalled();
    expect(component.obj()).toBeUndefined();
    pending.get('R-HSA-69620')?.next({ dbId: 69620, stId: 'R-HSA-69620' });
    expect(component.obj()).toEqual({ dbId: 69620, stId: 'R-HSA-69620' });
  });
});
