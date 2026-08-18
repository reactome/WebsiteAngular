import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';

interface ResourceEntry {
  name: string;
  description: string;
  category: string;
}

const HTML_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRbRm3dc7Ms8AmDm4zR67jSWhFSb-Jgkf0vfyBdnMF-wfNC0aZJfK3ltVOe5lVwhHDgdtkYRHbtM4q9/pubhtml?gid=0&&fvid=FILTER_VIEW_ID&single=true&widget=false&headers=false&chrome=false';

@Component({
  selector: 'app-resources',
  imports: [PageLayoutComponent],
  templateUrl: './resources.component.html',
  styleUrl: './resources.component.scss',
})
export class ResourcesComponent implements OnInit {
  private http = inject(HttpClient);
  // Plain fields assigned from an async callback: the app is zoneless, so
  // nothing notices them changing without being told.
  private cdr = inject(ChangeDetectorRef);

  entries: Record<string, ResourceEntry[]> = {};
  loading = true;
  error = false;

  ngOnInit() {
    this.http.get(HTML_URL, { responseType: 'text' }).subscribe({
      next: (html) => {
        this.entries = this.parseHtml(html);
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

  getKeys(obj: Record<string, any>): string[] {
    return Object.keys(obj);
  }

  getNumberOfEntries(category?: string): number {
    if (!category) {
      return Object.values(this.entries).reduce((sum, arr) => sum + arr.length, 0);
    }

    return this.entries[category]?.length || 0;
  }

  private parseHtml(html: string): Record<string, ResourceEntry[]> {
    const entries: Record<string, ResourceEntry[]> = {};
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const tagRegex = /<[^>]+>/g;

    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const cells: string[] = [];

      let cellMatch;
      const cellRe = new RegExp(cellRegex.source, 'g');
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        const cellHtml = cellMatch[1];
        cells.push(cellHtml.replace(tagRegex, '').trim());
      }

      if (cells.length < 3) continue;

      const category = cells[2];
      if (!entries[category]) {
        entries[category] = [];
      }

      entries[category].push({
        name: cells[0],
        description: cells[1],
        category: category,
      });
    }

    //Remove "category" entry if it exists (header row)
    delete entries['Category'];

    return entries;
  }
}
