import {Routes} from "@angular/router";
import {ViewportComponent} from "./viewport/viewport.component";

export const routes: Routes = [
  {
    matcher: (segments) => segments.length === 0
      ? {consumed: segments}
      : {consumed: segments, posParams: {pathwayId: segments[0]}},
    component: ViewportComponent,
  },
]
