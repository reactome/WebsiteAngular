import {RouterModule, Routes} from "@angular/router";
import {NgModule} from "@angular/core";
import { AppComponent } from "./app.component";

export const routes: Routes = [
  {
    matcher: (segments) => segments.length === 0
      ? {consumed: segments}
      : {consumed: segments, posParams: {pathwayId: segments[0]}},
    component: AppComponent,
  },
]


@NgModule({
  imports: [RouterModule.forRoot(routes, {bindToComponentInputs: false})],
  exports: [RouterModule]
})
export class AppRoutingModule {
}
