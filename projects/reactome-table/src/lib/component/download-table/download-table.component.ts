import { Component, OnInit, input } from '@angular/core';
import { first, map, Observable } from 'rxjs';
import { TableStore } from '../../state/table.store';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'reactome-table-download',
  templateUrl: './download-table.component.html',
  styleUrls: ['./download-table.component.scss'],
  imports: [MatIconButton, MatTooltip, MatIcon, MatButton, AsyncPipe],
})
export class DownloadTableComponent implements OnInit {
  readonly name = input.required<string>();
  readonly tableStore = input.required<TableStore>();

  type$!: Observable<false | 'icon' | 'text'>;

  constructor() {}

  ngOnInit(): void {
    this.type$ = this.tableStore().settings$.pipe(map((s) => s.downloadButton));
  }

  saveAFile(): void {
    this.tableStore()
      .cleanData$.pipe(first())
      .subscribe((table) => downloadTable(table, this.name()));
  }
}

export const downloadTable = (table: string[][], name: string) => {
  // Convert to TSV string
  const tsvString = table
    .map((row) => row.map((cell) => cell.replace(/\t/g, ' ')).join('\t'))
    .join('\n');

  // Create Blob
  const blob = new Blob([tsvString], { type: 'text/tab-separated-values;charset=utf-8;' });

  // Create download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${name}.tsv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Cleanup
  URL.revokeObjectURL(url);
};
