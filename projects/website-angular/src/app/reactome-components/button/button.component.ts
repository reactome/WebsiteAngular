import { Component, Input } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-button',
  imports: [],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  @Input() variant: 'dark' | 'light' = 'light';

  @Input() onClick: () => void = () => {};

  @Input() shape: 'circle' | 'square' = 'square';

  @Input() size: 'small' | 'medium' | 'large' = 'medium';

  @Input() style: string = '';

  @Input() border: boolean = false;

  get buttonVariant(): string {
    return this.variant === 'dark' ? 'dark-button' : 'light-button';
  }

  get buttonShape(): string {
    return this.shape === 'circle' ? 'circle-button' : 'square-button';
  }

  get buttonSize(): string {
    return this.size === 'small'
      ? 'small-button'
      : this.size === 'large'
        ? 'large-button'
        : 'medium-button';
  }
}
