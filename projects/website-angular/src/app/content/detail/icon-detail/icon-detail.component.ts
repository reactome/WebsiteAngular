import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { PageLayoutComponent } from '../../../page-layout/page-layout.component';
import { TileComponent } from '../../../reactome-components/tile/tile.component';
import { IconService, IconEntry } from '../../../../services/icon.service';

@Component({
  selector: 'app-icon-detail',
  standalone: true,
  imports: [PageLayoutComponent, TileComponent, MatProgressSpinner, RouterLink],
  templateUrl: './icon-detail.component.html',
  styleUrl: './icon-detail.component.scss',
})
export class IconDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private iconService = inject(IconService);

  icon = signal<IconEntry | null>(null);
  loading = signal(true);
  error = signal(false);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      this.error.set(true);
      return;
    }

    this.iconService.getIcon(id).subscribe({
      next: (data) => {
        this.icon.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  getSvgUrl(): string {
    const stId = this.icon()?.stId;
    return stId ? `https://reactome.org/icon/${stId}.svg` : '';
  }

  getPngUrl(): string {
    const stId = this.icon()?.stId;
    return stId ? `https://reactome.org/icon/${stId}.png` : '';
  }

  getUniProtReferences(): string[] {
    const refs = this.icon()?.iconReferences ?? [];
    return refs.filter((r) => !r.includes(':'));
  }
}
