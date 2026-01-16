import { Component, Input } from '@angular/core';
import { ButtonComponent } from "../../reactome-components/button/button.component";

@Component({
  selector: 'app-home-spotlight',
  standalone: true,
  imports: [ButtonComponent],
  templateUrl: './home-spotlight.component.html',
  styleUrl: './home-spotlight.component.scss'
})
export class HomeSpotlightComponent {
  @Input() spotLightText: string = '';
}
