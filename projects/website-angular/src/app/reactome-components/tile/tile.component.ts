import { Component, input } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-tile',
  imports: [],
  templateUrl: './tile.component.html',
  styleUrl: './tile.component.scss',
})
export class TileComponent {
  readonly variant = input<'dark' | 'light' | 'dark-transparent' | 'light-transparent'>('light');
  readonly style = input<string>('');

  get tileVariant(): string {
    const variant = this.variant();
    return variant === 'dark'
      ? 'dark-tile'
      : variant === 'light'
        ? 'light-tile'
        : variant === 'dark-transparent'
          ? 'dark-transparent-tile'
          : 'light-transparent-tile';
  }
}
