import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { IconService, IconCategory, IconEntry } from '../../../services/icon.service';

const ICONS_PER_PAGE = 28;

const URL_MAPPING: Record<string, string> = {
  'UNIPROT':           'https://www.uniprot.org/entry/###ID###',
  'UNIPROT-T':         'https://www.uniprot.org/taxonomy/###ID###',
  'UNIPROTKB':         'https://www.uniprot.org/entry/###ID###',
  'CHEBI':             'https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:###ID###',
  'ENSEMBL':           'https://www.ensembl.org/Homo_sapiens/geneview?gene=###ID###',
  'GO':                'https://www.ebi.ac.uk/QuickGO/term/GO:###ID###',
  'ECO':               'https://www.ebi.ac.uk/QuickGO/term/ECO:###ID###',
  'RFAM':              'http://rfam.org/family/###ID###',
  'PFAM':              'http://pfam.xfam.org/family/###ID###',
  'MESH':              'https://www.ncbi.nlm.nih.gov/mesh/###ID###',
  'PUBCHEM':           'https://pubchem.ncbi.nlm.nih.gov/compound/###ID###',
  'PUBCHEM-SUBSTANCE': 'https://pubchem.ncbi.nlm.nih.gov/substance/###ID###',
  'INTERPRO':          'https://www.ebi.ac.uk/interpro/entry/###ID###',
  'KEGG':              'https://www.kegg.jp/entry/###ID###',
  'ENA':               'https://www.ebi.ac.uk/ena/data/view/###ID###',
  'COMPLEXPORTAL':     'https://www.ebi.ac.uk/complexportal/complex/###ID###',
  'EFO':               'https://www.ebi.ac.uk/ols/ontologies/efo/terms?obo_id=EFO:###ID###',
  'SO':                'https://www.ebi.ac.uk/ols/ontologies/so/terms?obo_id=SO:###ID###',
  'BTO':               'https://www.ebi.ac.uk/ols/ontologies/bto/terms?obo_id=BTO:###ID###',
  'CL':                'https://www.ebi.ac.uk/ols/ontologies/cl/terms?obo_id=CL:###ID###',
  'DOID':              'https://www.ebi.ac.uk/ols/ontologies/doid/terms?obo_id=DOID:###ID###',
  'NCIT':              'https://www.ebi.ac.uk/ols/ontologies/ncit/terms?obo_id=NCIT:###ID###',
  'OMIT':              'https://www.ebi.ac.uk/ols/ontologies/omit/terms?obo_id=OMIT:###ID###',
  'OPL':               'https://www.ebi.ac.uk/ols/ontologies/opl/terms?obo_id=OPL:###ID###',
  'UBERON':            'https://www.ebi.ac.uk/ols/ontologies/uberon/terms?obo_id=UBERON:###ID###',
  'FMA':               'https://www.ebi.ac.uk/ols/ontologies/fma/terms?obo_id=FMA:###ID###',
  'NCBI':              'https://www.ncbi.nlm.nih.gov/protein/###ID###',
  'IUPHAR':            'https://www.guidetopharmacology.org/GRAC/LigandDisplayForward?ligandId=###ID###',
};

type View = 'grid' | 'detail';

interface ParsedReference {
  db: string;
  id: string;
  url: string | null;
}

@Component({
  selector: 'app-icon-lib',
  imports: [PageLayoutComponent],
  templateUrl: './icon-lib.component.html',
  styleUrl: './icon-lib.component.scss'
})
export class IconLibComponent implements OnInit {
  view: View = 'grid';
  loading = true;
  error = false;

  // Categories for filtering
  categories: IconCategory[] = [];
  totalIcons = 0;

  // Grid view
  selectedCategory = '';
  icons: IconEntry[] = [];
  currentPage = 1;
  totalEntries = 0;
  searchQuery = '';

  // Detail view
  selectedIcon: IconEntry | null = null;
  detailLoading = false;
  parsedReferences: Map<string, ParsedReference[]> = new Map();

  constructor(
    private iconService: IconService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadCategories();
    const iconId = this.route.snapshot.paramMap.get('id');
    if (iconId) {
      this.loadIconById(iconId);
    } else {
      this.loadIcons();
    }
  }

  get maxPage(): number {
    return Math.ceil(this.totalEntries / ICONS_PER_PAGE);
  }

  get formattedCategory(): string {
    return this.formatCategoryName(this.selectedCategory);
  }

  loadCategories() {
    this.iconService.getFacets().subscribe({
      next: (data) => {
        const merged = new Map<string, number>();
        for (const c of data.iconCategoriesFacet?.available || []) {
          const name = this.formatCategoryName(c.name);
          merged.set(name, (merged.get(name) || 0) + c.count);
        }
        this.categories = Array.from(merged, ([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
        this.totalIcons = data.totalNumFount;
      },
      error: () => {}
    });
  }

  selectCategory(name: string) {
    this.selectedCategory = this.selectedCategory === name ? '' : name;
    this.currentPage = 1;
    this.searchQuery = '';
    this.loadIcons();
  }

  loadIcons() {
    this.loading = true;
    this.error = false;
    this.view = 'grid';
    const rawCategory = this.selectedCategory ? this.selectedCategory.toLowerCase().replace(/\s+/g, '_') : undefined;
    this.iconService.queryIcons({
      category: rawCategory,
      query: this.searchQuery || undefined,
      page: this.currentPage,
      pageSize: ICONS_PER_PAGE
    }).subscribe({
      next: (data) => {
        this.icons = (data.entries || []).sort((a, b) =>
          (a.iconName || a.name || '').localeCompare(b.iconName || b.name || '')
        );
        this.totalEntries = data.entriesCount;
        this.loading = false;
      },
      error: () => {
        this.icons = [];
        this.totalEntries = 0;
        this.error = true;
        this.loading = false;
      }
    });
  }

  searchIcons() {
    this.currentPage = 1;
    this.selectedCategory = '';
    this.loadIcons();
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadIcons();
    }
  }

  nextPage() {
    if (this.currentPage < this.maxPage) {
      this.currentPage++;
      this.loadIcons();
    }
  }

  openDetail(icon: IconEntry) {
    this.detailLoading = true;
    this.view = 'detail';
    this.router.navigate(['/community/icon-lib', icon.stId], { replaceUrl: false });
    this.iconService.getIcon(icon.stId).subscribe({
      next: (entry) => {
        this.selectedIcon = entry;
        this.parsedReferences = this.prepareReferences(entry);
        this.detailLoading = false;
      },
      error: () => {
        this.selectedIcon = icon;
        this.parsedReferences = this.prepareReferences(icon);
        this.detailLoading = false;
      }
    });
  }

  backToGrid() {
    this.view = 'grid';
    this.selectedIcon = null;
    this.router.navigate(['/community/icon-lib'], { replaceUrl: false });
  }

  private loadIconById(id: string) {
    this.detailLoading = true;
    this.view = 'detail';
    this.loading = false;
    this.iconService.getIcon(id).subscribe({
      next: (entry) => {
        this.selectedIcon = entry;
        this.parsedReferences = this.prepareReferences(entry);
        this.detailLoading = false;
      },
      error: () => {
        this.view = 'grid';
        this.detailLoading = false;
        this.loadIcons();
      }
    });
  }

  clearFilters() {
    this.selectedCategory = '';
    this.searchQuery = '';
    this.currentPage = 1;
    this.loadIcons();
  }

  iconSvgUrl(icon: IconEntry): string {
    return `https://dev.reactome.org/icon/${icon.stId}.svg`;
  }

  formatCategoryName(name: string): string {
    if (!name) return '';
    const spaced = name.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  }

  getReferenceUrl(db: string, id: string): string | null {
    const template = URL_MAPPING[db.toUpperCase()];
    if (!template) return null;
    return template.replace('###ID###', id);
  }

  get referenceGroups(): { db: string; refs: ParsedReference[] }[] {
    const groups: { db: string; refs: ParsedReference[] }[] = [];
    this.parsedReferences.forEach((refs, db) => {
      groups.push({ db, refs });
    });
    return groups.sort((a, b) => a.db.localeCompare(b.db));
  }

  formatIconCategories(icon: IconEntry): string[] {
    return (icon.iconCategories || []).map(c => this.formatCategoryName(c));
  }

  onImgError(event: Event) {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    const fallback = document.createElement('span');
    fallback.className = 'material-symbols-rounded img-fallback';
    fallback.textContent = 'image';
    img.parentElement?.appendChild(fallback);
  }

  onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.searchIcons();
    }
  }

  private prepareReferences(icon: IconEntry): Map<string, ParsedReference[]> {
    const map = new Map<string, ParsedReference[]>();
    if (!icon.iconReferences) return map;
    for (const xref of icon.iconReferences) {
      if (xref.includes(':')) {
        const db = xref.split(':')[0];
        const id = xref.split(':')[1];
        const url = this.getReferenceUrl(db, id);
        if (!map.has(db)) map.set(db, []);
        map.get(db)!.push({ db, id, url });
      }
    }
    return map;
  }
}
