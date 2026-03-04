import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
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
  imports: [PageLayoutComponent, RouterLink],
  templateUrl: './schema.component.html',
  styleUrl: './schema.component.scss',
})
export class SchemaComponent implements OnInit, OnDestroy {
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

  // Overall
  loading = true;
  error = false;
  sidebarOpen = false;

  constructor(
    private contentDataService: ContentDataService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.contentDataService.getSchemaModel().subscribe({
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

        // Listen for route changes
        this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
          const className = params['className'] || 'DatabaseObject';
          if (className !== this.selectedClass) {
            this.selectClass(className);
          }
        });
      },
      error: () => {
        this.error = true;
        this.loading = false;
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
      const sorted = [...node.children].sort((a, b) =>
        a.className.localeCompare(b.className)
      );
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
    this.router.navigate(['/content/schema', className]);
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
    this.activeTab = 'properties';
    this.entries = [];
    this.entriesPage = 1;
    this.loadAttributes(className);

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
      },
      error: () => {
        this.attributesError = true;
        this.loadingAttributes = false;
      },
    });

    this.contentDataService.getSchemaReferrals(className).subscribe({
      next: (refs) => {
        this.referrals = refs;
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
    this.router.navigate(['/content/schema', className]);
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
        },
        error: () => {
          this.entries = [];
          this.loadingEntries = false;
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

  entryUrl(entry: SimpleDatabaseObject): string {
    if (entry.stId) {
      return `https://dev.reactome.org/content/detail/${entry.stId}`;
    }
    return `https://dev.reactome.org/content/detail/${entry.dbId}`;
  }
}
