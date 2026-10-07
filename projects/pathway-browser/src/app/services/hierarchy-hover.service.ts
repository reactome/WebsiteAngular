import { Injectable, signal } from '@angular/core';

/**
 * The event the reader is pointing at in the hierarchy, for the views beside it.
 *
 * The tree only ever marked its own row, so hovering a sub-pathway told the
 * illustration nothing, where the old browser lit up its region (#297).
 */
@Injectable({ providedIn: 'root' })
export class HierarchyHoverService {
  private readonly _hovered = signal<string | null>(null);
  /** The stable id of the hovered event, or null. */
  readonly hovered = this._hovered.asReadonly();

  enter(stId: string | undefined): void {
    this._hovered.set(stId ?? null);
  }

  leave(stId: string | undefined): void {
    // Only the row being left may clear it: moving between two rows can fire
    // the new row's enter before the old one's leave.
    if (this._hovered() === (stId ?? null)) this._hovered.set(null);
  }
}
