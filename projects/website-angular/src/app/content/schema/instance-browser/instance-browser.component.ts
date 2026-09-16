import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  ContentDataService,
  InstanceReferrals,
  SchemaAttribute,
} from '../../../../services/content-data.service';

interface AttributeRow {
  name: string;
  values: AttributeValue[];
}

interface AttributeValue {
  type: 'text' | 'link' | 'figure';
  text: string;
  dbId?: number;
  schemaClass?: string;
}

/**
 * What a Figure's url (and its displayName, which repeats it) looks like:
 * "/figures/12_GlcNAc2Man9PPDol.png". Figures are static image files under the
 * site's document root, and the database stores that root-relative path
 * verbatim.
 *
 * The path is used as the link target unchanged, rather than joined to
 * environment.host, so the image is fetched from whichever origin is serving
 * the page: the dev server proxies /figures, so it resolves to localhost, and
 * the deployed site serves the files itself.
 */
const FIGURE_PATH = /^\/figures\/[^/]/;

@Component({
  selector: 'app-instance-browser',
  imports: [RouterLink],
  templateUrl: './instance-browser.component.html',
  styleUrl: './instance-browser.component.scss',
})
export class InstanceBrowserComponent implements OnChanges, OnDestroy {
  private contentDataService = inject(ContentDataService);

  // Async callbacks assign to plain fields, so Angular has to be told
  // explicitly that the view needs re-rendering.
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  @Input() instanceId!: number | string;
  @Output() instanceLinkClick = new EventEmitter<number>();

  instance: any = null;
  schemaClass = '';
  dbId: number | string = '';
  rows: AttributeRow[] = [];
  referrals: InstanceReferrals[] = [];
  loading = true;
  error = false;

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
    this.referrals = [];

    this.contentDataService
      .getInstance(this.instanceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (instance) => {
          this.instance = instance;
          this.schemaClass = instance.schemaClass || instance.className || '';
          this.dbId = instance.dbId;
          this.loadAttributes();
          this.loadReferrals();
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = true;
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  private loadReferrals() {
    this.contentDataService
      .getInstanceReferrers(this.instanceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (groups) => {
          this.referrals = groups || [];
          this.cdr.markForCheck();
        },
        error: () => {
          // Endpoint absent or 500 -- silently degrade; the page is still
          // useful without the referrals list.
          this.referrals = [];
          this.cdr.markForCheck();
        },
      });
  }

  private loadAttributes() {
    this.contentDataService.getSchemaAttributes(this.schemaClass).subscribe({
      next: (attrs) => {
        this.rows = this.buildRows(attrs);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        // Fall back to rendering instance keys directly
        this.rows = this.buildRowsFromInstance();
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private buildRows(attrs: SchemaAttribute[]): AttributeRow[] {
    const rows: AttributeRow[] = [];
    for (const attr of attrs) {
      const raw = this.instance[attr.name];
      if (raw === undefined || raw === null) continue;

      const hasDatabaseObjectType = attr.valueTypes.some((vt) => vt.databaseObject);
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

  private resolveValues(raw: any, hasDatabaseObjectType: boolean): AttributeValue[] {
    if (Array.isArray(raw)) {
      const result: AttributeValue[] = [];
      for (const item of raw) {
        result.push(...this.resolveSingleValue(item, hasDatabaseObjectType));
      }
      return result;
    }
    return this.resolveSingleValue(raw, hasDatabaseObjectType);
  }

  private resolveSingleValue(val: any, hasDatabaseObjectType: boolean): AttributeValue[] {
    // Database object with dbId
    if (val !== null && typeof val === 'object' && val.dbId) {
      return [
        {
          type: 'link',
          text: `[${val.schemaClass || val.className || 'Object'}:${
            val.dbId
          }] ${val.displayName || ''}`,
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

    // A figure's image file, which the browser can render on its own. The path
    // is both what is shown and where the link goes.
    if (typeof val === 'string' && FIGURE_PATH.test(val)) {
      return [
        {
          type: 'figure',
          text: val,
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
