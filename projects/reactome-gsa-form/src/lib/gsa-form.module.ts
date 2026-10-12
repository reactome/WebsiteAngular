import { ModuleWithProviders, NgModule } from '@angular/core';

import { GsaFormComponent } from './gsa-form.component';

import { StoreModule } from '@ngrx/store';
import { methodFeature } from './state/method/method.selector';
import { EffectsModule } from '@ngrx/effects';
import { MethodEffects } from './state/method/method.effect';
import { datasetSourceFeature } from './state/dataset-source/dataset-source.selector';
import { DatasetSourceEffects } from './state/dataset-source/dataset-source.effect';
import { datasetFeature } from './state/dataset/dataset.selector';
import { DatasetEffects } from './state/dataset/dataset.effect';
import { analysisFeature } from './state/analysis/analysis.selector';
import { AnalysisEffects } from './state/analysis/analysis.effect';
import { GsaFormRoutingModule } from './gsa-form-routing.module';
import { SearchResultEffects } from './state/search-result/search-result.effect';
import { searchResultFeature } from './state/search-result/search-result.selector';
import { config, DEFAULT_GSA_CONFIG, GsaConfig } from './config/gsa-config';
import { TourUtilsService } from './services/tour-utils.service';

@NgModule({
  imports: [
    GsaFormRoutingModule,
    StoreModule.forFeature(methodFeature),
    StoreModule.forFeature(datasetSourceFeature),
    StoreModule.forFeature(datasetFeature),
    StoreModule.forFeature(analysisFeature),
    StoreModule.forFeature(searchResultFeature),
    EffectsModule.forFeature(MethodEffects),
    EffectsModule.forFeature(DatasetSourceEffects),
    EffectsModule.forFeature(DatasetEffects),
    EffectsModule.forFeature(AnalysisEffects),
    EffectsModule.forFeature(SearchResultEffects),
    GsaFormComponent,
  ],
  providers: [TourUtilsService],
  exports: [GsaFormComponent],
})
export class GsaFormModule {
  constructor() {}

  private static configure(c: Partial<GsaConfig>) {
    config.set({ ...DEFAULT_GSA_CONFIG, ...c });
  }

  static forChild(c: Partial<GsaConfig>): typeof GsaFormModule {
    GsaFormModule.configure(c);
    return GsaFormModule;
  }

  static forRoot(config: Partial<GsaConfig>): ModuleWithProviders<GsaFormModule> {
    GsaFormModule.configure(config);
    return {
      ngModule: GsaFormModule,
      providers: [],
    };
  }
}
