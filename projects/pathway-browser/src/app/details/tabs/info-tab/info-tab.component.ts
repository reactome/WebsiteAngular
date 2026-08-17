import { Component, inject } from '@angular/core';
import { UrlStateService } from '../../../services/url-state.service';
import { EhldService } from '../../../services/ehld.service';
import { InteractorService } from '../../../interactors/services/interactor.service';

@Component({
  selector: 'cr-info-tab',
  imports: [],
  templateUrl: './info-tab.component.html',
  styleUrl: './info-tab.component.scss',
})
export class InfoTabComponent {
  state = inject(UrlStateService);
  ehld = inject(EhldService);
  interactor = inject(InteractorService);
}
