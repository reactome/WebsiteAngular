import { Component, OnInit, input, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from "@angular/forms";
import {Store} from "@ngrx/store";
import {Observable} from "rxjs";
import {searchResultFeature} from "../../../../../../state/search-result/search-result.selector";
import {SearchResult} from "../../../../../../state/search-result/search-result.state";
import {searchResultActions} from "../../../../../../state/search-result/search-result.action";
import {datasetActions} from "../../../../../../state/dataset/dataset.actions";
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatInput } from '@angular/material/input';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDivider } from '@angular/material/list';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { AsyncPipe } from '@angular/common';

@Component({
    selector: 'gsa-search',
    templateUrl: './search.component.html',
    styleUrls: ['./search.component.scss'],
    imports: [FormsModule, ReactiveFormsModule, MatFormField, MatLabel, MatSelect, MatOption, MatInput, MatIconButton, MatSuffix, MatIcon, MatTooltip, MatDivider, MatProgressSpinner, AsyncPipe]
})
export class SearchComponent implements OnInit {
  private store = inject(Store);
  private builder = inject(FormBuilder);


  readonly datasetId = input.required<number>();

  searchForm = this.builder.group({
    species: ['Homo sapiens'],
    keywords: ['']
  }, {
    validators: (group) => {
      return group.value.species || group.value.keywords ? null : {noInput: true}
    }
  })

  searchStatus$: Observable<'pending' | 'finished' | 'waiting'> = this.store.select(searchResultFeature.selectSearchStatus);
  species$: Observable<string[]> = this.store.select(searchResultFeature.selectSpeciesList);
  results$: Observable<SearchResult[]> = this.store.select(searchResultFeature.selectAll);

  ngOnInit(): void {
    this.store.dispatch(searchResultActions.loadSpecies());
  }

  search() {
    this.store.dispatch(searchResultActions.search({
      species: this.searchForm.value.species,
      keywords: this.searchForm.value.keywords as string
    }))
  }

  select(result: SearchResult): void {
    this.store.dispatch(datasetActions.load({
      id: this.datasetId(), resourceId: result.resource_loading_id, parameters: result.loading_parameters
    }))
  }

}
