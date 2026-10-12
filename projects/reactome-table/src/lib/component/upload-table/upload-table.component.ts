import { Component, OnInit, input } from '@angular/core';
import { TableStore } from '../../state/table.store';
import { map, Observable } from 'rxjs';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'reactome-table-upload',
  templateUrl: './upload-table.component.html',
  styleUrls: ['./upload-table.component.scss'],
  imports: [MatIconButton, MatTooltip, MatIcon, MatButton, AsyncPipe],
})
export class UploadTableComponent implements OnInit {
  readonly tableStore = input.required<TableStore>();

  type$!: Observable<false | 'icon' | 'text'>;

  constructor() {}

  ngOnInit(): void {
    this.type$ = this.tableStore().settings$.pipe(map((s) => s.uploadButton));
  }

  uploadFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (file) this.tableStore().importFile({ file });
  }
}
