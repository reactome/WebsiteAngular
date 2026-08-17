import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { forkJoin } from 'rxjs';

interface EditorialEntry {
  pathway: string;
  curator: string;
  author: string;
  reviewer: string;
}

const SPREADSHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTebSE76KQx1_I36_lwNnklYyDniGdWV0WqXOHjGDiJbeqwGv2W5F91EM0APfZjLXr_TVTHaAiLp8dt/pub';
const CURRENT_CSV = `${SPREADSHEET_BASE}?gid=5&single=true&output=csv`;
const PIPELINE_CSV = `${SPREADSHEET_BASE}?gid=6&single=true&output=csv`;

@Component({
  selector: 'app-editorial-calendar',
  imports: [PageLayoutComponent],
  templateUrl: './editorial-calendar.component.html',
  styleUrl: './editorial-calendar.component.scss'
})
export class EditorialCalendarComponent implements OnInit {
  private http = inject(HttpClient);

  currentEntries: EditorialEntry[] = [];
  pipelineEntries: EditorialEntry[] = [];
  loading = true;
  error = false;

  ngOnInit() {
    forkJoin({
      current: this.http.get(CURRENT_CSV, { responseType: 'text' }),
      pipeline: this.http.get(PIPELINE_CSV, { responseType: 'text' })
    }).subscribe({
      next: ({ current, pipeline }) => {
        this.currentEntries = this.parseCsv(current);
        this.pipelineEntries = this.parseCsv(pipeline);
        this.loading = false;
      },
      error: () => {
        this.error = true;
        this.loading = false;
      }
    });
  }

    //TODO: Centralize this parsing logic with the release calendar component
  private parseCsv(csv: string): EditorialEntry[] {
    const lines = csv.trim().split('\n');
    const entries: EditorialEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvLine(lines[i]);
      if (cols.length < 3) continue;

      const pathway = cols[0].trim();
      if (!pathway) continue;

      entries.push({
        pathway,
        curator: cols[1]?.trim() || '',
        author: cols[2]?.trim() || '',
        reviewer: cols[3]?.trim() || ''
      });
    }

    return entries.sort((a, b) => a.pathway.localeCompare(b.pathway));
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }
}
