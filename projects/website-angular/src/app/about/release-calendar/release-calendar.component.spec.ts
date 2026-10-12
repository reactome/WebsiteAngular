import { beforeEach, describe, expect, it } from 'vitest';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ReleaseCalendarComponent } from './release-calendar.component';

// The calendar is a spreadsheet's CSV export: rows are whatever someone typed.
describe('ReleaseCalendarComponent CSV', () => {
  let parse: (csv: string) => { year: number; releases: { version: number; label: string }[] }[];
  let component: ReleaseCalendarComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // A view's own, which a class built outside a view has to be given.
        { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined } },
      ],
    });
    // The parsing only: no template, which this runner does not compile.
    component = TestBed.runInInjectionContext(() => new ReleaseCalendarComponent());
    parse = (csv) => component['parseCsv'](csv, new Map());
  });

  it('groups releases by year, newest first', () => {
    const groups = parse('Version,Date\n96,3/2026\n97,6/2026\n95,12/2025\n');
    expect(groups.map((group) => group.year)).toEqual([2026, 2025]);
    expect(groups[0]?.releases.map((release) => release.label)).toEqual([
      'June 2026',
      'March 2026',
    ]);
    expect(component.latestVersion).toBe(95);
  });

  it('skips a row whose month does not exist, rather than calling it "undefined"', () => {
    const groups = parse('Version,Date\n97,13/2026\n98,0/2026\n99,9/2026\n');
    expect(groups.flatMap((group) => group.releases.map((release) => release.label))).toEqual([
      'September 2026',
    ]);
  });

  it('skips a short or malformed row', () => {
    const groups = parse('Version,Date\n97\n,\n98,2026\n99,9/2026\n');
    expect(groups.flatMap((group) => group.releases.map((release) => release.version))).toEqual([
      99,
    ]);
  });
});
