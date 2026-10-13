import { Injectable, signal } from '@angular/core';
import type { Params } from '@angular/router';
import { UrlStateService } from '../../pathway-browser/src/app/services/url-state.service';

/**
 * The Pathway Browser's state, held in memory for one embedded diagram.
 *
 * The browser keeps its state in the address bar, through the Router. On a
 * partner's page that would read and rewrite *their* address -- every select and
 * flag pushing history onto a page that is not ours. This offers the same public
 * state, from the same definitions (it extends UrlStateService), and touches
 * nothing outside itself.
 */
@Injectable()
export class MemoryState extends UrlStateService {
  override readonly section = signal<string | null | undefined>(undefined);

  /** Nothing to keep off a history stack: there is none. */
  override settle(change: () => void): void {
    change();
  }

  /** A double-click into a sub-pathway: the diagram changes, the page does not. */
  override navigateTo(pathwayId: string | null): Promise<boolean> {
    this.pathwayId.set(pathwayId ?? undefined);
    this.select.set(null);
    return Promise.resolve(true);
  }

  /** There is no history here, so every diagram is the first. */
  override isFirstNavigation(): boolean {
    return true;
  }

  /** There is no address to read. */
  override queryParams(): Params {
    return {};
  }
}
