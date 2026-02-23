import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';

interface PathwayEntry {
  number: number;
  pathway: string;
  curator: string;
  topic: string;
  contact: string;
  docUrl: string;
  pdfUrl: string;
  pathwayUrl: string;
  docName: string;
}

const HTML_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRorn50RGvdhBflvIAMwr7zgsj3GQrsgBBOuzM6MaKN5ntPcTYRQiCNk5OcYt0aumeLjcUTbhDb_omc/pubhtml/sheet?headers=false&gid=1133159892';

@Component({
  selector: 'app-collaboration',
  imports: [PageLayoutComponent],
  templateUrl: './collaboration.component.html',
  styleUrl: './collaboration.component.scss'
})
export class CollaborationComponent implements OnInit {
  entries: PathwayEntry[] = [];
  loading = true;
  error = false;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.http.get(HTML_URL, { responseType: 'text' }).subscribe({
      next: (html) => {
        this.entries = this.parseHtml(html);
        this.loading = false;
      },
      error: () => {
        this.error = true;
        this.loading = false;
      }
    });
  }

  get topics(): string[] {
    const set = new Set(this.entries.map(e => e.topic));
    return Array.from(set).sort();
  }

  entriesForTopic(topic: string): PathwayEntry[] {
    return this.entries.filter(e => e.topic === topic);
  }

  private parseHtml(html: string): PathwayEntry[] {
    const entries: PathwayEntry[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const linkRegex = /href="https:\/\/www\.google\.com\/url\?q=([^&]+)&/g;
    const tagRegex = /<[^>]+>/g;

    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const cells: { text: string; links: string[] }[] = [];

      let cellMatch;
      const cellRe = new RegExp(cellRegex.source, 'g');
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        const cellHtml = cellMatch[1];
        const text = cellHtml.replace(tagRegex, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        const links: string[] = [];
        let linkMatch;
        const linkRe = new RegExp(linkRegex.source, 'g');
        while ((linkMatch = linkRe.exec(cellHtml)) !== null) {
          links.push(decodeURIComponent(linkMatch[1].replace(/&amp;/g, '&')));
        }
        cells.push({ text, links });
      }

      if (cells.length < 6) continue;

      // Skip header row and empty rows
      const num = parseInt(cells[0].text, 10);
      if (isNaN(num)) continue;

      const pathway = cells[3].text;
      if (!pathway) continue;

      // Cell 1: Word doc link, Cell 2: PDF link, Cell 3: Pathway name + link
      const docUrl = cells[1].links[0] || '';
      const pdfUrl = cells[2].links[0] || '';
      const pathwayUrl = cells[3].links[0] || '';

      // Extract document name from whichever cell has a filename
      const rawDocName = cells[1].text || cells[2].text || '';
      const docName = this.cleanFilename(rawDocName);

      entries.push({
        number: num,
        pathway,
        curator: cells[4].text,
        topic: cells[5].text,
        contact: cells[6]?.text || 'help@reactome.org',
        docUrl,
        pdfUrl,
        pathwayUrl,
        docName
      });
    }

    return entries.sort((a, b) => a.pathway.localeCompare(b.pathway));
  }

  private cleanFilename(raw: string): string {
    return raw
      .replace(/\.(docx?|pdf|xlsx?)$/i, '')   // remove extension
      .replace(/^Reactome_/i, '')              // remove Reactome prefix
      .replace(/_/g, ' ')                      // underscores to spaces
      .replace(/([a-z])([A-Z])/g, '$1 $2')    // split CamelCase
      .trim();
  }
}
