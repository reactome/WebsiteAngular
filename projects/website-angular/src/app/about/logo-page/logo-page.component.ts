import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';

interface LogoGroup {
  id: 'imagotype' | 'isotype';
  name: string;
  /**
   * Widths in millimetres, as the files under uploads/about/logo are named, and
   * each file's pixel size as measured from it -- the number a reader choosing
   * between Small and Large actually needs.
   */
  sizes: { label: string; mm: number; px: string }[];
  variants: { file: string; alt: string; negative: boolean }[];
}

/**
 * The logo files are listed once, here, and every link is built from the list.
 *
 * The template used to spell out sixteen hrefs by hand beside files named by
 * hand, and two of the files had been saved as `.png.png`: Medium and Large
 * opened the site's not-found page, and nothing noticed. The links also had no
 * `download` attribute, so every option opened the image as a page instead of
 * saving it, and the PNG sizes sat in a hover-only menu no keyboard or touch
 * screen could open.
 *
 * content/about/logo.mdx is not rendered -- this route owns the page -- but site
 * search indexes it, so it carries the prose and no links.
 */
@Component({
  selector: 'app-logo-page',
  imports: [MatIcon, MatMenu, MatMenuItem, MatMenuTrigger, PageLayoutComponent],
  templateUrl: './logo-page.component.html',
  styleUrl: './logo-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoPageComponent {
  readonly dir = 'uploads/about/logo/';

  readonly groups: LogoGroup[] = [
    {
      id: 'imagotype',
      name: 'Imagotype',
      sizes: [
        { label: 'Small', mm: 25, px: '709 × 165' },
        { label: 'Medium', mm: 50, px: '1418 × 330' },
        { label: 'Large', mm: 100, px: '2835 × 659' },
      ],
      variants: [
        {
          file: 'Reactome_Imagotype_Positive',
          alt: 'Reactome imagotype, positive',
          negative: false,
        },
        {
          file: 'Reactome_Imagotype_Negative',
          alt: 'Reactome imagotype, negative',
          negative: true,
        },
      ],
    },
    {
      id: 'isotype',
      name: 'Isotype',
      sizes: [
        { label: 'Small', mm: 10, px: '164 × 164' },
        { label: 'Medium', mm: 25, px: '410 × 410' },
        { label: 'Large', mm: 50, px: '820 × 820' },
      ],
      variants: [
        { file: 'Reactome_Isotype_Positive', alt: 'Reactome isotype, positive', negative: false },
        { file: 'Reactome_Isotype_Negative', alt: 'Reactome isotype, negative', negative: true },
      ],
    },
  ];

  /** The router does not scroll to fragments, so the in-page links do it themselves. */
  jumpTo(event: Event, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
