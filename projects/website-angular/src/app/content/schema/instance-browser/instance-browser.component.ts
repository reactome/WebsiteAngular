import { InstanceReferrals } from '../../../../model/content.model';
import {
  Component,
  input,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ContentDataService } from '../../../../services/content-data.service';
import type { PlainGraphObject } from '../../../../../../pathway-browser/src/app/model/graph/plain.model';
import { AttributeRow, fieldRows, schemaRows } from './instance-rows';

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

  readonly instanceId = input.required<number | string>();
  readonly instanceLinkClick = output<number>();

  /** Plain: an object the answer has written already is its dbId. */
  instance: PlainGraphObject | null = null;
  schemaClass = '';
  dbId: number | string = '';
  rows: AttributeRow[] = [];
  referrals: InstanceReferrals[] = [];
  loading = true;
  error = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['instanceId']) {
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
      .getInstance(this.instanceId())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (instance) => {
          this.instance = instance;
          this.schemaClass = instance.schemaClass;
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
      .getInstanceReferrers(this.instanceId())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (groups) => {
          this.referrals = groups;
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
        this.rows = this.instance ? schemaRows(this.instance, attrs) : [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        // Fall back to rendering instance keys directly
        this.rows = this.instance ? fieldRows(this.instance) : [];
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  onLinkClick(dbId: number, event: Event) {
    event.preventDefault();
    this.instanceLinkClick.emit(dbId);
  }
}
