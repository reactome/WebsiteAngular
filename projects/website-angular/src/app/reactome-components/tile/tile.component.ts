import { Component, Input } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-tile',
  imports: [],
  templateUrl: './tile.component.html',
  styleUrl: './tile.component.scss'
})
export class TileComponent {
  @Input() variant: 'dark' | 'light' | 'dark-transparent' | 'light-transparent' = 'light';
  @Input() style: string = '';

  get tileVariant(): string {
    return this.variant === 'dark' ? 'dark-tile' :
           this.variant === 'light' ? 'light-tile' :
           this.variant === 'dark-transparent' ? 'dark-transparent-tile' : 'light-transparent-tile';
  }
}
