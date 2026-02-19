import { Component } from '@angular/core';
import { TileComponent } from "../../reactome-components/tile/tile.component";
import { DropdownComponent } from "../../reactome-components/dropdown/dropdown.component";

@Component({
  selector: 'app-logo-page',
  imports: [TileComponent, DropdownComponent],
  templateUrl: './logo-page.component.html',
  styleUrl: './logo-page.component.scss'
})
export class LogoPageComponent {

}
