import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { InstanceBrowserComponent } from './instance-browser/instance-browser.component';
import {
  ContentDataService,
  SchemaNode,
  SchemaAttribute,
  SimpleDatabaseObject,
} from '../../../services/content-data.service';

interface FlatTreeNode {
  className: string;
  count: number;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

@Component({
  selector: 'app-schema',
  imports: [PageLayoutComponent, RouterLink, InstanceBrowserComponent],
  templateUrl: './schema.component.html',
  styleUrl: './schema.component.scss',
})
export class SchemaComponent implements OnInit, OnDestroy {
  private contentDataService = inject(ContentDataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Async callbacks assign to plain fields, so Angular has to be told
  // explicitly that the view needs re-rendering.
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  // Tree state
  treeRoot: SchemaNode | null = null;
  flatTree: FlatTreeNode[] = [];
  expandedNodes = new Set<string>();
  treeSearchQuery = '';
  treeSearchResults = new Set<string>();
  private classSet = new Set<string>();
  private classCountMap = new Map<string, number>();

  // Selected class state
  selectedClass = '';
  activeTab: 'properties' | 'entries' = 'properties';

  // Properties state
  attributes: SchemaAttribute[] = [];
  referrals: SchemaAttribute[] = [];
  loadingAttributes = false;
  attributesError = false;
  showInherited = true;

  // Entries state
  entries: SimpleDatabaseObject[] = [];
  entryCount = 0;
  entriesPage = 1;
  entriesPageSize = 50;
  loadingEntries = false;

  // Instance detail state
  selectedInstanceId: number | null = null;

  // Overall
  loading = true;
  error = false;
  sidebarOpen = false;

  ngOnInit() {
    this.contentDataService
      .getSchemaModel()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (root) => {
          this.treeRoot = root;
          // Expand first two levels by default
          this.expandedNodes.add(root.className);
          if (root.children) {
            for (const child of root.children) {
              this.expandedNodes.add(child.className);
            }
          }
          this.buildClassIndex(root);
          this.rebuildFlatTree();
          this.loading = false;

          // Listen for route changes. The path can be either
          //   /dataSchema/:className
          // or
          //   /dataSchema/:className/instance/:dbId
          // so a single subscription has to keep both selectedClass and
          // selectedInstanceId in sync with the URL.
          this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
            const className = params['className'] || 'DatabaseObject';
            if (className !== this.selectedClass) {
              this.selectClass(className);
            }
            const dbIdParam = params['dbId'];
            const dbId = dbIdParam != null ? Number(dbIdParam) : null;
            if (dbId !== this.selectedInstanceId) {
              this.selectedInstanceId = dbId;
              // If we deep-linked into an instance, make sure we're on the
              // Entries tab so the <app-instance-browser> renders.
              if (dbId != null) this.activeTab = 'entries';
            }
          });
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = true;
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // --- Tree ---

  private buildClassIndex(node: SchemaNode) {
    this.classSet.add(node.className);
    this.classCountMap.set(node.className, node.count);
    if (node.children) {
      for (const child of node.children) {
        this.buildClassIndex(child);
      }
    }
  }

  rebuildFlatTree() {
    if (!this.treeRoot) return;
    this.flatTree = [];
    this.buildFlatTreeRecursive(this.treeRoot, 0);
  }

  private buildFlatTreeRecursive(node: SchemaNode, depth: number) {
    const hasChildren = node.children && node.children.length > 0;
    const expanded = this.expandedNodes.has(node.className);

    // If searching, skip nodes that aren't in the search results path
    if (this.treeSearchQuery && !this.treeSearchResults.has(node.className)) {
      return;
    }

    this.flatTree.push({
      className: node.className,
      count: node.count,
      depth,
      hasChildren,
      expanded,
    });

    if (hasChildren && expanded) {
      const sorted = [...node.children].sort((a, b) => a.className.localeCompare(b.className));
      for (const child of sorted) {
        this.buildFlatTreeRecursive(child, depth + 1);
      }
    }
  }

  toggleTreeNode(className: string) {
    if (this.expandedNodes.has(className)) {
      this.expandedNodes.delete(className);
    } else {
      this.expandedNodes.add(className);
    }
    this.rebuildFlatTree();
  }

  onTreeNodeClick(className: string) {
    void this.router.navigate(['/dataSchema', className]);
    this.sidebarOpen = false;
  }

  onTreeNodeCountClick(className: string, event: Event) {
    // Stop the parent .node-label button from also firing onTreeNodeClick.
    event.stopPropagation();
    void this.router.navigate(['/dataSchema', className], {
      queryParams: { tab: 'entries' },
    });
    this.sidebarOpen = false;
  }

  onTreeSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.treeSearchQuery = value.toLowerCase().trim();
    if (this.treeSearchQuery) {
      this.treeSearchResults.clear();
      this.collectMatchingNodes(this.treeRoot!, this.treeSearchQuery);
    }
    this.rebuildFlatTree();
  }

  clearTreeSearch() {
    this.treeSearchQuery = '';
    this.treeSearchResults.clear();
    this.rebuildFlatTree();
  }

  private collectMatchingNodes(node: SchemaNode, query: string): boolean {
    let matches = node.className.toLowerCase().includes(query);

    if (node.children) {
      for (const child of node.children) {
        if (this.collectMatchingNodes(child, query)) {
          matches = true;
        }
      }
    }

    if (matches) {
      this.treeSearchResults.add(node.className);
      this.expandedNodes.add(node.className);
    }

    return matches;
  }

  // --- Class selection ---

  selectClass(className: string) {
    this.selectedClass = className;
    this.entries = [];
    this.entriesPage = 1;
    this.selectedInstanceId = null;
    this.loadAttributes(className);

    // Respect ?tab=entries in the URL (set by the count-bracket click in
    // the tree sidebar, or pasted directly) so the page lands straight
    // on the Entries tab. Otherwise default to Properties.
    if (this.route.snapshot.queryParamMap.get('tab') === 'entries') {
      this.switchToEntries();
    } else {
      this.activeTab = 'properties';
    }

    // Expand tree path to this node
    this.expandPathTo(className);
  }

  private expandPathTo(className: string) {
    if (!this.treeRoot) return;
    this.findAndExpandPath(this.treeRoot, className);
    this.rebuildFlatTree();
  }

  private findAndExpandPath(node: SchemaNode, target: string): boolean {
    if (node.className === target) return true;
    if (node.children) {
      for (const child of node.children) {
        if (this.findAndExpandPath(child, target)) {
          this.expandedNodes.add(node.className);
          return true;
        }
      }
    }
    return false;
  }

  // --- Properties ---

  loadAttributes(className: string) {
    this.loadingAttributes = true;
    this.attributesError = false;
    this.attributes = [];
    this.referrals = [];

    this.contentDataService.getSchemaAttributes(className).subscribe({
      next: (attrs) => {
        this.attributes = attrs;
        this.loadingAttributes = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.attributesError = true;
        this.loadingAttributes = false;
        this.cdr.markForCheck();
      },
    });

    this.contentDataService.getSchemaReferrals(className).subscribe({
      next: (refs) => {
        this.referrals = refs;
        this.cdr.markForCheck();
      },
      error: () => {
        // Referrals may be empty, that's fine
      },
    });
  }

  get ownAttributes(): SchemaAttribute[] {
    return this.attributes.filter((a) => a.origin === this.selectedClass);
  }

  get inheritedAttributes(): SchemaAttribute[] {
    return this.attributes.filter((a) => a.origin !== this.selectedClass);
  }

  isClassInTree(className: string): boolean {
    return this.classSet.has(className);
  }

  navigateToClass(className: string) {
    void this.router.navigate(['/dataSchema', className]);
  }

  // --- Entries ---

  switchToEntries() {
    this.activeTab = 'entries';
    if (this.entries.length === 0 && this.selectedClass) {
      this.loadEntryCount();
      this.loadEntries();
    }
  }

  loadEntryCount() {
    this.contentDataService.getSchemaCount(this.selectedClass).subscribe({
      next: (count) => {
        this.entryCount = count;
        this.cdr.markForCheck();
      },
    });
  }

  loadEntries() {
    this.loadingEntries = true;
    this.contentDataService
      .getSchemaEntries(this.selectedClass, this.entriesPage, this.entriesPageSize)
      .subscribe({
        next: (entries) => {
          this.entries = entries;
          this.loadingEntries = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.entries = [];
          this.loadingEntries = false;
          this.cdr.markForCheck();
        },
      });
  }

  get totalPages(): number {
    return Math.ceil(this.entryCount / this.entriesPageSize);
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.entriesPage = page;
    this.loadEntries();
  }

  get visiblePages(): number[] {
    const total = this.totalPages;
    const current = this.entriesPage;
    const pages: number[] = [];

    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  getNodeCount(className: string): number {
    return this.classCountMap.get(className) || 0;
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  selectInstance(dbId: number) {
    void this.router.navigate(['/dataSchema', this.selectedClass, 'instance', dbId], {
      queryParams: { tab: 'entries' },
      queryParamsHandling: 'merge',
    });
  }

  clearSelectedInstance() {
    void this.router.navigate(['/dataSchema', this.selectedClass], {
      queryParams: { tab: 'entries' },
    });
  }

  onInstanceLinkClick(dbId: number) {
    // Followed-from links inside the instance browser may point to objects
    // of a different schema class; we'll fix the className segment after
    // the instance loads and reveals its real class.
    void this.router.navigate(['/dataSchema', this.selectedClass, 'instance', dbId], {
      queryParams: { tab: 'entries' },
      queryParamsHandling: 'merge',
    });
  }
}
