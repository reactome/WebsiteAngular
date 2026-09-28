import { Component, input } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-button',
  imports: [],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  readonly variant = input<'dark' | 'light'>('light');

  readonly onClick = input<() => void>(() => {});

  readonly shape = input<'circle' | 'square'>('square');

  readonly size = input<'small' | 'medium' | 'large'>('medium');

  readonly style = input<string>('');

  readonly border = input<boolean>(false);

  get buttonVariant(): string {
    return this.variant() === 'dark' ? 'dark-button' : 'light-button';
  }

  get buttonShape(): string {
    return this.shape() === 'circle' ? 'circle-button' : 'square-button';
  }

  get buttonSize(): string {
    const size = this.size();
    return size === 'small' ? 'small-button' : size === 'large' ? 'large-button' : 'medium-button';
  }
}
