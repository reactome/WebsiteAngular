import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  OnDestroy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  ContentDataService,
  SchemaAttribute,
} from '../../../../services/content-data.service';

interface AttributeRow {
  name: string;
  values: AttributeValue[];
}

interface AttributeValue {
  type: 'text' | 'link';
  text: string;
  dbId?: number;
  schemaClass?: string;
}

@Component({
  selector: 'app-instance-browser',
  imports: [RouterLink],
  templateUrl: './instance-browser.component.html',
  styleUrl: './instance-browser.component.scss',
})
export class InstanceBrowserComponent implements OnChanges, OnDestroy {
  private destroy$ = new Subject<void>();

  @Input() instanceId!: number | string;
  @Output() instanceLinkClick = new EventEmitter<number>();

  instance: any = null;
  schemaClass = '';
  dbId: number | string = '';
  rows: AttributeRow[] = [];
  loading = true;
  error = false;

  constructor(private contentDataService: ContentDataService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['instanceId'] && this.instanceId != null) {
      this.loadInstance();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadInstance() {
    this.loading = true;
    this.error = false;
    this.rows = [];

    this.contentDataService.getInstance(this.instanceId).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (instance) => {
        this.instance = instance;
        this.schemaClass = instance.schemaClass || instance.className || '';
        this.dbId = instance.dbId;
        this.loadAttributes();
      },
      error: () => {
        this.error = true;
        this.loading = false;
      },
    });
  }

  private loadAttributes() {
    this.contentDataService.getSchemaAttributes(this.schemaClass).subscribe({
      next: (attrs) => {
        this.rows = this.buildRows(attrs);
        this.loading = false;
      },
      error: () => {
        // Fall back to rendering instance keys directly
        this.rows = this.buildRowsFromInstance();
        this.loading = false;
      },
    });
  }

  private buildRows(attrs: SchemaAttribute[]): AttributeRow[] {
    const rows: AttributeRow[] = [];
    for (const attr of attrs) {
      const raw = this.instance[attr.name];
      if (raw === undefined || raw === null) continue;

      const hasDatabaseObjectType = attr.valueTypes.some(
        (vt) => vt.databaseObject
      );
      const values = this.resolveValues(raw, hasDatabaseObjectType);
      if (values.length > 0) {
        rows.push({ name: attr.name, values });
      }
    }
    return rows;
  }

  private buildRowsFromInstance(): AttributeRow[] {
    const rows: AttributeRow[] = [];
    for (const key of Object.keys(this.instance)) {
      const raw = this.instance[key];
      if (raw === undefined || raw === null) continue;
      const values = this.resolveValues(raw, false);
      if (values.length > 0) {
        rows.push({ name: key, values });
      }
    }
    return rows;
  }

  private resolveValues(
    raw: any,
    hasDatabaseObjectType: boolean
  ): AttributeValue[] {
    if (Array.isArray(raw)) {
      const result: AttributeValue[] = [];
      for (const item of raw) {
        result.push(...this.resolveSingleValue(item, hasDatabaseObjectType));
      }
      return result;
    }
    return this.resolveSingleValue(raw, hasDatabaseObjectType);
  }

  private resolveSingleValue(
    val: any,
    hasDatabaseObjectType: boolean
  ): AttributeValue[] {
    // Database object with dbId
    if (val !== null && typeof val === 'object' && val.dbId) {
      return [
        {
          type: 'link',
          text: `[${val.schemaClass || val.className || 'Object'}:${val.dbId}] ${val.displayName || ''}`,
          dbId: val.dbId,
          schemaClass: val.schemaClass || val.className,
        },
      ];
    }

    // Numeric ID reference (e.g. authored: [109913]) when schema says it's a database object
    if (typeof val === 'number' && hasDatabaseObjectType) {
      return [
        {
          type: 'link',
          text: `${val}`,
          dbId: val,
        },
      ];
    }

    // Primitive
    return [
      {
        type: 'text',
        text: String(val),
      },
    ];
  }

  onLinkClick(dbId: number, event: Event) {
    event.preventDefault();
    this.instanceLinkClick.emit(dbId);
  }
}
