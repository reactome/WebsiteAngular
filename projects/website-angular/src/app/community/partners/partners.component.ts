import { Component } from '@angular/core';
import { PageLayoutComponent } from "../../page-layout/page-layout.component";
import { REACTOME_PARTNERS } from "./partners";

@Component({
  selector: 'app-partners',
  imports: [PageLayoutComponent],
  templateUrl: './partners.component.html',
  styleUrl: './partners.component.scss'
})


export class PartnersComponent {
  partners = REACTOME_PARTNERS;
}
