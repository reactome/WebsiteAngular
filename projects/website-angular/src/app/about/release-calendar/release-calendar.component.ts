import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';

interface Release {
  version: number;
  month: number;
  year: number;
  label: string;
}

interface YearGroup {
  year: number;
  releases: Release[];
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQR7_-1pf24gjQh_sR-gvTg_mPXJ_zjHc-N3jUoqb9M7f9i1I5NugQkAd-ve7LYgVYSsgMFMqGRcCCE/pub?gid=0&single=true&output=csv';

@Component({
  selector: 'app-release-calendar',
  imports: [PageLayoutComponent],
  templateUrl: './release-calendar.component.html',
  styleUrl: './release-calendar.component.scss'
})
export class ReleaseCalendarComponent implements OnInit {
  yearGroups: YearGroup[] = [];
  loading = true;
  error = false;
  latestVersion = 0;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.http.get(CSV_URL, { responseType: 'text' }).subscribe({
      next: (csv) => {
        this.yearGroups = this.parseCsv(csv);
        this.loading = false;
      },
      error: () => {
        this.error = true;
        this.loading = false;
      }
    });
  }

  //TODO: Centralize this parsing logic with the editorial calendar component
  private parseCsv(csv: string): YearGroup[] {
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
        label: `${MONTHS[month]} ${year}`
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
