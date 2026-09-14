import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { ContentService } from '../../../services/content.service';

interface Release {
  version: number;
  month: number;
  year: number;
  label: string;
  /**
   * The slug of this release's announcement, when there is one.
   *
   * A curator reported that the cards look and behave clickable and are not --
   * they lift on hover, which is what a clickable card does. They were right to
   * expect something: "what was in v92?" is the obvious question to ask of a
   * release calendar. Forty of the ninety-seven releases have an announcement on
   * this site, so those cards link to it and the rest are plainly not links.
   */
  announcement?: string;
}

interface YearGroup {
  year: number;
  releases: Release[];
}

const MONTHS = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Release announcements by version number.
 *
 * Titles are not uniform across twenty years -- "V96 Released" recently, "Version
 * 64 Released" further back -- so the version is read out of the title rather
 * than assumed from the slug.
 */
function announcementsByVersion(articles: { title?: string; slug?: string }[]) {
  const found = new Map<number, string>();
  for (const article of articles) {
    const match = /^(?:v|version)\s*(\d+)\s+released/i.exec((article.title ?? '').trim());
    if (match && article.slug) found.set(Number(match[1]), article.slug);
  }
  return found;
}

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQR7_-1pf24gjQh_sR-gvTg_mPXJ_zjHc-N3jUoqb9M7f9i1I5NugQkAd-ve7LYgVYSsgMFMqGRcCCE/pub?gid=0&single=true&output=csv';

@Component({
  selector: 'app-release-calendar',
  imports: [PageLayoutComponent, RouterLink, NgTemplateOutlet],
  templateUrl: './release-calendar.component.html',
  styleUrl: './release-calendar.component.scss',
})
export class ReleaseCalendarComponent implements OnInit {
  private http = inject(HttpClient);
  private content = inject(ContentService);

  // Async callbacks assign to plain fields, so Angular has to be told
  // explicitly that the view needs re-rendering.
  private cdr = inject(ChangeDetectorRef);
  yearGroups: YearGroup[] = [];
  loading = true;
  error = false;
  latestVersion = 0;

  ngOnInit() {
    // The announcements are a nicety: if that request fails the calendar still
    // renders, with no cards claiming to be links.
    forkJoin({
      csv: this.http.get(CSV_URL, { responseType: 'text' }),
      news: this.content.getAllArticles('about/news').pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ csv, news }) => {
        this.yearGroups = this.parseCsv(csv, announcementsByVersion(news));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = true;
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  //TODO: Centralize this parsing logic with the editorial calendar component
  private parseCsv(csv: string, announcements: Map<number, string>): YearGroup[] {
    const lines = csv.trim().split('\n');
    const releases: Release[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 2) continue;

      const version = parseInt(cols[0].trim(), 10);
      const dateParts = cols[1].trim().split('/');
      if (dateParts.length < 2) continue;

      const month = parseInt(dateParts[0], 10);
      const year = parseInt(dateParts[1], 10);

      if (isNaN(version) || isNaN(month) || isNaN(year)) continue;

      releases.push({
        version,
        month,
        year,
        label: `${MONTHS[month]} ${year}`,
        announcement: announcements.get(version),
      });
    }

    if (releases.length > 0) {
      this.latestVersion = releases[releases.length - 1].version;
    }

    const grouped = new Map<number, Release[]>();
    for (const r of releases) {
      if (!grouped.has(r.year)) grouped.set(r.year, []);
      grouped.get(r.year)!.push(r);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => b - a)
      .map(([year, rels]) => ({ year, releases: rels.sort((a, b) => b.month - a.month) }));
  }

  isLatest(release: Release): boolean {
    return release.version === this.latestVersion;
  }

  isPast(release: Release): boolean {
    const now = new Date();
    const releaseDate = new Date(release.year, release.month - 1);
    return releaseDate <= now;
  }
}
