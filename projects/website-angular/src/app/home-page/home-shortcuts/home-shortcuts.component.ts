import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, Input, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { ButtonComponent } from "../../reactome-components/button/button.component";
import { MatIcon } from "@angular/material/icon";
import { NavOption } from '../../../types/link';

@Component({
  selector: 'app-home-shortcuts',
  imports: [CarouselComponent, ButtonComponent, MatIcon, RouterLink],
  templateUrl: './home-shortcuts.component.html',
  styleUrl: './home-shortcuts.component.scss'
})
export class HomeShortcutsComponent implements OnInit {
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;
  @Input() dark:boolean = true;

  ngOnInit() {
  }
}
